import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const legacyDemoV8Facts = JSON.parse(readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/web/database/legacy-demo-v8-facts.json'),
  'utf8',
));

export const DEFAULT_DEPLOY_PATHS = Object.freeze({
  baseDir: '/var/www/dgbook-web',
  releasesDir: '/var/www/dgbook-web/releases',
  dropDir: '/var/www/dgbook-web/.drop',
  retiredDir: '/var/www/dgbook-web/retired',
  currentLink: '/var/www/dgbook-web/current',
  previousLink: '/var/www/dgbook-web/previous',
  sqliteDir: '/var/lib/dgbook',
  sqlitePath: '/var/lib/dgbook/dgbook.sqlite',
});

const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const ARCHIVE_SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_SERVICE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,79}$/;
const SAFE_HOST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/;
const SAFE_HELPER_TOKEN_PATTERN = /^[A-Za-z0-9._~+/@:=-]{1,512}$/;

export function validateReleaseId(value) {
  const releaseId = String(value ?? '');
  if (!RELEASE_ID_PATTERN.test(releaseId) || releaseId.includes('..')) {
    throw new Error('release id must use 1-80 safe path characters and cannot contain traversal');
  }
  return releaseId;
}

export function resolveReleaseId({
  cliReleaseId,
  envReleaseId,
  gitCommit,
  archiveSha256,
  now = new Date(),
}) {
  const explicit = cliReleaseId || envReleaseId;
  if (explicit) return validateReleaseId(explicit);
  const commit = String(gitCommit ?? '').trim();
  if (/^[a-fA-F0-9]{7,64}$/.test(commit)) return validateReleaseId(commit.slice(0, 12).toLowerCase());
  const digest = validateArchiveSha256(archiveSha256);
  const timestamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z').replaceAll('-', '').replaceAll(':', '');
  return validateReleaseId(`${timestamp}-${digest.slice(0, 12)}`);
}

export function buildDeploymentPlan({
  releaseId,
  archiveSha256,
  service = 'dgbook-web',
  publicHost,
  hostname = '127.0.0.1',
  appPort = '3157',
  helperToken = '',
  keepReleases = 3,
  nginx = true,
} = {}) {
  const safeReleaseId = validateReleaseId(releaseId);
  const digest = validateArchiveSha256(archiveSha256);
  const safeService = validateService(service);
  const safePublicHost = validateHost(publicHost, 'public host');
  const safeHostname = validateHost(hostname, 'application hostname');
  const safeAppPort = validatePort(appPort);
  const safeHelperToken = validateHelperToken(helperToken);
  const safeKeepReleases = validateKeepReleases(keepReleases);
  const paths = { ...DEFAULT_DEPLOY_PATHS };
  const releaseDir = `${paths.releasesDir}/${safeReleaseId}`;
  const remoteDrop = `${paths.dropDir}/${safeReleaseId}`;
  const archivePath = `${remoteDrop}/dgbook-web-source.tar.gz`;
  const manifestPath = `${remoteDrop}/dgbook-web-source.upload-manifest.json`;
  const serviceUnit = buildServiceUnit({
    service: safeService,
    currentLink: paths.currentLink,
    appPort: safeAppPort,
    hostname: safeHostname,
    releaseId: safeReleaseId,
    archiveSha256: digest,
    sqlitePath: paths.sqlitePath,
    helperToken: safeHelperToken,
  });
  const nginxConfig = buildNginxConfig({ publicHost: safePublicHost, appPort: safeAppPort, hostname: safeHostname });
  const common = {
    ...paths,
    releaseId: safeReleaseId,
    archiveSha256: digest,
    service: safeService,
    publicHost: safePublicHost,
    hostname: safeHostname,
    appPort: safeAppPort,
    keepReleases: safeKeepReleases,
    nginx: Boolean(nginx),
    releaseDir,
    remoteDrop,
    archivePath,
    manifestPath,
  };

  return Object.freeze({
    ...common,
    serviceUnit,
    nginxConfig,
    uploads: Object.freeze({ archive: archivePath, manifest: manifestPath }),
    remote: Object.freeze({
      prepare: buildPrepareScript(common),
      preSwitch: buildPreSwitchScript(common, serviceUnit, nginxConfig),
      switchAndHealth: buildSwitchAndHealthScript(common),
      rollbackAfterExternalFailure: buildExternalRollbackScript(common),
      prune: buildPruneScript(common),
    }),
  });
}

export function buildResolvedDeploymentPlan({ release = {}, plan = {} } = {}) {
  const releaseId = resolveReleaseId(release);
  return buildDeploymentPlan({ ...plan, releaseId });
}

export async function executeDeploymentPlan({ plan, transport, externalHealth }) {
  if (!plan?.remote || typeof transport?.run !== 'function' || typeof transport?.upload !== 'function') {
    throw new TypeError('deployment plan and transport are required');
  }
  if (typeof externalHealth !== 'function') throw new TypeError('external health checker is required');

  await transport.run('prepare', plan.remote.prepare);
  await transport.upload('archive', plan.uploads.archive);
  await transport.upload('manifest', plan.uploads.manifest);
  await transport.run('pre-switch', plan.remote.preSwitch);
  let activation;
  try {
    activation = await transport.run('switch-and-health', plan.remote.switchAndHealth);
    await externalHealth(plan);
  } catch (error) {
    try {
      await transport.run('rollback', plan.remote.rollbackAfterExternalFailure);
    } catch (rollbackError) {
      if (error && typeof error === 'object') error.rollbackError = rollbackError;
    }
    throw error;
  }
  await transport.run('prune', plan.remote.prune);
  return { activation };
}

