import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  DEFAULT_DEPLOY_PATHS,
  buildDeploymentPlan,
  executeDeploymentPlan,
  publicDeploymentSummary,
  resolveReleaseId,
  validateReleaseId,
} from './web-source-deploy-plan.mjs';
import { collectGitInfo } from './prepare-web-source-release.mjs';

const root = process.cwd();
const digest = 'a'.repeat(64);
const releaseId = '20260715T010203Z-aaaaaaaaaaaa';

function fixturePlan() {
  return buildDeploymentPlan({
    releaseId,
    archiveSha256: digest,
    service: 'dgbook-web',
    publicHost: '8.153.206.97',
    hostname: '127.0.0.1',
    appPort: '3157',
    keepReleases: 3,
  });
}

test('release id prefers explicit inputs and has a deterministic no-Git fallback', () => {
  assert.equal(resolveReleaseId({ cliReleaseId: 'stage-1', envReleaseId: 'from-env', gitCommit: 'abc123', archiveSha256: digest }), 'stage-1');
  assert.equal(resolveReleaseId({ envReleaseId: 'from-env', gitCommit: 'abc123', archiveSha256: digest }), 'from-env');
  assert.equal(resolveReleaseId({ gitCommit: 'abcdef1234567890', archiveSha256: digest }), 'abcdef123456');
  assert.equal(resolveReleaseId({ archiveSha256: digest, now: new Date('2026-07-15T01:02:03.999Z') }), releaseId);
});

test('release id and managed paths reject traversal or unsafe characters', () => {
  for (const candidate of ['', '.', '..', '../escape', 'a/b', 'a\\b', '-leading', 'has space', 'x'.repeat(81)]) {
    assert.throws(() => validateReleaseId(candidate), /release id/i, candidate);
  }
  assert.equal(validateReleaseId('s1-auth-home_20260715.1'), 's1-auth-home_20260715.1');
  assert.deepEqual(DEFAULT_DEPLOY_PATHS, {
    baseDir: '/var/www/dgbook-web',
    releasesDir: '/var/www/dgbook-web/releases',
    dropDir: '/var/www/dgbook-web/.drop',
    retiredDir: '/var/www/dgbook-web/retired',
    currentLink: '/var/www/dgbook-web/current',
    previousLink: '/var/www/dgbook-web/previous',
    sqliteDir: '/var/lib/dgbook',
    sqlitePath: '/var/lib/dgbook/dgbook.sqlite',
  });
});

test('an IPv4 deployment preserves a second cookie-isolated literal host for the demo student', () => {
  const plan = fixturePlan();
  assert.match(
    plan.nginxConfig,
    /server_name 8\.153\.206\.97 ~\^\\\[::ffff:899:ce61\\\]\$;/,
  );

  const domainPlan = buildDeploymentPlan({
    releaseId,
    archiveSha256: digest,
    publicHost: 'demo.example.com',
  });
  assert.match(domainPlan.nginxConfig, /server_name demo\.example\.com;/);
  assert.doesNotMatch(domainPlan.nginxConfig, /::ffff:/);
});

test('activation atomically records old current as previous and restores both link snapshots on rollback', () => {
  const plan = fixturePlan();
  assert.equal(plan.previousLink, '/var/www/dgbook-web/previous');
  assert.equal(plan.retiredDir, '/var/www/dgbook-web/retired');
  assert.match(plan.remote.preSwitch, /old-previous-target/);
  assert.match(plan.remote.preSwitch, /had-previous/);

  const activation = plan.remote.switchAndHealth;
  const previousSwap = activation.indexOf('atomic_symlink_swap "$old_target" "$previous_link"');
  const currentSwap = activation.indexOf('atomic_symlink_swap "$release_dir" "$current_link"');
  assert.ok(previousSwap >= 0, 'old current must be atomically promoted to previous');
  assert.ok(currentSwap > previousSwap, 'previous must be recorded before current changes');
  assert.match(activation, /case "\$link" in "\$current_link"\|"\$previous_link"\)/);

  const rollback = plan.remote.rollbackAfterExternalFailure;
  assert.match(rollback, /atomic_symlink_swap "\$old_previous_target" "\$previous_link"/);
  assert.match(rollback, /\[ "\$had_previous" = '1' \]/);
});

test('activation and rollback verify exact build-info release and source SHA identities', () => {
  const plan = fixturePlan();
  assert.match(plan.remote.preSwitch, /build-info-contract\.cjs/);
  assert.match(plan.remote.preSwitch, /capture "\$state\/old-build-info\.json" "\$old_target" "\$state\/old-build-info\.expected\.json"/);
  assert.match(plan.remote.switchAndHealth, /assert "\$state\/build-info\.json"/);
  assert.match(plan.remote.switchAndHealth, new RegExp(releaseId));
  assert.match(plan.remote.switchAndHealth, new RegExp(digest));
  assert.match(plan.remote.rollbackAfterExternalFailure, /verify "\$state\/rollback-build-info\.json" "\$state\/old-build-info\.expected\.json"/);
  assert.doesNotMatch(plan.remote.switchAndHealth, /grep -Fq[^\n]+releaseId/);
});

