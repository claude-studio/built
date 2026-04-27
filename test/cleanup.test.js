#!/usr/bin/env node
/**
 * test/cleanup.test.js
 *
 * scripts/cleanup.js 단위 테스트.
 * Node.js 내장 assert + fs + os + child_process만 사용 (외부 패키지 없음).
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const childProcess = require('child_process');

const {
  cleanupFeature,
  cleanupAll,
  unregisterFeature,
  removeLock,
} = require('../scripts/cleanup');

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

let tmpDirs = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'built-cleanup-test-'));
  tmpDirs.push(dir);
  return dir;
}

function cleanup() {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  tmpDirs = [];
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function initGitProject(root) {
  childProcess.execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  childProcess.execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, stdio: 'ignore' });
  childProcess.execFileSync('git', ['config', 'user.name', 'Built Test'], { cwd: root, stdio: 'ignore' });
  fs.writeFileSync(path.join(root, '.gitignore'), '.built/runtime/\n', 'utf8');
  fs.writeFileSync(path.join(root, 'README.md'), '# test\n', 'utf8');
  childProcess.execFileSync('git', ['add', 'README.md', '.gitignore'], { cwd: root, stdio: 'ignore' });
  childProcess.execFileSync('git', ['commit', '-m', '초기 테스트 커밋'], { cwd: root, stdio: 'ignore' });
}

/**
 * 테스트용 프로젝트 루트 구조 생성.
 * @param {string} root
 * @param {string} feature
 * @param {{ status?: string }} stateOpts
 */
function makeProject(root, feature, stateOpts = {}) {
  initGitProject(root);
  const runtimeDir  = path.join(root, '.built', 'runtime');
  const runDir      = path.join(runtimeDir, 'runs', feature);
  const featuresDir = path.join(root, '.built', 'features', feature);
  const worktreeDir = path.join(root, '.claude', 'worktrees', feature);
  const worktreeBranch = `built/worktree/${feature}`;

  // state.json
  writeJson(path.join(runDir, 'state.json'), {
    feature,
    phase: 'report',
    status: stateOpts.status || 'completed',
    pid: null,
    heartbeat: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attempt: 1,
    last_error: null,
    execution_worktree: {
      enabled: true,
      path: worktreeDir,
      branch: worktreeBranch,
      result_dir: path.join(worktreeDir, '.built', 'features', feature),
      runtime_root: runtimeDir,
    },
  });

  // .built/features/<feature>/
  fs.mkdirSync(featuresDir, { recursive: true });
  fs.writeFileSync(path.join(featuresDir, 'report.md'), '# Report\n', 'utf8');

  fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });
  childProcess.execFileSync('git', ['worktree', 'add', '-b', worktreeBranch, worktreeDir, 'HEAD'], {
    cwd: root,
    stdio: 'ignore',
  });

  // registry.json
  writeJson(path.join(runtimeDir, 'registry.json'), {
    version: 1,
    features: {
      [feature]: {
        featureId:    feature,
        status:       stateOpts.status || 'completed',
        startedAt:    new Date().toISOString(),
        worktreePath: worktreeDir,
        worktreeBranch,
        resultDir:     path.join(worktreeDir, '.built', 'features', feature),
        pid:          null,
        updatedAt:    new Date().toISOString(),
      },
    },
  });

  return { runtimeDir, runDir, featuresDir, worktreeDir };
}

function makeLock(root, feature) {
  const locksDir = path.join(root, '.built', 'runtime', 'locks');
  fs.mkdirSync(locksDir, { recursive: true });
  const lockFile = path.join(locksDir, `${feature}.lock`);
  fs.writeFileSync(lockFile, '', 'utf8');
  return lockFile;
}

