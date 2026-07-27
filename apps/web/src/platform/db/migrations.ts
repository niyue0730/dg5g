import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppDatabase } from './database.ts';

export const LATEST_SCHEMA_VERSION = 14;

export interface Migration {
  version: number;
  name: string;
  fileName: string;
  sql: string;
  checksum: string;
  compatibleChecksums: readonly string[];
}

export interface MigrationResult {
  appliedVersions: number[];
  currentVersion: number;
}

export interface MigrationState {
  recordedVersions: number[];
  currentVersion: number;
}

export function migrateDatabase(
  database: AppDatabase,
  migrationsDirectory = resolveMigrationsDirectory(),
): MigrationResult {
  const migrations = readMigrations(migrationsDirectory);
  assertSupportedMigrationSet(migrations);
  const initialState = inspectMigrationState(database, migrations);

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT
  `);

  const recordedVersions = new Set(initialState.recordedVersions);
  const appliedVersions: number[] = [];

  for (const migration of migrations) {
    if (recordedVersions.has(migration.version)) continue;

    database.transaction(() => {
      database.exec(migration.sql);
      database.prepare(`
        INSERT INTO schema_migrations (version, name, checksum)
        VALUES (?, ?, ?)
      `).run(migration.version, migration.name, migration.checksum);
      database.pragma(`user_version = ${migration.version}`);
    })();
    appliedVersions.push(migration.version);
  }

  const finalState = inspectMigrationState(database, migrations);
  return { appliedVersions, currentVersion: finalState.currentVersion };
}

export function verifyMigrationState(
  database: AppDatabase,
  migrationsDirectory = resolveMigrationsDirectory(),
): MigrationState {
  const migrations = readMigrations(migrationsDirectory);
  assertSupportedMigrationSet(migrations);
  return inspectMigrationState(database, migrations);
}

export function readMigrations(migrationsDirectory = resolveMigrationsDirectory()): Migration[] {
  const migrations = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d{3}_[a-z0-9_-]+\.sql$/.test(entry.name))
    .map((entry) => {
      const match = /^(\d{3})_([a-z0-9_-]+)\.sql$/.exec(entry.name);
      if (!match) throw new Error(`Invalid migration file name: ${entry.name}`);
      const sql = normalizeMigrationSql(readFileSync(join(migrationsDirectory, entry.name), 'utf8'));
      const compatibleChecksums = migrationChecksumVariants(sql);
      return {
        version: Number(match[1]),
        name: match[2],
        fileName: entry.name,
        sql,
        checksum: compatibleChecksums[0],
        compatibleChecksums,
      };
    })
    .sort((left, right) => left.version - right.version);

  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new Error(
        `Migration order is not contiguous: expected ${expectedVersion}, found ${migration.version}.`,
      );
    }
  });
  return migrations;
}

export function resolveMigrationsDirectory(): string {
  const candidates = [
    join(process.cwd(), 'database', 'migrations'),
    join(process.cwd(), 'apps', 'web', 'database', 'migrations'),
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../database/migrations'),
  ];
  const directory = candidates.find((candidate) => existsSync(candidate));
  if (!directory) throw new Error('Unable to locate apps/web/database/migrations.');
  return directory;
}

function assertSupportedMigrationSet(migrations: Migration[]): void {
  const supportedVersion = migrations.at(-1)?.version ?? 0;
  if (supportedVersion !== LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Expected schema version ${LATEST_SCHEMA_VERSION}, found migration version ${supportedVersion}.`,
    );
  }
}

function inspectMigrationState(database: AppDatabase, migrations: Migration[]): MigrationState {
  const supportedVersion = migrations.at(-1)?.version ?? 0;
  const databaseVersion = database.pragma('user_version', { simple: true }) as number;
  if (databaseVersion > supportedVersion) {
    throw new Error(
      `Database schema version ${databaseVersion} is newer than supported version ${supportedVersion}.`,
    );
  }

  const hasHistoryTable = database.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = 'schema_migrations'
  `).pluck().get() === 1;
  const recorded = hasHistoryTable
    ? database.prepare(`
        SELECT version, name, checksum
        FROM schema_migrations
        ORDER BY version
      `).all() as Array<{ version: number; name: string; checksum: string }>
    : [];
  const migrationByVersion = new Map(migrations.map((migration) => [migration.version, migration]));

  for (const [index, record] of recorded.entries()) {
    const migration = migrationByVersion.get(record.version);
    if (!migration) {
      throw new Error(`Migration history contains unsupported version ${record.version}.`);
    }
    if (record.version !== index + 1) {
      throw new Error(`Migration history is not contiguous at version ${record.version}.`);
    }
    if (record.name !== migration.name) {
      throw new Error(`Applied migration ${migration.fileName} does not match its recorded name.`);
    }
    if (!migration.compatibleChecksums.includes(record.checksum)) {
      throw new Error(`Applied migration ${migration.fileName} does not match its recorded checksum.`);
    }
  }

  const historyVersion = recorded.at(-1)?.version ?? 0;
  if (historyVersion !== databaseVersion) {
    throw new Error(
      `Migration history version ${historyVersion} does not match PRAGMA user_version ${databaseVersion}.`,
    );
  }

  if (historyVersion === 0) {
    const unmanagedTables = database.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name <> 'schema_migrations'
    `).pluck().all() as string[];
    if (unmanagedTables.length > 0) {
      throw new Error('Migration history is empty for a non-empty database schema.');
    }
  }

  return {
    recordedVersions: recorded.map(({ version }) => version),
    currentVersion: databaseVersion,
  };
}

function normalizeMigrationSql(sql: string): string {
  return sql.replace(/\r\n?/g, '\n');
}

function migrationChecksumVariants(canonicalSql: string): readonly string[] {
  const lineEndingVariants = [canonicalSql, canonicalSql.replace(/\n/g, '\r\n')];
  return [...new Set(lineEndingVariants.map((sql) => (
    createHash('sha256').update(sql).digest('hex')
  )))];
}