test('the deploy runtime is pinned to Node 24.15.0, pnpm 9.15.0, and a Node 24 SQLite build', async () => {
  const [rootPackageText, webPackageText, nodeVersionText, lockText] = await Promise.all([
    readFile(path.join(root, 'package.json'), 'utf8'),
    readFile(path.join(root, 'apps/web/package.json'), 'utf8'),
    readFile(path.join(root, '.node-version'), 'utf8'),
    readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'),
  ]);
  const rootPackage = JSON.parse(rootPackageText);
  const webPackage = JSON.parse(webPackageText);
  assert.equal(rootPackage.engines?.node, '24.15.0');
  assert.equal(rootPackage.packageManager, 'pnpm@9.15.0');
  assert.equal(nodeVersionText.trim(), '24.15.0');
  assert.equal(webPackage.dependencies?.['better-sqlite3'], '12.10.0');
  assert.match(lockText, /better-sqlite3@12\.10\.0:/);
  assert.doesNotMatch(lockText, /better-sqlite3@11\.10\.0:/);

  const pre = fixturePlan().remote.preSwitch;
  const nodeCheck = pre.indexOf(`test "$(node --version)" = 'v24.15.0'`);
  const pnpmCheck = pre.indexOf(`test "$(pnpm --version)" = '9.15.0'`);
  const rejectExistingModules = pre.indexOf('find . -type d -name node_modules');
  const install = pre.indexOf('pnpm install --frozen-lockfile');
  const rebuild = pre.indexOf('pnpm --filter @dgbook/web rebuild better-sqlite3');
  const sourceSmoke = pre.indexOf('source SQLite smoke query failed');
  assert.ok(nodeCheck >= 0 && nodeCheck < install, 'Node baseline must be checked before native dependency install');
  assert.ok(pnpmCheck >= 0 && pnpmCheck < install, 'pnpm baseline must be checked before native dependency install');
  assert.ok(rejectExistingModules >= 0 && rejectExistingModules < install, 'source releases must reject inherited node_modules');
  assert.ok(install < rebuild, 'the fresh install must precede the explicit native rebuild');
  assert.ok(rebuild < sourceSmoke, 'the Node 24 native binding must pass a source-tree smoke query');
});

test('pre-switch verifies and builds the release before the locked phase prepares SQLite and changes current', () => {
  const plan = fixturePlan();
  const pre = plan.remote.preSwitch;
  const critical = plan.remote.switchAndHealth;
  const literalParentTraversalPattern = String.raw`grep -Eq '(^/|(^|/)\.\.(/|$))'`;
  const wildcardTwoCharacterPattern = "grep -Eq '(^/|(^|/)..(/|$))'";
  assert.ok(pre.includes(literalParentTraversalPattern), 'archive safety check must match the literal parent segment ..');
  assert.ok(!pre.includes(wildcardTwoCharacterPattern), 'archive safety check must not reject arbitrary two-character path segments');
  assert.ok(pre.indexOf('sha256sum') < pre.indexOf('pnpm install --frozen-lockfile'));
  assert.ok(pre.indexOf('pnpm install --frozen-lockfile') < pre.indexOf('pnpm --filter @dgbook/web build'));
  assert.doesNotMatch(pre, /sqlite-online-backup|db:migrate|db:seed:base|db:seed:demo|db:verify/);

  const ordered = [
    'flock 9',
    'assert_current_matches_snapshot',
    'sqlite-online-backup',
    'db:migrate',
    'db:seed:base',
    'db:seed:demo',
    'db:verify',
    'atomic_symlink_swap "$release_dir" "$current_link"',
  ];
  let cursor = -1;
  for (const marker of ordered) {
    const next = critical.indexOf(marker);
    assert.ok(next > cursor, `${marker} must appear after the previous locked deployment operation`);
    cursor = next;
  }
  assert.doesNotMatch(pre, /ln -sfn[^\n]+current/);
  assert.match(critical, /DGBOOK_SQLITE_PATH='\/var\/lib\/dgbook\/dgbook\.sqlite'/);
  assert.match(critical, /install -d -m 0750 -o root -g root '\/var\/lib\/dgbook'/);
  assert.match(pre, /umask 0077/);
  assert.doesNotMatch(`${pre}\n${critical}`, /\breset\b|down migration|DROP TABLE/i);
});