function ignoreBuiltArtifacts(worktreeDir) {
  const excludePath = childProcess.execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
    cwd: worktreeDir,
    encoding: 'utf8',
  }).trim();
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  fs.appendFileSync(excludePath, '\n.built/features/\n', 'utf8');
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  [pass] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    failed++;
  } finally {
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// cleanupFeature 테스트
// ---------------------------------------------------------------------------

console.log('\ncleanupFeature');

test('feature 이름 없으면 skipped 반환', () => {
  const root = makeTmpDir();
  const result = cleanupFeature(root, '', {});
  assert.strictEqual(result.skipped, true);
  assert.ok(result.reason.includes('required'));
});

test('running 상태이면 skipped 반환', () => {
  const root = makeTmpDir();
  makeProject(root, 'user-auth', { status: 'running' });
  const result = cleanupFeature(root, 'user-auth', {});
  assert.strictEqual(result.skipped, true);
  assert.ok(result.reason.includes('running'));
});

test('completed 상태 — features 디렉토리 삭제', () => {
  const root = makeTmpDir();
  const { featuresDir } = makeProject(root, 'user-auth', { status: 'completed' });
  const result = cleanupFeature(root, 'user-auth', {});
  assert.strictEqual(result.skipped, false);
  assert.strictEqual(fs.existsSync(featuresDir), false, 'features dir should be removed');
});

test('completed 상태 — runtime run 디렉토리 삭제', () => {
  const root = makeTmpDir();
  const { runDir } = makeProject(root, 'user-auth', { status: 'completed' });
  cleanupFeature(root, 'user-auth', {});
  assert.strictEqual(fs.existsSync(runDir), false, 'run dir should be removed');
});

test('completed 상태 — registry에서 unregister', () => {
  const root = makeTmpDir();
  const { runtimeDir } = makeProject(root, 'user-auth', { status: 'completed' });
  cleanupFeature(root, 'user-auth', {});
  const registry = readJson(path.join(runtimeDir, 'registry.json'));
  assert.ok(!registry.features['user-auth'], 'feature should be removed from registry');
});

test('--archive 옵션 — features 디렉토리를 archive로 이동', () => {
  const root = makeTmpDir();
  const { featuresDir } = makeProject(root, 'user-auth', { status: 'completed' });
  const result = cleanupFeature(root, 'user-auth', { archive: true });
  assert.strictEqual(result.skipped, false);
  assert.strictEqual(fs.existsSync(featuresDir), false, 'original features dir should be gone');
  const archiveDir = path.join(root, '.built', 'archive', 'user-auth');
  assert.strictEqual(fs.existsSync(archiveDir), true, 'archive dir should exist');
  assert.strictEqual(result.archived, true);
});

test('--archive 옵션 — worktree result_dir 산출물을 worktree 삭제 전에 보존', () => {
  const root = makeTmpDir();
  const feature = 'user-auth';
  const { featuresDir, runDir, worktreeDir } = makeProject(root, feature, { status: 'completed' });
  ignoreBuiltArtifacts(worktreeDir);

  fs.writeFileSync(path.join(featuresDir, 'report.md'), '# Root fallback report\n', 'utf8');

  const worktreeResultDir = path.join(worktreeDir, '.built', 'features', feature);
  fs.mkdirSync(path.join(worktreeResultDir, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(worktreeResultDir, 'report.md'), '# Worktree canonical report\n', 'utf8');
  fs.writeFileSync(path.join(worktreeResultDir, 'do-result.md'), '# Do result\n', 'utf8');
  fs.writeFileSync(path.join(worktreeResultDir, 'check-result.md'), '# Check result\n', 'utf8');
  fs.writeFileSync(path.join(worktreeResultDir, 'logs', 'progress.jsonl'), '{"phase":"do"}\n', 'utf8');

  const result = cleanupFeature(root, feature, { archive: true });
  assert.strictEqual(result.skipped, false);

  const archiveDir = path.join(root, '.built', 'archive', feature);
  assert.strictEqual(fs.existsSync(worktreeDir), false, 'worktree should be removed after archive');
  assert.strictEqual(fs.existsSync(runDir), false, 'run dir should be removed');
  assert.strictEqual(fs.existsSync(featuresDir), false, 'root fallback should be removed after archive');
  assert.strictEqual(
    fs.readFileSync(path.join(archiveDir, 'report.md'), 'utf8'),
    '# Worktree canonical report\n',
    'canonical worktree report should win at archive root'
  );
  assert.strictEqual(
    fs.readFileSync(path.join(archiveDir, '_root-fallback', 'report.md'), 'utf8'),
    '# Root fallback report\n',
    'root fallback report should be preserved separately'
  );
  assert.strictEqual(fs.existsSync(path.join(archiveDir, 'do-result.md')), true, 'do-result should be archived');
  assert.strictEqual(fs.existsSync(path.join(archiveDir, 'check-result.md')), true, 'check-result should be archived');
  assert.strictEqual(fs.existsSync(path.join(archiveDir, 'logs', 'progress.jsonl')), true, 'logs should be archived');
  assert.ok(
    result.actions.some((a) => a.includes('worktree result dir archived')),
    'actions should record worktree result_dir archive'
  );
});

test('lock 파일이 있으면 삭제', () => {
  const root = makeTmpDir();
  const { runtimeDir } = makeProject(root, 'user-auth', { status: 'aborted' });
  const lockFile = makeLock(root, 'user-auth');
  cleanupFeature(root, 'user-auth', {});
  assert.strictEqual(fs.existsSync(lockFile), false, 'lock file should be removed');
});

test('state.json 없어도 정상 처리 (not_started feature)', () => {
  const root = makeTmpDir();
  // state.json 없이 features 디렉토리만 생성
  const featuresDir = path.join(root, '.built', 'features', 'orphan');
  fs.mkdirSync(featuresDir, { recursive: true });
  // running 체크 없이 정리 진행
  const result = cleanupFeature(root, 'orphan', {});
  assert.strictEqual(result.skipped, false);
});

test('worktree 디렉토리가 없어도 오류 없음', () => {
  const root = makeTmpDir();
  makeProject(root, 'user-auth', { status: 'completed' });
  // worktree 디렉토리 미리 삭제
  const worktreeDir = path.join(root, '.claude', 'worktrees', 'user-auth');
  fs.rmSync(worktreeDir, { recursive: true, force: true });
  const result = cleanupFeature(root, 'user-auth', {});
  assert.strictEqual(result.skipped, false);
  const worktreeAction = result.actions.find((a) => a.includes('worktree'));
  assert.ok(worktreeAction && worktreeAction.includes('already removed'), worktreeAction);
});

test('explicit worktree path가 허용 루트 밖이면 cleanup skipped', () => {
  const root = makeTmpDir();
  const { runtimeDir, featuresDir } = makeProject(root, 'user-auth', { status: 'completed' });
  const outside = path.join(root, '..', 'outside-worktree');
  fs.mkdirSync(outside, { recursive: true });
  const registryPath = path.join(runtimeDir, 'registry.json');
  const registry = readJson(registryPath);
  registry.features['user-auth'].worktreePath = outside;
  writeJson(registryPath, registry);

  const result = cleanupFeature(root, 'user-auth', {});
  assert.strictEqual(result.skipped, true);
  assert.ok(result.reason.includes('outside allowed roots'));
  assert.strictEqual(fs.existsSync(featuresDir), true, 'unsafe cleanup should not remove features dir');
});

test('worktree branch가 expected branch와 다르면 cleanup skipped', () => {
  const root = makeTmpDir();
  const { runtimeDir, featuresDir } = makeProject(root, 'user-auth', { status: 'completed' });
  const registryPath = path.join(runtimeDir, 'registry.json');
  const registry = readJson(registryPath);
  registry.features['user-auth'].worktreeBranch = 'built/worktree/other-feature';
  writeJson(registryPath, registry);

  const result = cleanupFeature(root, 'user-auth', {});
  assert.strictEqual(result.skipped, true);
  assert.ok(result.reason.includes('branch mismatch'));
  assert.strictEqual(fs.existsSync(featuresDir), true, 'unsafe cleanup should not remove features dir');
});

test('worktree에 uncommitted 변경이 있으면 cleanup skipped', () => {
  const root = makeTmpDir();
  const { featuresDir, worktreeDir } = makeProject(root, 'user-auth', { status: 'completed' });
  fs.writeFileSync(path.join(worktreeDir, 'dirty.txt'), 'dirty\n', 'utf8');

  const result = cleanupFeature(root, 'user-auth', {});
  assert.strictEqual(result.skipped, true);
  assert.ok(result.reason.includes('uncommitted changes'));
  assert.strictEqual(fs.existsSync(featuresDir), true, 'dirty worktree cleanup should not remove features dir');
});

// ---------------------------------------------------------------------------
// cleanupAll 테스트
// ---------------------------------------------------------------------------

console.log('\ncleanupAll');

test('eligible feature 없으면 결과 빈 배열', () => {
  const root = makeTmpDir();
  // running 상태만 존재
  makeProject(root, 'active-feat', { status: 'running' });
  const { results, cleaned, skipped } = cleanupAll(root, {});
  assert.strictEqual(cleaned, 0);
  // running은 eligible 아니므로 skipped
  const r = results.find((x) => x.feature === 'active-feat');
  assert.ok(r && r.skipped);
});

test('done/aborted/completed/failed 모두 정리', () => {
  const root = makeTmpDir();
  const runtimeDir = path.join(root, '.built', 'runtime');

  // 여러 feature를 registry에 등록
  const statuses = { feat1: 'completed', feat2: 'aborted', feat3: 'failed' };
  const registry = { version: 1, features: {} };

  for (const [f, status] of Object.entries(statuses)) {
    const runDir = path.join(runtimeDir, 'runs', f);
    writeJson(path.join(runDir, 'state.json'), {
      feature: f, phase: 'report', status, pid: null,
      heartbeat: new Date().toISOString(), startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), attempt: 1, last_error: null,
    });
    registry.features[f] = {
      featureId: f, status, startedAt: new Date().toISOString(),
      worktreePath: null, pid: null, updatedAt: new Date().toISOString(),
    };
  }
  writeJson(path.join(runtimeDir, 'registry.json'), registry);

  const { cleaned, skipped } = cleanupAll(root, {});
  assert.strictEqual(cleaned, 3, `expected 3 cleaned, got ${cleaned}`);
  assert.strictEqual(skipped, 0);
});

test('running 상태는 --all에서 건너뜀', () => {
  const root = makeTmpDir();
  makeProject(root, 'running-feat', { status: 'running' });
  const { results, cleaned, skipped } = cleanupAll(root, {});
  assert.strictEqual(cleaned, 0);
  assert.ok(skipped >= 1);
  const r = results.find((x) => x.feature === 'running-feat');
  assert.ok(r && r.skipped);
});

test('registry 없어도 runs/ 디렉토리 탐지', () => {
  const root = makeTmpDir();
  // registry 없이 runs/ 만 생성
  const runDir = path.join(root, '.built', 'runtime', 'runs', 'stray-feat');
  writeJson(path.join(runDir, 'state.json'), {
    feature: 'stray-feat', phase: 'report', status: 'completed',
    pid: null, heartbeat: new Date().toISOString(), startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), attempt: 1, last_error: null,
  });
  const { cleaned } = cleanupAll(root, {});
  assert.strictEqual(cleaned, 1, 'stray feature in runs/ should be detected');
});

