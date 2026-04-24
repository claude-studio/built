#!/usr/bin/env node
/**
 * test/resume.test.js
 *
 * scripts/resume.js 단위 테스트.
 * Node.js 내장 assert + fs + os만 사용 (외부 패키지 없음).
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const {
  resumeCommand,
  updateStatePlanned,
  removeLock,
  updateRegistryPlanned,
  isActiveOrCompleted,
} = require('../scripts/resume');

// ---------------------------------------------------------------------------
// 테스트 헬퍼
// ---------------------------------------------------------------------------

let tmpDirs = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'built-resume-test-'));
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

console.log('\n[resume.js 단위 테스트]\n');

// -------------------------
// isActiveOrCompleted
// -------------------------

test('isActiveOrCompleted: running은 true', () => {
  assert.strictEqual(isActiveOrCompleted('running'), true);
});

test('isActiveOrCompleted: completed는 true', () => {
  assert.strictEqual(isActiveOrCompleted('completed'), true);
});

test('isActiveOrCompleted: aborted는 false', () => {
  assert.strictEqual(isActiveOrCompleted('aborted'), false);
});

test('isActiveOrCompleted: failed는 false', () => {
  assert.strictEqual(isActiveOrCompleted('failed'), false);
});

test('isActiveOrCompleted: planned는 false', () => {
  assert.strictEqual(isActiveOrCompleted('planned'), false);
});

// -------------------------
// updateStatePlanned
// -------------------------

test('updateStatePlanned: state.json이 없으면 false 반환', () => {
  const root = makeTmpDir();
  const runDir = path.join(root, '.built', 'runtime', 'runs', 'test-feat');
  fs.mkdirSync(runDir, { recursive: true });
  const result = updateStatePlanned(runDir);
  assert.strictEqual(result, false);
});

test('updateStatePlanned: status를 planned로 갱신', () => {
  const root = makeTmpDir();
  const runDir = makeRunDir(root, 'user-auth', {
    feature: 'user-auth',
    status: 'aborted',
    phase: 'do',
  });
  const result = updateStatePlanned(runDir);
  assert.strictEqual(result, true);
  const state = readJson(path.join(runDir, 'state.json'));
  assert.strictEqual(state.status, 'planned');
});

test('updateStatePlanned: last_error를 null로 초기화', () => {
  const root = makeTmpDir();
  const runDir = makeRunDir(root, 'user-auth', {
    status: 'failed',
    last_error: 'some error occurred',
  });
  updateStatePlanned(runDir);
  const state = readJson(path.join(runDir, 'state.json'));
  assert.strictEqual(state.last_error, null);
});

test('updateStatePlanned: updatedAt 갱신됨', () => {
  const root = makeTmpDir();
  const runDir = makeRunDir(root, 'user-auth', {
    status: 'aborted',
    updatedAt: '2020-01-01T00:00:00Z',
  });
  updateStatePlanned(runDir);
  const state = readJson(path.join(runDir, 'state.json'));
  assert.notStrictEqual(state.updatedAt, '2020-01-01T00:00:00Z');
});

test('updateStatePlanned: 다른 필드는 보존됨', () => {
  const root = makeTmpDir();
  const runDir = makeRunDir(root, 'user-auth', {
    status: 'aborted',
    phase: 'check',
    attempt: 2,
  });
  updateStatePlanned(runDir);
  const state = readJson(path.join(runDir, 'state.json'));
  assert.strictEqual(state.phase, 'check');
  assert.strictEqual(state.attempt, 2);
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
// updateRegistryPlanned
// -------------------------

test('updateRegistryPlanned: registry.json이 없으면 무시', () => {
  const root = makeTmpDir();
  const runtimeDir = path.join(root, '.built', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  // 오류 없이 통과해야 함
  updateRegistryPlanned(runtimeDir, 'user-auth');
});

test('updateRegistryPlanned: feature status를 planned로 갱신', () => {
  const root = makeTmpDir();
  const runtimeDir = path.join(root, '.built', 'runtime');
  makeRegistry(root, { 'user-auth': { status: 'aborted' } });
  updateRegistryPlanned(runtimeDir, 'user-auth');
  const registry = readJson(path.join(runtimeDir, 'registry.json'));
  assert.strictEqual(registry.features['user-auth'].status, 'planned');
});

test('updateRegistryPlanned: feature가 registry에 없으면 무시', () => {
  const root = makeTmpDir();
  const runtimeDir = path.join(root, '.built', 'runtime');
  makeRegistry(root, { 'other-feat': { status: 'aborted' } });
  // 오류 없이 통과해야 함
  updateRegistryPlanned(runtimeDir, 'user-auth');
  const registry = readJson(path.join(runtimeDir, 'registry.json'));
  assert.ok(!registry.features['user-auth']);
});

test('updateRegistryPlanned: 다른 feature는 영향 없음', () => {
  const root = makeTmpDir();
  const runtimeDir = path.join(root, '.built', 'runtime');
  makeRegistry(root, {
    'user-auth': { status: 'aborted' },
    'payment':   { status: 'running' },
  });
  updateRegistryPlanned(runtimeDir, 'user-auth');
  const registry = readJson(path.join(runtimeDir, 'registry.json'));
  assert.strictEqual(registry.features['payment'].status, 'running');
});

// -------------------------
// resumeCommand
// -------------------------

test('resumeCommand: feature 미지정 시 usage 출력', () => {
  const root = makeTmpDir();
  const { output, resumed } = resumeCommand(root, null);
  assert.ok(output.includes('Usage'));
  assert.strictEqual(resumed, false);
});

test('resumeCommand: .built/runtime 없으면 No feature found', () => {
  const root = makeTmpDir();
  const { output, resumed } = resumeCommand(root, 'user-auth');
  assert.ok(output.includes('No feature found'));
  assert.strictEqual(resumed, false);
});

test('resumeCommand: state.json 없으면 No feature found', () => {
  const root = makeTmpDir();
  const runtimeDir = path.join(root, '.built', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  const { output, resumed } = resumeCommand(root, 'user-auth');
  assert.ok(output.includes('No feature found'));
  assert.strictEqual(resumed, false);
});

test('resumeCommand: 이미 running이면 already in state 메시지', () => {
  const root = makeTmpDir();
  makeRunDir(root, 'user-auth', { status: 'running' });
  const { output, resumed } = resumeCommand(root, 'user-auth');
  assert.ok(output.includes('already in state'));
  assert.strictEqual(resumed, false);
});

test('resumeCommand: 이미 completed이면 already in state 메시지', () => {
  const root = makeTmpDir();
  makeRunDir(root, 'user-auth', { status: 'completed' });
  const { output, resumed } = resumeCommand(root, 'user-auth');
  assert.ok(output.includes('already in state'));
  assert.strictEqual(resumed, false);
});

test('resumeCommand: aborted feature 정상 재개 — state.json 갱신됨', () => {
  const root = makeTmpDir();
  const runDir = makeRunDir(root, 'user-auth', { status: 'aborted', phase: 'do', last_error: 'boom' });
  const { resumed } = resumeCommand(root, 'user-auth');
  assert.strictEqual(resumed, true);
  const state = readJson(path.join(runDir, 'state.json'));
  assert.strictEqual(state.status, 'planned');
  assert.strictEqual(state.last_error, null);
});

test('resumeCommand: failed feature 정상 재개', () => {
  const root = makeTmpDir();
  makeRunDir(root, 'user-auth', { status: 'failed' });
  const { resumed } = resumeCommand(root, 'user-auth');
  assert.strictEqual(resumed, true);
});

test('resumeCommand: lock 파일 삭제됨', () => {
  const root = makeTmpDir();
  makeRunDir(root, 'user-auth', { status: 'aborted' });
  const lockFile = makeLock(root, 'user-auth');
  resumeCommand(root, 'user-auth');
  assert.strictEqual(fs.existsSync(lockFile), false);
});

test('resumeCommand: lock이 없어도 정상 재개', () => {
  const root = makeTmpDir();
  makeRunDir(root, 'user-auth', { status: 'aborted' });
  const { resumed } = resumeCommand(root, 'user-auth');
  assert.strictEqual(resumed, true);
});

test('resumeCommand: registry 갱신됨', () => {
  const root = makeTmpDir();
  makeRunDir(root, 'user-auth', { status: 'aborted' });
  makeRegistry(root, { 'user-auth': { status: 'aborted' } });
  resumeCommand(root, 'user-auth');
  const runtimeDir = path.join(root, '.built', 'runtime');
  const registry = readJson(path.join(runtimeDir, 'registry.json'));
  assert.strictEqual(registry.features['user-auth'].status, 'planned');
});

test('resumeCommand: registry 없어도 정상 재개', () => {
  const root = makeTmpDir();
  makeRunDir(root, 'user-auth', { status: 'aborted' });
  const { resumed } = resumeCommand(root, 'user-auth');
  assert.strictEqual(resumed, true);
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