export function parseActivationSummary(output) {
  const lines = String(output ?? '').trim().split(/\r?\n/).filter(Boolean);
  const candidate = lines.at(-1);
  if (!candidate) throw new Error('deployment activation did not return a summary');
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error('deployment activation returned an invalid summary');
  }
  const schemaVersion = Number(parsed.schemaVersion);
  const count = Number(parsed.count);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || !Number.isInteger(count) || count < 0) {
    throw new Error('deployment activation summary is incomplete');
  }
  return { schemaVersion, count };
}

export function publicDeploymentSummary({ host, releaseId, archiveSha256, schemaVersion, count }) {
  return {
    host: String(host),
    releaseId: validateReleaseId(releaseId),
    sha: validateArchiveSha256(archiveSha256),
    schemaVersion: Number(schemaVersion),
    count: Number(count),
  };
}

function validateArchiveSha256(value) {
  const digest = String(value ?? '').toLowerCase();
  if (!ARCHIVE_SHA256_PATTERN.test(digest)) throw new Error('archive sha256 must be 64 hexadecimal characters');
  return digest;
}

function validateService(value) {
  const service = String(value ?? '');
  if (!SAFE_SERVICE_PATTERN.test(service) || service.includes('..')) throw new Error('service name is unsafe');
  return service;
}

function validateHost(value, label) {
  const host = String(value ?? '');
  if (!SAFE_HOST_PATTERN.test(host) || host.includes('..')) throw new Error(`${label} is unsafe`);
  return host;
}

function validatePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('application port is invalid');
  return String(port);
}

function validateKeepReleases(value) {
  const keep = Number(value);
  if (!Number.isInteger(keep) || keep < 1 || keep > 20) throw new Error('release retention count is invalid');
  return keep;
}

function validateHelperToken(value) {
  const token = String(value ?? '');
  if (token && !SAFE_HELPER_TOKEN_PATTERN.test(token)) {
    throw new Error('classroom helper token is invalid');
  }
  return token;
}