// ---------------------------------------------------------------------------
// unregisterFeature / removeLock 단위 테스트
// ---------------------------------------------------------------------------

console.log('\nunregisterFeature / removeLock');

test('unregisterFeature — 없는 feature는 false 반환', () => {
  const root = makeTmpDir();
  const runtimeDir = path.join(root, '.built', 'runtime');
  writeJson(path.join(runtimeDir, 'registry.json'), { version: 1, features: {} });
  const result = unregisterFeature(runtimeDir, 'no-such');
  assert.strictEqual(result, false);
});

test('unregisterFeature — registry 파일 없어도 false 반환', () => {
  const root = makeTmpDir();
  const runtimeDir = path.join(root, '.built', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  const result = unregisterFeature(runtimeDir, 'no-such');
  assert.strictEqual(result, false);
});

test('removeLock — 없는 lock은 false 반환', () => {
  const root = makeTmpDir();
  const runtimeDir = path.join(root, '.built', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  const result = removeLock(runtimeDir, 'no-such');
  assert.strictEqual(result, false);
});

test('removeLock — 있는 lock은 삭제 후 true 반환', () => {
  const root = makeTmpDir();
  const { runtimeDir } = makeProject(root, 'feat', { status: 'completed' });
  makeLock(root, 'feat');
  const result = removeLock(runtimeDir, 'feat');
  assert.strictEqual(result, true);
  assert.strictEqual(fs.existsSync(path.join(runtimeDir, 'locks', 'feat.lock')), false);
});

// ---------------------------------------------------------------------------
// 결과 출력
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