test('pre-switch isolates standalone runtime from pnpm source symlinks', () => {
  const plan = fixturePlan();
  const pre = plan.remote.preSwitch;

  assert.doesNotMatch(
    pre,
    /cp -a apps\/web\/\.next\/standalone\/\. \./,
    'standalone must never be overlaid onto the pnpm source install',
  );
  assert.match(pre, /runtime_dir="\$release_dir\/runtime"/);
  assert.match(
    pre,
    /if \[ -e "\$runtime_dir" \] \|\| \[ -L "\$runtime_dir" \]; then exit 27; fi/,
  );

  const stageRuntime = pre.indexOf('cp -a apps/web/.next/standalone/. "$runtime_dir"');
  const copyStatic = pre.indexOf('cp -a apps/web/.next/static "$runtime_dir/apps/web/.next/static"');
  const copyPublic = pre.indexOf('cp -a apps/web/public "$runtime_dir/apps/web/public"');
  const verifyServer = pre.indexOf('test -f "$runtime_dir/apps/web/server.js"');
  const verifyNative = pre.indexOf('find -L "$runtime_dir/apps/web/node_modules/better-sqlite3"');
  const verifyRuntimeOpen = pre.indexOf('const requireRuntime = createRequire(path.resolve(process.argv[2]));');
  const prepareUnit = pre.indexOf('cat > "$state/new-unit.service"');

  assert.ok(stageRuntime >= 0);
  assert.ok(copyStatic > stageRuntime);
  assert.ok(copyPublic > copyStatic);
  assert.ok(verifyServer > copyPublic);
  assert.ok(verifyNative > verifyServer);
  assert.ok(verifyRuntimeOpen > verifyNative);
  assert.ok(prepareUnit > verifyRuntimeOpen);
  assert.match(
    plan.serviceUnit,
    /WorkingDirectory=\/var\/www\/dgbook-web\/current[\s\S]*ExecStart=\/usr\/bin\/env DGBOOK_SQLITE_PATH=\/var\/lib\/dgbook\/dgbook\.sqlite node runtime\/apps\/web\/server\.js/,
  );
});

test('service launch pins the managed SQLite path after the optional environment file is loaded', () => {
  const unit = fixturePlan().serviceUnit;
  const environmentFile = unit.indexOf('EnvironmentFile=-/etc/dgbook-web.env');
  const pinnedLaunch = unit.indexOf(
    'ExecStart=/usr/bin/env DGBOOK_SQLITE_PATH=/var/lib/dgbook/dgbook.sqlite node runtime/apps/web/server.js',
  );

  assert.ok(environmentFile >= 0, 'the optional service environment file must remain supported');
  assert.ok(
    pinnedLaunch > environmentFile,
    'the command-level SQLite path must override any stale value from the optional environment file',
  );
});

test('service launch injects the configured classroom helper token', () => {
  const unit = buildDeploymentPlan({
    releaseId,
    archiveSha256: digest,
    service: 'dgbook-web',
    publicHost: '8.153.206.97',
    helperToken: 'test-token_2026',
  }).serviceUnit;

  assert.match(unit, /Environment="DGBOOK_HELPER_TOKEN=test-token_2026"/);
  const pinnedLaunch = unit.indexOf(
    'ExecStart=/usr/bin/env DGBOOK_SQLITE_PATH=/var/lib/dgbook/dgbook.sqlite DGBOOK_HELPER_TOKEN=test-token_2026 node runtime/apps/web/server.js',
  );
  assert.ok(
    unit.indexOf('Environment="DGBOOK_HELPER_TOKEN=test-token_2026"')
      > unit.indexOf('EnvironmentFile=-/etc/dgbook-web.env'),
    'the explicit service environment remains visible after the optional environment file',
  );
  assert.ok(
    pinnedLaunch > unit.indexOf('EnvironmentFile=-/etc/dgbook-web.env'),
    'the command-level token must override EnvironmentFile and later systemd drop-in values',
  );
  assert.ok(
    pinnedLaunch < unit.indexOf(' node runtime/apps/web/server.js'),
    'the helper-token assignment must be an /usr/bin/env argument before node',
  );
});

test('service launch omits an empty helper token and rejects unsafe ExecStart token characters', () => {
  const base = {
    releaseId,
    archiveSha256: digest,
    service: 'dgbook-web',
    publicHost: '8.153.206.97',
  };
  const unit = buildDeploymentPlan({ ...base, helperToken: '' }).serviceUnit;

  assert.doesNotMatch(unit, /DGBOOK_HELPER_TOKEN=/);
  assert.match(
    unit,
    /ExecStart=\/usr\/bin\/env DGBOOK_SQLITE_PATH=\/var\/lib\/dgbook\/dgbook\.sqlite node runtime\/apps\/web\/server\.js/,
  );

  for (const helperToken of ['has space', 'dollar$value', 'percent%specifier', 'quote"value', "single'value", 'back\\slash', 'semi;colon']) {
    assert.throws(
      () => buildDeploymentPlan({ ...base, helperToken }),
      /classroom helper token is invalid/i,
      helperToken,
    );
  }
});

