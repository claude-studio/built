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

/**
 * 테스트용 프로젝트 루트 구조 생성.
 * @param {string} root
 * @param {string} feature
 * @param {{ status?: string }} stateOpts
 */
function makeProject(root, feature, stateOpts = {}) {
  const runtimeDir  = path.join(root, '.built', 'runtime');
  const runDir      = path.join(runtimeDir, 'runs', feature);
  const featuresDir = path.join(root, '.built', 'features', feature);
  const worktreeDir = path.join(root, '.claude', 'worktrees', feature);

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
  });

  // .built/features/<feature>/
  fs.mkdirSync(featuresDir, { recursive: true });
  fs.writeFileSync(path.join(featuresDir, 'report.md'), '# Report\n', 'utf8');

  // worktree 디렉토리 (git worktree remove는 mock할 수 없으므로 디렉토리만)
  fs.mkdirSync(worktreeDir, { recursive: true });

  // registry.json
  writeJson(path.join(runtimeDir, 'registry.json'), {
    version: 1,
    features: {
      [feature]: {
        featureId:    feature,
        status:       stateOpts.status || 'completed',
        startedAt:    new Date().toISOString(),
        worktreePath: worktreeDir,
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