function buildServiceUnit({ currentLink, appPort, hostname, releaseId, archiveSha256, sqlitePath, helperToken }) {
  const helperEnvironment = helperToken
    ? `${systemdEnvironment('DGBOOK_HELPER_TOKEN', helperToken)}\n`
    : '';
  const helperLaunchEnvironment = helperToken
    ? ` DGBOOK_HELPER_TOKEN=${helperToken}`
    : '';
  return `[Unit]
Description=DGBook 5G Next.js web
After=network.target

[Service]
Type=simple
WorkingDirectory=${currentLink}
Environment=NODE_ENV=production
Environment=PORT=${appPort}
Environment=HOSTNAME=${hostname}
Environment=DGBOOK_WEB_RELEASE_ID=${releaseId}
Environment=DGBOOK_WEB_SOURCE_SHA256=${archiveSha256}
Environment=DGBOOK_SQLITE_PATH=${sqlitePath}
Environment=DGBOOK_TRUST_PROXY=1
EnvironmentFile=-/etc/dgbook-web.env
${helperEnvironment}ExecStart=/usr/bin/env DGBOOK_SQLITE_PATH=${sqlitePath}${helperLaunchEnvironment} node runtime/apps/web/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
}

function systemdEnvironment(name, value) {
  const escaped = String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `Environment="${name}=${escaped}"`;
}

function buildNginxConfig({ publicHost, appPort, hostname }) {
  const mappedIpv6Alias = ipv4MappedIpv6ServerName(publicHost);
  return `server {
    listen 80;
    server_name ${publicHost}${mappedIpv6Alias};
    client_max_body_size 64m;
    location / {
        proxy_pass http://${hostname}:${appPort};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`;
}

function ipv4MappedIpv6ServerName(publicHost) {
  const octets = publicHost.split('.');
  if (
    octets.length !== 4
    || octets.some((octet) => !/^(0|[1-9][0-9]{0,2})$/.test(octet))
    || octets.some((octet) => Number(octet) > 255)
  ) {
    return '';
  }
  const high = ((Number(octets[0]) << 8) | Number(octets[1])).toString(16);
  const low = ((Number(octets[2]) << 8) | Number(octets[3])).toString(16);
  return ` ~^\\[::ffff:${high}:${low}\\]$`;
}

function buildPrepareScript(plan) {
  return `set -euo pipefail
base_dir=${shellQuote(plan.baseDir)}
releases_dir=${shellQuote(plan.releasesDir)}
drop_dir=${shellQuote(plan.dropDir)}
retired_dir=${shellQuote(plan.retiredDir)}
remote_drop=${shellQuote(plan.remoteDrop)}
[ "$base_dir" = '/var/www/dgbook-web' ]
[ "$releases_dir" = "$base_dir/releases" ]
[ "$drop_dir" = "$base_dir/.drop" ]
 [ "$retired_dir" = "$base_dir/retired" ]
install -d -m 0755 -o root -g root "$base_dir" "$releases_dir"
install -d -m 0700 -o root -g root "$drop_dir"
install -d -m 0700 -o root -g root "$retired_dir"
if [ -e "$remote_drop" ] || [ -L "$remote_drop" ]; then exit 23; fi
install -d -m 0700 -o root -g root "$remote_drop"
`;
}

function buildPreSwitchScript(plan, serviceUnit, nginxConfig) {
  const servicePath = `/etc/systemd/system/${plan.service}.service`;
  const nginxPath = '/etc/nginx/conf.d/dgbook-web.conf';
  return `set -euo pipefail
umask 0077
base_dir=${shellQuote(plan.baseDir)}
releases_dir=${shellQuote(plan.releasesDir)}
drop_dir=${shellQuote(plan.dropDir)}
release_dir=${shellQuote(plan.releaseDir)}
remote_drop=${shellQuote(plan.remoteDrop)}
current_link=${shellQuote(plan.currentLink)}
previous_link=${shellQuote(plan.previousLink)}
archive=${shellQuote(plan.archivePath)}
manifest=${shellQuote(plan.manifestPath)}
expected_sha=${shellQuote(plan.archiveSha256)}
sqlite_dir=${shellQuote(plan.sqliteDir)}
sqlite_path=${shellQuote(plan.sqlitePath)}
service_path=${shellQuote(servicePath)}
nginx_path=${shellQuote(nginxPath)}

assert_managed_parent() {
  case "$1" in
    "$releases_dir"|"$drop_dir") return 0 ;;
    *) return 90 ;;
  esac
}
assert_managed_child() {
  parent="$1"
  child="$2"
  assert_managed_parent "$parent"
  case "$child" in "$parent"/*) [ "$child" != "$parent" ] ;; *) return 91 ;; esac
}
assert_managed_child "$releases_dir" "$release_dir"
assert_managed_child "$drop_dir" "$remote_drop"
test -f "$archive"
test -f "$manifest"
actual_sha="$(sha256sum "$archive" | awk '{print $1}')"
[ "$actual_sha" = "$expected_sha" ]
if [ -e "$release_dir" ] || [ -L "$release_dir" ]; then exit 24; fi
install -d -m 0755 -o root -g root "$release_dir"
state="$release_dir/.deploy"
install -d -m 0700 -o root -g root "$state"
tar -tzf "$archive" > "$state/archive-entries.log"
if grep -Eq '(^/|(^|/)\\.\\.(/|$))' "$state/archive-entries.log"; then exit 25; fi
tar -xzf "$archive" -C "$release_dir" --strip-components=1
cd "$release_dir"
test "$(node --version)" = 'v24.15.0'
corepack enable > "$state/corepack.log" 2>&1 || true
test "$(pnpm --version)" = '9.15.0'
if find . -type d -name node_modules -print -quit | grep -q .; then exit 29; fi
pnpm install --frozen-lockfile > "$state/install.log" 2>&1
pnpm --filter @dgbook/web rebuild better-sqlite3 > "$state/better-sqlite3-rebuild.log" 2>&1
node --input-type=commonjs - "apps/web/package.json" > "$state/source-sqlite-smoke.log" 2>&1 <<'DGBOOK_SOURCE_SQLITE_SMOKE'
const path = require('node:path');
const { createRequire } = require('node:module');
const requireFromWeb = createRequire(path.resolve(process.argv[2]));
const Database = requireFromWeb('better-sqlite3');
const database = new Database(':memory:');
try {
  const row = database.prepare('SELECT 1 AS ok').get();
  if (row.ok !== 1) throw new Error('source SQLite smoke query failed');
} finally {
  database.close();
}
DGBOOK_SOURCE_SQLITE_SMOKE
DGBOOK_WEB_STANDALONE=1 DGBOOK_WEB_RELEASE_ID=${shellQuote(plan.releaseId)} DGBOOK_WEB_SOURCE_SHA256="$expected_sha" pnpm --filter @dgbook/web build > "$state/build.log" 2>&1
runtime_dir="$release_dir/runtime"
if [ -e "$runtime_dir" ] || [ -L "$runtime_dir" ]; then exit 27; fi
install -d -m 0755 -o root -g root "$runtime_dir"
cp -a apps/web/.next/standalone/. "$runtime_dir"

test ! -e "$runtime_dir/apps/web/.next/static"
test ! -L "$runtime_dir/apps/web/.next/static"
cp -a apps/web/.next/static "$runtime_dir/apps/web/.next/static"

test -d apps/web/public
test ! -e "$runtime_dir/apps/web/public"
test ! -L "$runtime_dir/apps/web/public"
cp -a apps/web/public "$runtime_dir/apps/web/public"

test -f "$runtime_dir/apps/web/server.js"
test -f "$runtime_dir/apps/web/scripts/db-admin.mjs"
test -d "$runtime_dir/apps/web/database/migrations"
test -f "$runtime_dir/apps/web/database/demo-seed.json"
find -L "$runtime_dir/apps/web/node_modules/better-sqlite3" -type f -name '*.node' -print -quit | grep -q .

node --input-type=commonjs - "$runtime_dir/apps/web/package.json" > "$state/runtime-sqlite-smoke.log" 2>&1 <<'DGBOOK_RUNTIME_SQLITE_SMOKE'
const path = require('node:path');
const { createRequire } = require('node:module');
const requireRuntime = createRequire(path.resolve(process.argv[2]));
const Database = requireRuntime('better-sqlite3');
const database = new Database(':memory:');
try {
  const row = database.prepare('SELECT 1 AS ok').get();
  if (row.ok !== 1) throw new Error('standalone SQLite smoke query failed');
} finally {
  database.close();
}
DGBOOK_RUNTIME_SQLITE_SMOKE

cat > "$state/build-info-contract.cjs" <<'DGBOOK_BUILD_INFO_CONTRACT'
const fs = require('node:fs');
const path = require('node:path');
const [command, observedPath, first, second] = process.argv.slice(2);
const readIdentity = (filePath) => {
  const body = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(body.releaseId) || body.releaseId.includes('..')) {
    throw new Error('build-info release id is invalid');
  }
  if (!/^[a-f0-9]{64}$/.test(body.sourceSha256)) throw new Error('build-info source SHA is invalid');
  return { releaseId: body.releaseId, sourceSha256: body.sourceSha256 };
};
const observed = readIdentity(observedPath);
if (command === 'capture') {
  if (observed.releaseId !== path.basename(first)) throw new Error('running release does not match current link');
  fs.writeFileSync(second, JSON.stringify(observed) + '\\n', { flag: 'wx', mode: 0o600 });
} else if (command === 'assert') {
  if (observed.releaseId !== first || observed.sourceSha256 !== second) throw new Error('build-info identity mismatch');
} else if (command === 'verify') {
  const expected = readIdentity(first);
  if (observed.releaseId !== expected.releaseId || observed.sourceSha256 !== expected.sourceSha256) {
    throw new Error('rollback build-info identity mismatch');
  }
} else {
  throw new Error('unknown build-info contract command');
}
DGBOOK_BUILD_INFO_CONTRACT
chmod 0600 "$state/build-info-contract.cjs"

cat > "$state/db-audit.cjs" <<'DGBOOK_DB_AUDIT'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const [databasePath, outputPath, comparison = '', expectedPath = ''] = process.argv.slice(2);
const requireFromWeb = createRequire(path.resolve('apps/web/package.json'));
const Database = requireFromWeb('better-sqlite3');
const database = new Database(databasePath, { readonly: true, fileMustExist: true });
const tableExists = (table) => Boolean(database.prepare(
  'SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?',
).get('table', table));
const count = (table) => tableExists(table)
  ? Number(database.prepare('SELECT COUNT(*) AS count FROM "' + table + '"').get().count)
  : 0;
const rows = (table) => tableExists(table)
  ? database.prepare('SELECT * FROM "' + table + '" ORDER BY 1').all()
  : [];
const replaceableLegacyDemoIds = {
  learningEvents: new Set(${JSON.stringify(legacyDemoV8Facts.learningEvents)}),
  professionalOutputs: new Set(${JSON.stringify(legacyDemoV8Facts.professionalOutputs)}),
};
const mustPreserve = (label, primaryKey, row) => !(
  row.origin === 'demo' && replaceableLegacyDemoIds[label].has(row[primaryKey])
);
try {
  assert.equal(database.pragma('integrity_check', { simple: true }), 'ok', 'SQLite integrity_check failed');
  assert.deepEqual(database.pragma('foreign_key_check'), [], 'SQLite foreign_key_check failed');
  const summary = {
    schemaVersion: Number(database.pragma('user_version', { simple: true })),
    counts: {
      users: count('users'),
      learningEvents: count('learning_events'),
      professionalOutputs: count('professional_outputs'),
    },
    protectedRows: {
      learningEvents: rows('learning_events'),
      professionalOutputs: rows('professional_outputs'),
    },
  };
  if (comparison === 'match') {
    const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
    assert.deepEqual(summary, expected, 'SQLite copy does not match its source snapshot');
  } else if (comparison === 'preserve') {
    const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
    assert.ok(summary.counts.users >= expected.counts.users, 'seed removed users');
    for (const [label, primaryKey] of [['learningEvents', 'event_id'], ['professionalOutputs', 'output_id']]) {
      const currentById = new Map(summary.protectedRows[label].map((row) => [row[primaryKey], row]));
      const protectedExpectedRows = expected.protectedRows[label].filter((row) => (
        mustPreserve(label, primaryKey, row)
      ));
      for (const row of protectedExpectedRows) {
        assert.deepEqual(currentById.get(row[primaryKey]), row, 'seed overwrote protected learning data');
      }
      assert.ok(
        summary.counts[label] >= protectedExpectedRows.length,
        'seed removed protected learning data',
      );
    }
  } else if (comparison) {
    throw new Error('unknown SQLite audit comparison');
  }
  fs.writeFileSync(outputPath, JSON.stringify(summary) + '\\n', { flag: 'wx', mode: 0o600 });
} finally {
  database.close();
}
DGBOOK_DB_AUDIT
chmod 0600 "$state/db-audit.cjs"

cat > "$state/new-unit.service" <<'DGBOOK_SYSTEMD_UNIT'
${serviceUnit}DGBOOK_SYSTEMD_UNIT
cat > "$state/new-nginx.conf" <<'DGBOOK_NGINX_CONF'
${nginxConfig}DGBOOK_NGINX_CONF

had_current=0
old_target=''
if [ -L "$current_link" ]; then
  old_target="$(readlink -f "$current_link")"
  assert_managed_child "$releases_dir" "$old_target"
  had_current=1
elif [ -e "$current_link" ]; then
  exit 26
fi
printf '%s\n' "$had_current" > "$state/had-current"
printf '%s\n' "$old_target" > "$state/old-current-target"
had_previous=0
old_previous_target=''
if [ -L "$previous_link" ]; then
  old_previous_target="$(readlink -f "$previous_link")"
  assert_managed_child "$releases_dir" "$old_previous_target"
  had_previous=1
elif [ -e "$previous_link" ]; then
  exit 28
fi
printf '%s\n' "$had_previous" > "$state/had-previous"
printf '%s\n' "$old_previous_target" > "$state/old-previous-target"
if [ -f "$service_path" ]; then
  printf '1\n' > "$state/had-unit"
  cp -p "$service_path" "$state/old-unit.service"
else
  printf '0\n' > "$state/had-unit"
fi
if systemctl is-enabled --quiet ${shellQuote(plan.service)} 2>/dev/null; then
  printf '1\n' > "$state/old-service-enabled"
else
  printf '0\n' > "$state/old-service-enabled"
fi
if systemctl is-active --quiet ${shellQuote(plan.service)} 2>/dev/null; then
  printf '1\n' > "$state/old-service-active"
else
  printf '0\n' > "$state/old-service-active"
fi
if [ "$had_current" = '1' ] && [ "$(cat "$state/old-service-active")" = '1' ]; then
  curl -fsS --max-time 8 ${shellQuote(`http://${plan.hostname}:${plan.appPort}/api/build-info`)} > "$state/old-build-info.json"
  node "$state/build-info-contract.cjs" capture "$state/old-build-info.json" "$old_target" "$state/old-build-info.expected.json"
fi
if [ -f "$nginx_path" ]; then
  printf '1\n' > "$state/had-nginx"
  cp -p "$nginx_path" "$state/old-nginx.conf"
else
  printf '0\n' > "$state/had-nginx"
fi

`;
}

function rollbackFunction(plan) {
  const servicePath = `/etc/systemd/system/${plan.service}.service`;
  const nginxPath = '/etc/nginx/conf.d/dgbook-web.conf';
  const nginxActions = plan.nginx
    ? `if [ "$(cat "$state/had-nginx")" = '1' ]; then
    install -m 0644 "$state/old-nginx.conf" "$nginx_path"
  elif [ -e "$nginx_path" ] || [ -L "$nginx_path" ]; then
    unlink "$nginx_path"
  fi
  nginx -t > "$state/rollback-nginx-test.log" 2>&1
  systemctl reload nginx > "$state/rollback-nginx-reload.log" 2>&1`
    : ':';
  return `rollback_release() {
  cd "$release_dir"
  systemctl stop ${shellQuote(plan.service)} > "$state/rollback-database-stop.log" 2>&1 || true
  if [ -f "$state/db-mutation-started" ] && [ "$(cat "$state/db-mutation-started")" = '1' ]; then
    if [ "$(cat "$state/had-database")" = '1' ]; then
      backup_path=${shellQuote(`${plan.sqliteDir}/backups/dgbook-${plan.releaseId}.sqlite`)}
      test -s "$backup_path"
      test "$(stat -c '%a' "$backup_path")" = '600'
      sqlite_restore_tmp="${plan.sqlitePath}.restore-${plan.releaseId}-$$"
      test ! -e "$sqlite_restore_tmp" && test ! -L "$sqlite_restore_tmp"
      install -m 0600 "$backup_path" "$sqlite_restore_tmp"
      node "$state/db-audit.cjs" "$sqlite_restore_tmp" "$state/db-restore-candidate.json" match "$state/db-before.json" > "$state/db-restore-candidate.log" 2>&1
      sync -f "$sqlite_restore_tmp"
      [ ! -e "${plan.sqlitePath}-wal" ] || unlink "${plan.sqlitePath}-wal"
      [ ! -e "${plan.sqlitePath}-shm" ] || unlink "${plan.sqlitePath}-shm"
      mv -Tf -- "$sqlite_restore_tmp" "$sqlite_path"
      chmod 0600 "$sqlite_path"
      test "$(stat -c '%a' "$sqlite_path")" = '600'
      node "$state/db-audit.cjs" "$sqlite_path" "$state/db-rollback-verified.json" match "$state/db-before.json" > "$state/db-rollback-audit.log" 2>&1
    else
      [ ! -e "$sqlite_path" ] || unlink "$sqlite_path"
      [ ! -e "${plan.sqlitePath}-wal" ] || unlink "${plan.sqlitePath}-wal"
      [ ! -e "${plan.sqlitePath}-shm" ] || unlink "${plan.sqlitePath}-shm"
    fi
    printf '0\\n' > "$state/db-mutation-started"
  fi
  had_current="$(cat "$state/had-current")"
  old_target="$(cat "$state/old-current-target")"
  had_previous="$(cat "$state/had-previous")"
  old_previous_target="$(cat "$state/old-previous-target")"
  if [ "$had_current" = '1' ]; then
    assert_managed_child "$releases_dir" "$old_target"
    atomic_symlink_swap "$old_target" "$current_link"
  elif [ -L "$current_link" ]; then
    unlink "$current_link"
  fi
  if [ "$had_previous" = '1' ]; then
    assert_managed_child "$releases_dir" "$old_previous_target"
    atomic_symlink_swap "$old_previous_target" "$previous_link"
  elif [ -L "$previous_link" ]; then
    unlink "$previous_link"
  fi
  if [ "$(cat "$state/had-unit")" = '1' ]; then
    install -m 0644 "$state/old-unit.service" "$service_path"
  elif [ -e "$service_path" ] || [ -L "$service_path" ]; then
    unlink "$service_path"
  fi
  ${nginxActions}
  systemctl daemon-reload > "$state/rollback-daemon-reload.log" 2>&1
  if [ "$(cat "$state/old-service-enabled")" = '1' ]; then
    systemctl enable ${shellQuote(plan.service)} > "$state/rollback-service-enable.log" 2>&1
  else
    systemctl disable ${shellQuote(plan.service)} > "$state/rollback-service-disable.log" 2>&1 || true
  fi
  if [ "$had_current" = '1' ] && [ "$(cat "$state/old-service-active")" = '1' ]; then
    systemctl restart ${shellQuote(plan.service)} > "$state/rollback-service.log" 2>&1
    rollback_ok=0
    for i in $(seq 1 18); do
      if curl -fsS --max-time 8 ${shellQuote(`http://${plan.hostname}:${plan.appPort}/api/build-info`)} > "$state/rollback-build-info.json" 2>/dev/null \
        && node "$state/build-info-contract.cjs" verify "$state/rollback-build-info.json" "$state/old-build-info.expected.json"; then rollback_ok=1; break; fi
      sleep 2
    done
    [ "$rollback_ok" = '1' ]
    printf 'ROLLBACK_HEALTH_OK\n' > "$state/rollback-health"
  else
    systemctl stop ${shellQuote(plan.service)} > "$state/rollback-service.log" 2>&1 || true
  fi
}`;
}

function shellStatePrelude(plan) {
  return `base_dir=${shellQuote(plan.baseDir)}
releases_dir=${shellQuote(plan.releasesDir)}
drop_dir=${shellQuote(plan.dropDir)}
retired_dir=${shellQuote(plan.retiredDir)}
release_dir=${shellQuote(plan.releaseDir)}
current_link=${shellQuote(plan.currentLink)}
previous_link=${shellQuote(plan.previousLink)}
sqlite_path=${shellQuote(plan.sqlitePath)}
state="$release_dir/.deploy"
service_path=${shellQuote(`/etc/systemd/system/${plan.service}.service`)}
nginx_path='/etc/nginx/conf.d/dgbook-web.conf'
assert_managed_parent() {
  case "$1" in "$releases_dir"|"$drop_dir") return 0 ;; *) return 90 ;; esac
}
assert_managed_child() {
  parent="$1"; child="$2"; assert_managed_parent "$parent"
  case "$child" in "$parent"/*) [ "$child" != "$parent" ] ;; *) return 91 ;; esac
}
assert_managed_child "$releases_dir" "$release_dir"
test -d "$state"
atomic_symlink_swap() {
  target="$1"
  link="$2"
  case "$link" in "$current_link"|"$previous_link") ;; *) return 93 ;; esac
  temporary_link="\${link}.next-${plan.releaseId}-$$"
  [ ! -e "$temporary_link" ] && [ ! -L "$temporary_link" ]
  ln -s -- "$target" "$temporary_link"
  if ! mv -Tf -- "$temporary_link" "$link"; then
    unlink "$temporary_link" 2>/dev/null || true
    return 92
  fi
}
`;
}

function buildLockedDatabasePreparation(plan) {
  return `cd "$release_dir"
install -d -m 0750 -o root -g root ${shellQuote(plan.sqliteDir)}
install -d -m 0700 -o root -g root ${shellQuote(`${plan.sqliteDir}/backups`)}
printf '0\\n' > "$state/db-mutation-started"
if [ "$(cat "$state/old-service-active")" = '1' ]; then
  systemctl stop ${shellQuote(plan.service)} > "$state/service-stop-for-database.log" 2>&1
fi
if [ -f "$sqlite_path" ]; then
  printf '1\\n' > "$state/had-database"
  chmod 0600 "$sqlite_path"
  test "$(stat -c '%a' "$sqlite_path")" = '600'
  node "$state/db-audit.cjs" "$sqlite_path" "$state/db-before.json" > "$state/db-before-audit.log" 2>&1
  # stage: sqlite-online-backup
  backup_path=${shellQuote(`${plan.sqliteDir}/backups/dgbook-${plan.releaseId}.sqlite`)}
  DGBOOK_SQLITE_PATH=${shellQuote(plan.sqlitePath)} pnpm --filter @dgbook/web db:backup "$backup_path" > "$state/sqlite-online-backup.log" 2>&1
  test -s "$backup_path"
  chmod 0600 "$backup_path"
  test "$(stat -c '%a' "$backup_path")" = '600'
  node "$state/db-audit.cjs" "$backup_path" "$state/db-backup-verified.json" match "$state/db-before.json" > "$state/db-backup-audit.log" 2>&1
else
  printf '0\\n' > "$state/had-database"
  printf '%s\\n' '{"schemaVersion":0,"counts":{"users":0,"learningEvents":0,"professionalOutputs":0},"protectedRows":{"learningEvents":[],"professionalOutputs":[]}}' > "$state/db-before.json"
  chmod 0600 "$state/db-before.json"
fi
printf '1\\n' > "$state/db-mutation-started"
# stage: db:migrate
DGBOOK_SQLITE_PATH=${shellQuote(plan.sqlitePath)} pnpm --filter @dgbook/web db:migrate > "$state/db-migrate.log" 2>&1
chmod 0600 "$sqlite_path"
test "$(stat -c '%a' "$sqlite_path")" = '600'
node "$state/db-audit.cjs" "$sqlite_path" "$state/db-pre-seed.json" > "$state/db-pre-seed-audit.log" 2>&1
# stage: db:seed:base
DGBOOK_SQLITE_PATH=${shellQuote(plan.sqlitePath)} pnpm --filter @dgbook/web db:seed:base > "$state/db-seed-base.log" 2>&1
chmod 0600 "$sqlite_path"
test "$(stat -c '%a' "$sqlite_path")" = '600'
# stage: db:seed:demo
DGBOOK_SQLITE_PATH=${shellQuote(plan.sqlitePath)} pnpm --filter @dgbook/web db:seed:demo > "$state/db-seed-demo.log" 2>&1
chmod 0600 "$sqlite_path"
test "$(stat -c '%a' "$sqlite_path")" = '600'
# stage: db:verify
DGBOOK_SQLITE_PATH=${shellQuote(plan.sqlitePath)} pnpm --filter @dgbook/web db:verify > "$state/db-verify.log" 2>&1
chmod 0600 "$sqlite_path"
test "$(stat -c '%a' "$sqlite_path")" = '600'
node "$state/db-audit.cjs" "$sqlite_path" "$state/db-after.json" preserve "$state/db-pre-seed.json" > "$state/db-after-audit.log" 2>&1

node --input-type=commonjs - "$state/db-before.json" "$state/db-after.json" "$state/result.json" > "$state/db-summary.log" 2>&1 <<'DGBOOK_DB_SUMMARY'
const fs = require('node:fs');
const beforeAudit = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const afterAudit = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const publicSnapshot = ({ schemaVersion, counts }) => ({ schemaVersion, counts });
const before = publicSnapshot(beforeAudit);
const after = publicSnapshot(afterAudit);
const result = {"schemaVersion":after.schemaVersion,"count":after.counts.users,"database":{"before":before,"after":after}};
fs.writeFileSync(process.argv[4], JSON.stringify(result) + '\\n', { flag: 'wx', mode: 0o600 });
DGBOOK_DB_SUMMARY
test -s "$state/result.json"
`;
}

function buildSwitchAndHealthScript(plan) {
  const nginxInstall = plan.nginx
    ? `install -m 0644 "$state/new-nginx.conf" "$nginx_path.new-${plan.releaseId}"
mv "$nginx_path.new-${plan.releaseId}" "$nginx_path"
nginx -t > "$state/nginx-test.log" 2>&1`
    : ':';
  const nginxReload = plan.nginx ? `systemctl reload nginx > "$state/nginx-reload.log" 2>&1` : ':';
  return `set -eEuo pipefail
umask 0077
${shellStatePrelude(plan)}deploy_lock="$base_dir/.deploy.lock"
exec 9>"$deploy_lock"
flock 9
assert_current_matches_snapshot() {
  had_current="$(cat "$state/had-current")"
  old_target="$(cat "$state/old-current-target")"
  if [ "$had_current" = '1' ]; then
    [ -L "$current_link" ]
    current_target="$(readlink -f "$current_link")"
    assert_managed_child "$releases_dir" "$current_target"
    [ "$current_target" = "$old_target" ]
  else
    [ ! -e "$current_link" ] && [ ! -L "$current_link" ]
  fi
}
assert_previous_matches_snapshot() {
  had_previous="$(cat "$state/had-previous")"
  old_previous_target="$(cat "$state/old-previous-target")"
  if [ "$had_previous" = '1' ]; then
    [ -L "$previous_link" ]
    previous_target="$(readlink -f "$previous_link")"
    assert_managed_child "$releases_dir" "$previous_target"
    [ "$previous_target" = "$old_previous_target" ]
  else
    [ ! -e "$previous_link" ] && [ ! -L "$previous_link" ]
  fi
}
assert_current_matches_snapshot
assert_previous_matches_snapshot
${rollbackFunction(plan)}
on_failure() {
  code="$?"
  trap - ERR INT TERM
  set +e
  ( set -eEuo pipefail; rollback_release ) > "$state/rollback.log" 2>&1
  rollback_code="$?"
  set -e
  if [ "$rollback_code" -ne 0 ]; then
    printf 'ROLLBACK_FAILED code=%s\\n' "$rollback_code" > "$state/rollback-failed"
    exit 120
  fi
  printf 'ROLLBACK_COMPLETE\\n' > "$state/rollback-complete"
  exit "$code"
}
trap on_failure ERR INT TERM
${buildLockedDatabasePreparation(plan)}
install -m 0644 "$state/new-unit.service" "$service_path.new-${plan.releaseId}"
mv "$service_path.new-${plan.releaseId}" "$service_path"
${nginxInstall}
if [ "$(cat "$state/had-current")" = '1' ]; then
  old_target="$(cat "$state/old-current-target")"
  atomic_symlink_swap "$old_target" "$previous_link"
fi
atomic_symlink_swap "$release_dir" "$current_link"
systemctl daemon-reload > "$state/daemon-reload.log" 2>&1
systemctl enable ${shellQuote(plan.service)} > "$state/service-enable.log" 2>&1
systemctl restart ${shellQuote(plan.service)} > "$state/service-restart.log" 2>&1
${nginxReload}
health_cookie_dir="$(mktemp -d /run/dgbook-web-health.XXXXXX)"
trap 'rm -rf -- "$health_cookie_dir"' EXIT
probe_authenticated_page() {
  username="$1"
  page="$2"
  cookie_jar="$3"
  : > "$cookie_jar"
  login_status="$(printf '{"username":"%s","password":"123456"}' "$username" \
    | curl -sS --max-time 8 -o /dev/null -w '%{http_code}' -c "$cookie_jar" \
      -H 'content-type: application/json' --data-binary @- \
      ${shellQuote(`http://${plan.hostname}:${plan.appPort}/api/auth/login`)} 2>/dev/null || true)"
  case "$login_status" in
    2??) ;;
    *) return 1 ;;
  esac
  page_status="$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' -b "$cookie_jar" \
    "http://${plan.hostname}:${plan.appPort}$page" 2>/dev/null || true)"
  curl -sS --max-time 8 -o /dev/null -b "$cookie_jar" -X POST \
    ${shellQuote(`http://${plan.hostname}:${plan.appPort}/api/auth/logout`)} 2>/dev/null || true
  case "$page_status" in
    2??) return 0 ;;
    *) return 1 ;;
  esac
}
health_ok=0
for i in $(seq 1 24); do
  if curl -fsS --max-time 8 ${shellQuote(`http://${plan.hostname}:${plan.appPort}/api/build-info`)} > "$state/build-info.json" 2>/dev/null \
    && node "$state/build-info-contract.cjs" assert "$state/build-info.json" ${shellQuote(plan.releaseId)} ${shellQuote(plan.archiveSha256)}; then
    course_status="$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' ${shellQuote(`http://${plan.hostname}:${plan.appPort}/course`)} 2>/dev/null || true)"
    printf '%s\n' "$course_status" > "$state/course-health-status"
    case "$course_status" in
      2??|3??|4??)
        if ! probe_authenticated_page student01 /student/home "$health_cookie_dir/student.cookies"; then break; fi
        if ! probe_authenticated_page teacher01 /teacher/workbench "$health_cookie_dir/teacher.cookies"; then break; fi
        health_ok=1
        break
        ;;
    esac
  fi
  sleep 2
done
[ "$health_ok" = '1' ]
printf 'INTERNAL_HEALTH_OK\n' > "$state/internal-health"
trap - ERR INT TERM
cat "$state/result.json"
`;
}

function buildExternalRollbackScript(plan) {
  return `set -eEuo pipefail
umask 0077
${shellStatePrelude(plan)}${rollbackFunction(plan)}
deploy_lock="$base_dir/.deploy.lock"
exec 9>"$deploy_lock"
flock 9
if [ ! -L "$current_link" ]; then
  printf 'ROLLBACK_SKIPPED_NEWER_RELEASE\n' > "$state/external-rollback-skipped"
  exit 0
fi
current_target="$(readlink -f "$current_link")"
assert_managed_child "$releases_dir" "$current_target"
if [ "$current_target" != "$release_dir" ]; then
  old_target="$(cat "$state/old-current-target")"
  if [ -f "$state/rollback-failed" ] && [ "$(cat "$state/had-current")" = '1' ] && [ "$current_target" = "$old_target" ]; then
    :
  else
    printf 'ROLLBACK_SKIPPED_NEWER_RELEASE\n' > "$state/external-rollback-skipped"
    exit 0
  fi
fi
rollback_release > "$state/external-rollback.log" 2>&1
`;
}

function buildPruneScript(plan) {
  return `set -euo pipefail
umask 0077
base_dir=${shellQuote(plan.baseDir)}
releases_dir=${shellQuote(plan.releasesDir)}
drop_dir=${shellQuote(plan.dropDir)}
retired_dir=${shellQuote(plan.retiredDir)}
release_dir=${shellQuote(plan.releaseDir)}
release_id=${shellQuote(plan.releaseId)}
current_link=${shellQuote(plan.currentLink)}
previous_link=${shellQuote(plan.previousLink)}
keep=${shellQuote(String(plan.keepReleases))}
[ "$base_dir" = '/var/www/dgbook-web' ]
[ "$releases_dir" = "$base_dir/releases" ]
[ "$drop_dir" = "$base_dir/.drop" ]
[ "$retired_dir" = "$base_dir/retired" ]
state="$release_dir/.deploy"
test -d "$state"
deploy_lock="$base_dir/.deploy.lock"
exec 9>"$deploy_lock"
flock 9
assert_managed_parent() {
  case "$1" in "$releases_dir"|"$drop_dir") return 0 ;; *) return 90 ;; esac
}
assert_managed_child() {
  parent="$1"; child="$2"; assert_managed_parent "$parent"
  case "$child" in "$parent"/*) [ "$child" != "$parent" ] ;; *) return 91 ;; esac
}
current_target="$(readlink -f "$current_link")"
assert_managed_child "$releases_dir" "$current_target"
previous_target=''
if [ -L "$previous_link" ]; then
  previous_target="$(readlink -f "$previous_link")"
  assert_managed_child "$releases_dir" "$previous_target"
elif [ -e "$previous_link" ]; then
  exit 94
fi

txn_dir="$base_dir/retired/$release_id"
candidate_file="$state/retire-candidates.tsv"
test ! -e "$candidate_file"
( set -o noclobber; : > "$candidate_file" )
chmod 0600 "$candidate_file"

collect_candidates() {
  parent="$1"; kind="$2"; assert_managed_parent "$parent"
  [ -d "$parent" ] || return 0
  n=0
  while IFS= read -r dir; do
    n=$((n + 1))
    assert_managed_child "$parent" "$dir"
    resolved="$(readlink -f "$dir")"
    assert_managed_child "$parent" "$resolved"
    if [ "$n" -le "$keep" ]; then continue; fi
    if [ "$kind" = 'releases' ] && { [ "$resolved" = "$current_target" ] || [ "$resolved" = "$previous_target" ]; }; then continue; fi
    name="$(basename "$resolved")"
    case "$name" in ''|.|..|*[!A-Za-z0-9._-]*) exit 95 ;; esac
    destination="$txn_dir/$kind/$name"
    printf '%s\\t%s\\t%s\\n' "$kind" "$resolved" "$destination" >> "$candidate_file"
  done < <(find -P "$parent" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
}
collect_candidates "$releases_dir" releases
collect_candidates "$drop_dir" drop

if [ ! -s "$candidate_file" ]; then
  printf 'RETIRE_NONE\\n' > "$state/retire-result"
  exit 0
fi

test ! -e "$txn_dir" && test ! -L "$txn_dir"
install -d -m 0700 -o root -g root "$txn_dir" "$txn_dir/releases" "$txn_dir/drop"
manifest="$txn_dir/manifest.jsonl"
node --input-type=commonjs - "$candidate_file" "$manifest" "$release_id" <<'DGBOOK_RETIRED_MANIFEST'
const fs = require('node:fs');
const path = require('node:path');
const [candidateFile, manifest, transactionId] = process.argv.slice(2);
const entries = fs.readFileSync(candidateFile, 'utf8').trim().split('\\n').filter(Boolean).map((line) => {
  const [kind, source, destination] = line.split('\\t');
  if (!['releases', 'drop'].includes(kind) || !source || !destination) throw new Error('invalid retire candidate');
  return { transactionId, kind, name: path.basename(source), source, destination, reason: 'retention-limit' };
});
fs.writeFileSync(manifest, entries.map((entry) => JSON.stringify(entry)).join('\\n') + '\\n', { flag: 'wx', mode: 0o400 });
DGBOOK_RETIRED_MANIFEST
test -s "$manifest"
test "$(stat -c '%a' "$manifest")" = '400'

while IFS=$'\\t' read -r kind source destination; do
  case "$kind" in releases) parent="$releases_dir" ;; drop) parent="$drop_dir" ;; *) exit 96 ;; esac
  assert_managed_child "$parent" "$source"
  resolved="$(readlink -f "$source")"
  assert_managed_child "$parent" "$resolved"
  if [ "$kind" = 'releases' ] && { [ "$resolved" = "$current_target" ] || [ "$resolved" = "$previous_target" ]; }; then exit 97; fi
  case "$destination" in "$txn_dir/$kind/"*) ;; *) exit 98 ;; esac
  test ! -e "$destination" && test ! -L "$destination"
  mv -- "$source" "$destination"
done < "$candidate_file"
printf 'RETIRE_COMPLETE\\n' > "$state/retire-result"
`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--json')) {
    process.stderr.write('Usage: web-source-deploy-plan.mjs --json\n');
    process.exitCode = 2;
  } else {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const plan = input && ('release' in input || 'plan' in input)
      ? buildResolvedDeploymentPlan(input)
      : buildDeploymentPlan(input);
    process.stdout.write(`${JSON.stringify(plan)}\n`);
  }
}
