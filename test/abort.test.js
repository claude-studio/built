#!/usr/bin/env node
/**
 * test/abort.test.js
 *
 * scripts/abort.js 단위 테스트.
 * Node.js 내장 assert + fs + os만 사용 (외부 패키지 없음).
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const {
  abortCommand,
  updateStateAborted,
  removeLock,
  updateRegistryAborted,
  isTerminalStatus,
} = require('../scripts/abort');

// ---------------------------------------------------------------------------
// 테스트 헬퍼
// ---------------------------------------------------------------------------

let tmpDirs = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'built-abort-test-'));
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

function makeRunDir(root, feature, stateData) {
  const runDir = path.join(root, '.built', 'runtime', 'runs', feature);
  fs.mkdirSync(runDir, { recursive: true });
  if (stateData) {
    writeJson(path.join(runDir, 'state.json'), stateData);
  }
  return runDir;
}

function makeRegistry(root, features) {
  const runtimeDir = path.join(root, '.built', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  writeJson(path.join(runtimeDir, 'registry.json'), {
    version: 1,
    features,
  });
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
    console.log(`  ok  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// 테스트 스위트
// ---------------------------------------------------------------------------

console.log('\n[abort.js 단위 테스트]\n');

// -------------------------
// isTerminalStatus
// -------------------------

test('isTerminalStatus: aborted는 true', () => {
  assert.strictEqual(isTerminalStatus('aborted'), true);
});

test('isTerminalStatus: completed는 true', () => {
  assert.strictEqual(isTerminalStatus('completed'), true);
});

test('isTerminalStatus: failed는 true', () => {
  assert.strictEqual(isTerminalStatus('failed'), true);
});

test('isTerminalStatus: running은 false', () => {
  assert.strictEqual(isTerminalStatus('running'), false);
});

test('isTerminalStatus: planned는 false', () => {
  assert.strictEqual(isTerminalStatus('planned'), false);
});

// -------------------------
// updateStateAborted
// -------------------------

test('updateStateAborted: state.json이 없으면 false 반환', () => {
  const root = makeTmpDir();
  const runDir = path.join(root, '.built', 'runtime', 'runs', 'test-feat');
  fs.mkdirSync(runDir, { recursive: true });
  const result = updateStateAborted(runDir);
  assert.strictEqual(result, false);
});

test('updateStateAborted: status를 aborted로 갱신', () => {
  const root = makeTmpDir();
  const runDir = makeRunDir(root, 'user-auth', {
    feature: 'user-auth',
    status: 'running',
    phase: 'do',
  });
  const result = updateStateAborted(runDir);
  assert.strictEqual(result, true);
  const state = readJson(path.join(runDir, 'state.json'));
  assert.strictEqual(state.status, 'aborted');
});

test('updateStateAborted: updatedAt 갱신됨', () => {
  const root = makeTmpDir();
  const runDir = makeRunDir(root, 'user-auth', {
    status: 'running',
    updatedAt: '2020-01-01T00:00:00Z',
  });
  updateStateAborted(runDir);
  const state = readJson(path.join(runDir, 'state.json'));
  assert.notStrictEqual(state.updatedAt, '2020-01-01T00:00:00Z');
});

test('updateStateAborted: 다른 필드는 보존됨', () => {
  const root = makeTmpDir();
  const runDir = makeRunDir(root, 'user-auth', {
    status: 'running',
    phase: 'check',
    attempt: 3,
  });
  updateStateAborted(runDir);
  const state = readJson(path.join(runDir, 'state.json'));
  assert.strictEqual(state.phase, 'check');
  assert.strictEqual(state.attempt, 3);
});

// -------------------------
// removeLock
// -------------------------

test('removeLock: lock 파일이 있으면 삭제 후 true 반환', () => {
  const root = makeTmpDir();
  const locksDir = path.join(root, '.built', 'runtime', 'locks');
  const lockFile = makeLock(root, 'user-auth');
  const result = removeLock(locksDir, 'user-auth');
  assert.strictEqual(result, true);
  assert.strictEqual(fs.existsSync(lockFile), false);
});

test('removeLock: lock 파일이 없으면 false 반환 (오류 없음)', () => {
  const root = makeTmpDir();
  const locksDir = path.join(root, '.built', 'runtime', 'locks');
  fs.mkdirSync(locksDir, { recursive: true });
  const result = removeLock(locksDir, 'no-such-feat');
  assert.strictEqual(result, false);
});

test('removeLock: locksDir 자체가 없어도 false 반환 (오류 없음)', () => {
  const root = makeTmpDir();
  const locksDir = path.join(root, '.built', 'runtime', 'locks');
  const result = removeLock(locksDir, 'user-auth');
  assert.strictEqual(result, false);
});

// -------------------------
// updateRegistryAborted
// -------------------------

test('updateRegistryAborted: registry.json이 없으면 무시', () => {
  const root = makeTmpDir();
  const runtimeDir = path.join(root, '.built', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  // 오류 없이 통과해야 함
  updateRegistryAborted(runtimeDir, 'user-auth');
});

test('updateRegistryAborted: feature status를 aborted로 갱신', () => {
  const root = makeTmpDir();
  const runtimeDir = path.join(root, '.built', 'runtime');
  makeRegistry(root, { 'user-auth': { status: 'running' } });
  updateRegistryAborted(runtimeDir, 'user-auth');
  const registry = readJson(path.join(runtimeDir, 'registry.json'));
  assert.strictEqual(registry.features['user-auth'].status, 'aborted');
});

test('updateRegistryAborted: feature가 registry에 없으면 무시', () => {
  const root = makeTmpDir();
  const runtimeDir = path.join(root, '.built', 'runtime');
  makeRegistry(root, { 'other-feat': { status: 'running' } });
  // 오류 없이 통과해야 함
  updateRegistryAborted(runtimeDir, 'user-auth');
  const registry = readJson(path.join(runtimeDir, 'registry.json'));
  assert.ok(!registry.features['user-auth']);
});

test('updateRegistryAborted: 다른 feature는 영향 없음', () => {
  const root = makeTmpDir();
  const runtimeDir = path.join(root, '.built', 'runtime');
  makeRegistry(root, {
    'user-auth': { status: 'running' },
    'payment':   { status: 'running' },
  });
  updateRegistryAborted(runtimeDir, 'user-auth');
  const registry = readJson(path.join(runtimeDir, 'registry.json'));
  assert.strictEqual(registry.features['payment'].status, 'running');
});

// -------------------------
// abortCommand
// -------------------------

test('abortCommand: feature 미지정 시 usage 출력', () => {
  const root = makeTmpDir();
  const { output, aborted } = abortCommand(root, null);
  assert.ok(output.includes('Usage'));
  assert.strictEqual(aborted, false);
});

test('abortCommand: .built/runtime 없으면 No feature found', () => {
  const root = makeTmpDir();
  const { output, aborted } = abortCommand(root, 'user-auth');
  assert.ok(output.includes('No feature found'));
  assert.strictEqual(aborted, false);
});

test('abortCommand: state.json 없으면 No feature found', () => {
  const root = makeTmpDir();
  const runtimeDir = path.join(root, '.built', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  const { output, aborted } = abortCommand(root, 'user-auth');
  assert.ok(output.includes('No feature found'));
  assert.strictEqual(aborted, false);
});

test('abortCommand: 이미 aborted면 terminal state 메시지', () => {
  const root = makeTmpDir();
  makeRunDir(root, 'user-auth', { status: 'aborted' });
  const { output, aborted } = abortCommand(root, 'user-auth');
  assert.ok(output.includes('terminal state'));
  assert.strictEqual(aborted, false);
});

test('abortCommand: 이미 completed면 terminal state 메시지', () => {
  const root = makeTmpDir();
  makeRunDir(root, 'user-auth', { status: 'completed' });
  const { output, aborted } = abortCommand(root, 'user-auth');
  assert.ok(output.includes('terminal state'));
  assert.strictEqual(aborted, false);
});

test('abortCommand: 이미 failed면 terminal state 메시지', () => {
  const root = makeTmpDir();
  makeRunDir(root, 'user-auth', { status: 'failed' });
  const { output, aborted } = abortCommand(root, 'user-auth');
  assert.ok(output.includes('terminal state'));
  assert.strictEqual(aborted, false);
});

test('abortCommand: 정상 중단 — state.json 갱신됨', () => {
  const root = makeTmpDir();
  const runDir = makeRunDir(root, 'user-auth', { status: 'running', phase: 'do' });
  const { aborted } = abortCommand(root, 'user-auth');
  assert.strictEqual(aborted, true);
  const state = readJson(path.join(runDir, 'state.json'));
  assert.strictEqual(state.status, 'aborted');
});

test('abortCommand: 정상 중단 — lock 파일 삭제됨', () => {
  const root = makeTmpDir();
  makeRunDir(root, 'user-auth', { status: 'running' });
  const lockFile = makeLock(root, 'user-auth');
  abortCommand(root, 'user-auth');
  assert.strictEqual(fs.existsSync(lockFile), false);
});

test('abortCommand: lock이 없어도 정상 중단', () => {
  const root = makeTmpDir();
  makeRunDir(root, 'user-auth', { status: 'running' });
  const { aborted } = abortCommand(root, 'user-auth');
  assert.strictEqual(aborted, true);
});

test('abortCommand: 정상 중단 — registry 갱신됨', () => {
  const root = makeTmpDir();
  makeRunDir(root, 'user-auth', { status: 'running' });
  makeRegistry(root, { 'user-auth': { status: 'running' } });
  abortCommand(root, 'user-auth');
  const runtimeDir = path.join(root, '.built', 'runtime');
  const registry = readJson(path.join(runtimeDir, 'registry.json'));
  assert.strictEqual(registry.features['user-auth'].status, 'aborted');
});

test('abortCommand: registry 없어도 정상 중단', () => {
  const root = makeTmpDir();
  makeRunDir(root, 'user-auth', { status: 'running' });
  const { aborted } = abortCommand(root, 'user-auth');
  assert.strictEqual(aborted, true);
});

// ---------------------------------------------------------------------------
// 결과 출력
// ---------------------------------------------------------------------------

cleanup();

console.log('');
console.log(`총 ${passed + failed}개 중 ${passed}개 통과, ${failed}개 실패`);
if (failed > 0) {
  process.exit(1);
}
