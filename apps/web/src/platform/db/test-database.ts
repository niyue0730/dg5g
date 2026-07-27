import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type AppDatabase } from './database.ts';
import { REQUIRED_SELF_STUDY_SECTIONS } from '../self-study-sections.ts';

export interface TestDatabase {
  database: AppDatabase;
  databasePath: string;
  cleanup: () => void;
}

export function createTestDatabase(): TestDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'dgbook-sqlite-'));
  const databasePath = join(directory, 'test.sqlite');
  const database = openDatabase(databasePath);
  let cleaned = false;

  return {
    database,
    databasePath,
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      if (database.open) database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export function insertCompletedSelfStudySections(
  database: AppDatabase,
  studentId: string,
  nodeId: string,
): void {
  const insert = database.prepare(`
    INSERT INTO learning_events (
      event_id, student_id, node_id, channel, event_type, payload_json, origin
    ) VALUES (?, ?, ?, 'self-study', 'section_completed', ?, 'user')
  `);
  for (const sectionId of REQUIRED_SELF_STUDY_SECTIONS) {
    insert.run(
      `test-unlock-${studentId}-${nodeId}-${sectionId}`,
      studentId,
      nodeId,
      JSON.stringify({ sectionId, completed: true }),
    );
  }
}