test('activation preserves rollback evidence and restores the old symlink, unit, service, and health on failure', () => {
  const plan = fixturePlan();
  const pre = plan.remote.preSwitch;
  const activate = plan.remote.switchAndHealth;
  assert.match(pre, /old-service-enabled/);
  assert.match(pre, /old-service-active/);
  for (const marker of [
    'old-current-target',
    'old-unit.service',
    'rollback_release',
    'atomic_symlink_swap "$old_target"',
    'systemctl daemon-reload',
    'systemctl restart',
    'ROLLBACK_HEALTH_OK',
    '/api/build-info',
    'systemctl disable',
  ]) assert.match(activate, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(plan.remote.rollbackAfterExternalFailure, /rollback_release/);
  assert.match(plan.remote.rollbackAfterExternalFailure, /ROLLBACK_HEALTH_OK/);
  assert.match(plan.serviceUnit, /Environment=DGBOOK_SQLITE_PATH=\/var\/lib\/dgbook\/dgbook\.sqlite/);
  assert.match(plan.serviceUnit, /Environment=DGBOOK_TRUST_PROXY=1/);
  assert.match(plan.serviceUnit, /EnvironmentFile=-\/etc\/dgbook-web\.env/);
});

test('activation records rollback failure and external rollback retries only the snapshotted old current', () => {
  const plan = fixturePlan();
  const activation = plan.remote.switchAndHealth;
  assert.match(activation, /rollback_code="\$\?"/);
  assert.match(activation, /ROLLBACK_FAILED/);
  assert.doesNotMatch(activation, /rollback_release[^\n]+\|\| true/);

  const external = plan.remote.rollbackAfterExternalFailure;
  assert.match(external, /old_target="\$\(cat "\$state\/old-current-target"\)"/);
  assert.match(external, /"\$current_target" = "\$old_target"/);
  assert.match(external, /rollback-failed/);
  assert.match(external, /ROLLBACK_SKIPPED_NEWER_RELEASE/);
});

test('activation is serialized, rejects a stale current snapshot, and never rolls back a newer release', () => {
  const plan = fixturePlan();
  const activate = plan.remote.switchAndHealth;
  const lock = activate.indexOf('flock 9');
  const staleGuard = activate.indexOf('\nassert_current_matches_snapshot\n');
  const rollbackTrap = activate.indexOf('trap on_failure ERR INT TERM');
  assert.ok(lock >= 0, 'activation must hold the deployment lock');
  assert.ok(staleGuard > lock, 'the stale-current guard must run while the lock is held');
  assert.ok(rollbackTrap > staleGuard, 'a stale deployment must stop before the rollback trap can clobber current');
  assert.match(activate, /\[ "\$current_target" = "\$old_target" \]/);

  const externalRollback = plan.remote.rollbackAfterExternalFailure;
  assert.match(externalRollback, /flock 9/);
  assert.match(externalRollback, /\[ "\$current_target" != "\$release_dir" \]/);
  assert.match(externalRollback, /ROLLBACK_SKIPPED_NEWER_RELEASE/);
  assert.ok(
    externalRollback.indexOf('ROLLBACK_SKIPPED_NEWER_RELEASE') < externalRollback.lastIndexOf('rollback_release'),
    'external rollback must skip before invoking rollback_release',
  );

  assert.match(plan.remote.prune, /flock 9/);
});

test('one deployment lock spans SQLite preparation through activation and internal health', () => {
  const critical = fixturePlan().remote.switchAndHealth;
  const lock = critical.indexOf('flock 9');
  const backup = critical.indexOf('# stage: sqlite-online-backup');
  const migrate = critical.indexOf('# stage: db:migrate');
  const activate = critical.indexOf('atomic_symlink_swap "$release_dir" "$current_link"');
  const health = critical.indexOf("printf 'INTERNAL_HEALTH_OK");

  assert.ok(lock >= 0, 'the critical deployment phase must acquire the global deployment lock');
  assert.ok(backup > lock, 'SQLite backup must run while the global deployment lock is held');
  assert.ok(migrate > backup, 'migration must remain ordered after the online backup');
  assert.ok(activate > migrate, 'activation must remain in the same locked phase after migration');
  assert.ok(health > activate, 'internal health must complete before the locked phase exits');
});

test('SQLite rollback trap, service stop, 0600 mode, and verified backup precede every database mutation', () => {
  const critical = fixturePlan().remote.switchAndHealth;
  const trap = critical.indexOf('trap on_failure ERR INT TERM');
  const stop = critical.indexOf("systemctl stop 'dgbook-web' > \"$state/service-stop-for-database.log\"");
  const mode = critical.indexOf('chmod 0600 "$sqlite_path"', stop);
  const before = critical.indexOf('db-before.json', mode);
  const backup = critical.indexOf('# stage: sqlite-online-backup', before);
  const backupAudit = critical.indexOf('db-backup-verified.json', backup);
  const mutation = critical.indexOf("printf '1\\n' > \"$state/db-mutation-started\"", backupAudit);
  const migrate = critical.indexOf('# stage: db:migrate', mutation);

  assert.ok(trap >= 0, 'the failure trap must be installed');
  assert.ok(stop > trap, 'the old service must stop only after the rollback trap exists');
  assert.ok(mode > stop, 'the existing database must be 0600 before inspection or backup');
  assert.ok(before > mode, 'the pre-migration audit must follow the permission assertion');
  assert.ok(backup > before, 'online backup must follow the pre-migration audit');
  assert.ok(backupAudit > backup, 'the backup copy must be independently audited');
  assert.ok(mutation > backupAudit, 'database mutation may start only after the backup is verified');
  assert.ok(migrate > mutation, 'migration must be inside the protected mutation boundary');
});

test('migration records before and after schema, user, event, and output counts and seeds preserve existing learning rows', () => {
  const plan = fixturePlan();
  const audit = plan.remote.preSwitch;
  for (const marker of ['integrity_check', 'foreign_key_check', 'users', 'learning_events', 'professional_outputs']) {
    assert.match(audit, new RegExp(marker));
  }
  assert.match(audit, /comparison === 'preserve'/);

  const critical = plan.remote.switchAndHealth;
  const migrate = critical.indexOf('# stage: db:migrate');
  const preSeed = critical.indexOf('db-pre-seed.json');
  const baseSeed = critical.indexOf('# stage: db:seed:base');
  const demoSeed = critical.indexOf('# stage: db:seed:demo');
  const verify = critical.indexOf('# stage: db:verify');
  const after = critical.indexOf('db-after.json');
  const preserve = critical.indexOf('preserve "$state/db-pre-seed.json"');
  assert.ok(preSeed > migrate, 'the preservation baseline must be captured after migration');
  assert.ok(baseSeed > preSeed && demoSeed > baseSeed, 'both seeds must follow the preservation baseline');
  assert.ok(verify > demoSeed && after > verify, 'the final audit must follow seed and db:verify');
  assert.ok(preserve > verify, 'the final audit must compare all pre-seed learning rows');
  assert.match(critical, /"database":\{"before":before,"after":after\}/);
});

test('database preservation audit permits only the exact retired v8 demo identities to be replaced', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dgbook-db-audit-'));
  const scriptPath = path.join(directory, 'db-audit.cjs');
  const databasePath = path.join(directory, 'audit.sqlite');
  const beforePath = path.join(directory, 'before.json');
  const allowedAfterPath = path.join(directory, 'allowed-after.json');
  const rejectedAfterPath = path.join(directory, 'rejected-after.json');
  const preSwitch = fixturePlan().remote.preSwitch;
  const startMarker = `cat > "$state/db-audit.cjs" <<'DGBOOK_DB_AUDIT'\n`;
  const start = preSwitch.indexOf(startMarker);
  const end = preSwitch.indexOf('\nDGBOOK_DB_AUDIT', start + startMarker.length);
  assert.ok(start >= 0 && end > start, 'generated database audit body must be extractable');
  await writeFile(scriptPath, preSwitch.slice(start + startMarker.length, end), 'utf8');

  const requireFromWeb = createRequire(path.join(root, 'apps/web/package.json'));
  const Database = requireFromWeb('better-sqlite3');
  const database = new Database(databasePath);
  try {
    database.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE learning_events (
        event_id TEXT PRIMARY KEY, origin TEXT NOT NULL, payload_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE professional_outputs (
        output_id TEXT PRIMARY KEY, origin TEXT NOT NULL, content_json TEXT NOT NULL
      ) STRICT;
      INSERT INTO users VALUES ('stu-01');
      INSERT INTO learning_events VALUES
        ('demo-event-stu-01-p1t1-n01', 'demo', '{}'),
        ('runtime-event-before-truth-origin', 'demo', '{"kept":true}');
      INSERT INTO professional_outputs VALUES
        ('demo-output-stu-02-p1t1-n04', 'demo', '{"legacy":true}'),
        ('user-output-sentinel', 'user', '{"kept":true}');
      PRAGMA user_version = 11;
    `);
  } finally {
    database.close();
  }

  const runAudit = (outputPath, ...comparison) => spawnSync(
    process.execPath,
    [scriptPath, databasePath, outputPath, ...comparison],
    { cwd: root, encoding: 'utf8' },
  );

  try {
    const capture = runAudit(beforePath);
    assert.equal(capture.status, 0, capture.stderr);

    const upgraded = new Database(databasePath);
    try {
      upgraded.exec(`
        DELETE FROM learning_events WHERE event_id = 'demo-event-stu-01-p1t1-n01';
        DELETE FROM professional_outputs WHERE output_id = 'demo-output-stu-02-p1t1-n04';
      `);
    } finally {
      upgraded.close();
    }
    const allowed = runAudit(allowedAfterPath, 'preserve', beforePath);
    assert.equal(allowed.status, 0, allowed.stderr);

    const tampered = new Database(databasePath);
    try {
      tampered.prepare(`
        DELETE FROM learning_events WHERE event_id = 'runtime-event-before-truth-origin'
      `).run();
    } finally {
      tampered.close();
    }
    const rejected = runAudit(rejectedAfterPath, 'preserve', beforePath);
    assert.notEqual(rejected.status, 0, 'non-whitelisted runtime facts must remain protected');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rollback restores the verified pre-migration SQLite backup atomically without a down migration', () => {
  const rollback = fixturePlan().remote.rollbackAfterExternalFailure;
  const releaseCwd = rollback.indexOf('cd "$release_dir"');
  const stop = rollback.indexOf('rollback-database-stop.log');
  const mutationGuard = rollback.indexOf('db-mutation-started');
  const restoreCopy = rollback.indexOf('sqlite_restore_tmp');
  const candidateAudit = rollback.indexOf('db-restore-candidate.json');
  const replace = rollback.indexOf('mv -Tf -- "$sqlite_restore_tmp" "$sqlite_path"');
  const finalAudit = rollback.indexOf('db-rollback-verified.json');
  const linkRestore = rollback.indexOf('atomic_symlink_swap "$old_target" "$current_link"');
  assert.ok(releaseCwd >= 0, 'rollback must resolve the release-local SQLite runtime');
  assert.ok(stop > releaseCwd, 'rollback must stop all database writers first');
  assert.ok(mutationGuard > stop, 'backup restore must be conditional on a started mutation');
  assert.ok(restoreCopy > mutationGuard, 'rollback must stage a same-filesystem restore copy');
  assert.ok(candidateAudit > restoreCopy, 'the staged copy must match the pre-migration audit');
  assert.ok(replace > candidateAudit, 'the verified copy must replace the database atomically');
  assert.ok(finalAudit > replace, 'the restored primary database must be independently verified');
  assert.ok(linkRestore > finalAudit, 'code links may only roll back after the database is restored');
  assert.match(rollback, /chmod 0600 "\$sqlite_path"/);
  assert.doesNotMatch(rollback, /(?:down|rollback)[-_: ]migration/i);
});

test('internal health requires the authenticated application route to return a non-5xx response', () => {
  const health = fixturePlan().remote.switchAndHealth;
  const buildInfo = health.indexOf('/api/build-info');
  const courseProbe = health.indexOf('/course');
  const nonServerError = health.indexOf('2??|3??|4??');
  const successMarker = health.indexOf("printf 'INTERNAL_HEALTH_OK");

  assert.ok(buildInfo >= 0, 'release identity must be checked first');
  assert.ok(courseProbe > buildInfo, 'the course probe must run after release identity matches');
  assert.ok(nonServerError > courseProbe, 'only an actual non-5xx HTTP status may satisfy the course probe');
  assert.ok(successMarker > nonServerError, 'internal health must not pass before the course probe');
});

test('internal health logs in both demo roles and requires their role homes to return 2xx', () => {
  const health = fixturePlan().remote.switchAndHealth;
  const login = health.indexOf('/api/auth/login');
  const student = health.indexOf('probe_authenticated_page student01 /student/home');
  const teacher = health.indexOf('probe_authenticated_page teacher01 /teacher/workbench');
  const cleanup = health.indexOf("trap 'rm -rf -- \"$health_cookie_dir\"' EXIT");

  assert.ok(login >= 0, 'internal health must use the real login route');
  assert.ok(student > login, 'student role health must run after the login probe is defined');
  assert.ok(teacher > student, 'teacher role health must run after student role health');
  assert.match(health, /case "\$login_status" in\s+2\?\?\)/);
  assert.match(health, /case "\$page_status" in\s+2\?\?\)/);
  assert.ok(cleanup >= 0, 'temporary cookie jars must be removed on every script exit');
  assert.doesNotMatch(health, /\bcat\s+["']?\$cookie_jar/);
  assert.match(health, /curl -sS[^\n]*-o \/dev\/null[^\n]*-c "\$cookie_jar"/);
});

test('activation and rollback atomically replace current through a same-directory temporary symlink', () => {
  const plan = fixturePlan();
  const deploymentScripts = [
    plan.remote.switchAndHealth,
    plan.remote.rollbackAfterExternalFailure,
  ].join('\n');

  assert.match(deploymentScripts, /temporary_link="\$\{link\}\.next-/);
  assert.match(deploymentScripts, /ln -s -- "\$target" "\$temporary_link"/);
  assert.match(deploymentScripts, /mv -Tf -- "\$temporary_link" "\$link"/);
  assert.doesNotMatch(deploymentScripts, /ln -sfn/);
  assert.match(plan.remote.switchAndHealth, /atomic_symlink_swap "\$release_dir" "\$current_link"/);
  assert.match(plan.remote.rollbackAfterExternalFailure, /atomic_symlink_swap "\$old_target" "\$current_link"/);
});

test('injectable runner proves command order, pre-switch failure isolation, and external-health rollback', async () => {
  const plan = fixturePlan();
  const events = [];
  const transport = {
    run: async (phase) => events.push(`run:${phase}`),
    upload: async (name) => events.push(`upload:${name}`),
  };
  await executeDeploymentPlan({ plan, transport, externalHealth: async () => events.push('external-health') });
  assert.deepEqual(events, [
    'run:prepare',
    'upload:archive',
    'upload:manifest',
    'run:pre-switch',
    'run:switch-and-health',
    'external-health',
    'run:prune',
  ]);

  const beforeSwitch = [];
  await assert.rejects(() => executeDeploymentPlan({
    plan,
    transport: {
      run: async (phase) => {
        beforeSwitch.push(phase);
        if (phase === 'pre-switch') throw new Error('migration failed');
      },
      upload: async () => {},
    },
    externalHealth: async () => {},
  }), /migration failed/);
  assert.deepEqual(beforeSwitch, ['prepare', 'pre-switch']);

  const activationRollback = [];
  await assert.rejects(() => executeDeploymentPlan({
    plan,
    transport: {
      run: async (phase) => {
        activationRollback.push(phase);
        if (phase === 'switch-and-health') throw new Error('activation failed after current changed');
      },
      upload: async () => {},
    },
    externalHealth: async () => {},
  }), /activation failed after current changed/);
  assert.deepEqual(activationRollback, ['prepare', 'pre-switch', 'switch-and-health', 'rollback']);

  const rollback = [];
  await assert.rejects(() => executeDeploymentPlan({
    plan,
    transport: {
      run: async (phase) => rollback.push(phase),
      upload: async () => {},
    },
    externalHealth: async () => { throw new Error('public mismatch'); },
  }), /public mismatch/);
  assert.deepEqual(rollback, ['prepare', 'pre-switch', 'switch-and-health', 'rollback']);

  const rollbackFailure = [];
  await assert.rejects(() => executeDeploymentPlan({
    plan,
    transport: {
      run: async (phase) => {
        rollbackFailure.push(phase);
        if (phase === 'switch-and-health') throw new Error('activation failed');
        if (phase === 'rollback') throw new Error('rollback failed');
      },
      upload: async () => {},
    },
    externalHealth: async () => {},
  }), (error) => {
    assert.match(error.message, /activation failed/);
    assert.match(error.rollbackError?.message ?? '', /rollback failed/);
    return true;
  });
  assert.deepEqual(rollbackFailure, ['prepare', 'pre-switch', 'switch-and-health', 'rollback']);
});

test('pruning is constrained to verified releases and .drop descendants', () => {
  const prune = fixturePlan().remote.prune;
  assert.match(prune, /assert_managed_parent/);
  assert.match(prune, /\/var\/www\/dgbook-web\/releases/);
  assert.match(prune, /\/var\/www\/dgbook-web\/\.drop/);
  assert.match(prune, /assert_managed_child/);
  assert.doesNotMatch(prune, /rm -rf \/var\/www\/dgbook-web(?:\s|['"]|$)/);
});

test('retirement protects current and previous and writes an immutable manifest before moving candidates', () => {
  const retire = fixturePlan().remote.prune;
  assert.match(retire, /current_target="\$\(readlink -f "\$current_link"\)"/);
  assert.match(retire, /previous_target="\$\(readlink -f "\$previous_link"\)"/);
  assert.match(retire, /"\$resolved" = "\$current_target"/);
  assert.match(retire, /"\$resolved" = "\$previous_target"/);
  assert.match(retire, /retired\/\$\{?release_id\}?/);
  assert.match(retire, /flag:\s*'wx'/);
  const manifestWrite = retire.indexOf("flag: 'wx'");
  const firstMove = retire.indexOf('mv -- "$source" "$destination"');
  assert.ok(manifestWrite >= 0, 'the write-once manifest must be created');
  assert.ok(firstMove > manifestWrite, 'the manifest must exist before any candidate is moved');
  assert.doesNotMatch(retire, /\brm\s+-rf\b/);
});

test('missing Git metadata stays optional and manifest preparation remains releaseable without invoking Git', () => {
  let invoked = false;
  const git = collectGitInfo(() => {
    invoked = true;
    throw new Error('Git must not be invoked for a no-Git source release');
  });
  assert.deepEqual(git, { commit: '', branch: '', dirty: false });
  assert.equal(invoked, false);
  assert.equal(resolveReleaseId({ gitCommit: git.commit, archiveSha256: digest, now: new Date('2026-07-15T01:02:03Z') }), releaseId);
});

test('online backup succeeds before the new release migrates an older supported database', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dgbook-deploy-backup-'));
  const databasePath = path.join(directory, 'old.sqlite');
  const backupPath = path.join(directory, 'backups', 'before-release.sqlite');
  const requireFromWeb = createRequire(path.join(root, 'apps/web/package.json'));
  const Database = requireFromWeb('better-sqlite3');
  const database = new Database(databasePath);
  database.exec('CREATE TABLE legacy_data (id TEXT PRIMARY KEY) STRICT');
  database.pragma('user_version = 1');
  database.close();
  try {
    const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', `pnpm --filter @dgbook/web db:backup ${backupPath}`]
      : ['--filter', '@dgbook/web', 'db:backup', backupPath];
    const result = spawnSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, DGBOOK_SQLITE_PATH: databasePath },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(backupPath), true);
    const restored = new Database(backupPath, { readonly: true, fileMustExist: true });
    assert.equal(restored.pragma('user_version', { simple: true }), 1);
    assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok');
    restored.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('both transports consume the same deployment plan and expose only the safe summary contract', async () => {
  const [ssh, paramiko, webPackage, nextConfig, structureCheck, releaseWrapper] = await Promise.all([
    readFile(path.join(root, 'scripts/deploy-web-source-ssh.mjs'), 'utf8'),
    readFile(path.join(root, 'scripts/deploy-web-source-paramiko.py'), 'utf8'),
    readFile(path.join(root, 'apps/web/package.json'), 'utf8'),
    readFile(path.join(root, 'apps/web/next.config.mjs'), 'utf8'),
    readFile(path.join(root, 'scripts/check-web-structure.mjs'), 'utf8'),
    readFile(path.join(root, 'scripts/release-web-source.mjs'), 'utf8'),
  ]);
  for (const marker of ['prepare', 'pre-switch', 'switch-and-health', 'rollback', 'prune']) {
    assert.match(ssh, new RegExp(marker));
    assert.match(paramiko, new RegExp(marker));
  }
  assert.match(ssh, /web-source-deploy-plan\.mjs/);
  assert.match(paramiko, /web-source-deploy-plan\.mjs/);
  assert.match(paramiko, /try:\s+activation = run_remote\(ssh, "switch-and-health"[\s\S]+except Exception as activation_error:\s+try:\s+run_remote\(ssh, "rollback"/);
  assert.match(paramiko, /DeploymentRollbackError\(activation_error, rollback_error\)/);
  assert.doesNotMatch(ssh, /console\.(?:log|error)\([^\n]*(?:password|token|process\.env)/i);
  assert.doesNotMatch(paramiko, /print\([^\n]*(?:password|token|os\.environ)/i);

  const scripts = JSON.parse(webPackage).scripts;
  for (const name of ['db', 'db:migrate', 'db:seed:base', 'db:seed:demo', 'db:reset:demo', 'db:verify', 'db:backup']) {
    assert.match(scripts[name], /^tsx scripts\/db-admin\.mjs/);
  }
  assert.match(nextConfig, /better-sqlite3/);
  assert.match(nextConfig, /\.\/database\/\*\*\/\*/);
  assert.match(nextConfig, /\.\/scripts\/db-admin\.mjs/);
  assert.match(structureCheck, /web-source-deploy-plan\.mjs/);
  assert.match(structureCheck, /DGBOOK_SQLITE_PATH/);
  assert.match(structureCheck, /DGBOOK_TRUST_PROXY/);
  assert.match(releaseWrapper, /forwardDeployArgs/);
  assert.match(releaseWrapper, /--release-id/);

  assert.deepEqual(publicDeploymentSummary({
    host: '8.153.206.97',
    releaseId,
    archiveSha256: digest,
    schemaVersion: 4,
    count: 4,
    password: 'must-not-leak',
    token: 'must-not-leak',
  }), {
    host: '8.153.206.97',
    releaseId,
    sha: digest,
    schemaVersion: 4,
    count: 4,
  });
});

test('Node transport external health requires the course route to return a non-5xx response', async () => {
  const source = await readFile(path.join(root, 'scripts/deploy-web-source-ssh.mjs'), 'utf8');
  const functionStart = source.indexOf('async function verifyExternalHealth');
  const functionEnd = source.indexOf('\nfunction normalizePublicUrl', functionStart);
  const health = source.slice(functionStart, functionEnd);
  const buildInfo = health.indexOf("new URL('/api/build-info'");
  const course = health.indexOf("new URL('/course'");
  const nonServerError = health.indexOf('courseResponse.status < 500');
  const success = health.lastIndexOf('return;');

  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  assert.ok(buildInfo >= 0, 'external health must still verify the release identity');
  assert.ok(course > buildInfo, 'the external course probe must follow the release identity check');
  assert.ok(nonServerError > course, 'the external course probe must reject 5xx responses');
  assert.ok(success > nonServerError, 'external health must not succeed before the course probe');
});

test('Node transport external health logs in both roles and requires 2xx role homes', async () => {
  const source = await readFile(path.join(root, 'scripts/deploy-web-source-ssh.mjs'), 'utf8');
  const verifyStart = source.indexOf('async function verifyExternalHealth');
  const verifyEnd = source.indexOf('\nfunction normalizePublicUrl', verifyStart);
  const verify = source.slice(verifyStart, verifyEnd);
  const helperStart = source.indexOf('async function probeAuthenticatedPage');
  const helperEnd = source.indexOf('\nasync function verifyExternalHealth', helperStart);
  const helper = source.slice(helperStart, helperEnd);

  assert.match(verify, /probeAuthenticatedPage\(base, 'student01', '\/student\/home'\)/);
  assert.match(verify, /probeAuthenticatedPage\(base, 'teacher01', '\/teacher\/workbench'\)/);
  assert.match(helper, /new URL\('\/api\/auth\/login'/);
  assert.match(helper, /loginResponse\.status >= 200 && loginResponse\.status < 300/);
  assert.match(helper, /headers\.get\('set-cookie'\)/);
  assert.match(helper, /headers:\s*\{ cookie \}/);
  assert.match(helper, /pageResponse\.status >= 200 && pageResponse\.status < 300/);
  assert.doesNotMatch(helper, /console\.|response\.text\(|response\.json\(/);
});
