#!/usr/bin/env node
/**
 * test/status.test.js
 *
 * scripts/status.js 단위 테스트.
 * Node.js 내장 assert + fs + os만 사용 (외부 패키지 없음).
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const {
  readRegistry,
  readStateFile,
  readProgressFile,
  formatStatus,
  formatList,
  statusCommand,
  listCommand,
} = require('../scripts/status');

// ---------------------------------------------------------------------------
// 테스트 헬퍼
// ---------------------------------------------------------------------------

let tmpDirs = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'built-status-test-'));
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

function makeRunDir(root, feature, stateData) {
  const runDir = path.join(root, '.built', 'runtime', 'runs', feature);
  fs.mkdirSync(runDir, { recursive: true });
  if (stateData) {
    writeJson(path.join(runDir, 'state.json'), stateData);
  }
  return runDir;
}

// progress.json은 SSOT 계약에 따라 .built/features/<feature>/ 에 저장
function makeFeatureDir(root, feature, progressData) {
  const featureDir = path.join(root, '.built', 'features', feature);
  fs.mkdirSync(featureDir, { recursive: true });
  if (progressData) {
    writeJson(path.join(featureDir, 'progress.json'), progressData);
  }
  return featureDir;
}

function makeRegistry(root, features) {
  const runtimeDir = path.join(root, '.built', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  writeJson(path.join(runtimeDir, 'registry.json'), {
    version: 1,
    features,
  });
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

console.log('\n[status.js 단위 테스트]\n');

// -------------------------
// readRegistry
// -------------------------

test('readRegistry: registry.json이 없으면 null 반환', () => {
  const root = makeTmpDir();
  const runtimeDir = path.join(root, '.built', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  const result = readRegistry(runtimeDir);
  assert.strictEqual(result, null);
});

test('readRegistry: 유효한 registry.json 파싱', () => {
  const root = makeTmpDir();
  makeRegistry(root, { 'user-auth': { registeredAt: '2026-01-01T00:00:00Z' } });
  const runtimeDir = path.join(root, '.built', 'runtime');
  const result = readRegistry(runtimeDir);
  assert.ok(result !== null);
  assert.ok('features' in result);
  assert.ok('user-auth' in result.features);
});

test('readRegistry: 손상된 JSON이면 null 반환', () => {
  const root = makeTmpDir();
  const runtimeDir = path.join(root, '.built', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, 'registry.json'), 'not-json', 'utf8');
  const result = readRegistry(runtimeDir);
  assert.strictEqual(result, null);
});

// -------------------------
// readStateFile
// -------------------------

test('readStateFile: state.json이 없으면 null 반환', () => {
  const root = makeTmpDir();
  const runDir = path.join(root, '.built', 'runtime', 'runs', 'no-feature');
  const result = readStateFile(runDir);
  assert.strictEqual(result, null);
});

test('readStateFile: 유효한 state.json 파싱', () => {
  const root = makeTmpDir();
  const stateData = {
    feature: 'user-auth',
    phase: 'check',
    status: 'running',
    pid: 12345,
    heartbeat: '2026-04-24T12:00:00Z',
    attempt: 2,
    last_error: null,
  };
  const runDir = makeRunDir(root, 'user-auth', stateData);
  const result = readStateFile(runDir);
  assert.ok(result !== null);
  assert.strictEqual(result.feature, 'user-auth');
  assert.strictEqual(result.phase, 'check');
  assert.strictEqual(result.status, 'running');
  assert.strictEqual(result.pid, 12345);
  assert.strictEqual(result.attempt, 2);
});

// -------------------------
// readProgressFile
// -------------------------

test('readProgressFile: progress.json이 없으면 null 반환', () => {
  const root = makeTmpDir();
  const featureDir = path.join(root, '.built', 'features', 'no-feature');
  const result = readProgressFile(featureDir);
  assert.strictEqual(result, null);
});

test('readProgressFile: 유효한 progress.json 파싱 (featureDir 기준)', () => {
  const root = makeTmpDir();
  const progressData = { message: 'analyzing', step: 3, total: 5, iteration: 2 };
  makeFeatureDir(root, 'user-auth', progressData);
  const featureDir = path.join(root, '.built', 'features', 'user-auth');
  const result = readProgressFile(featureDir);
  assert.ok(result !== null);
  assert.strictEqual(result.message, 'analyzing');
  assert.strictEqual(result.step, 3);
  assert.strictEqual(result.total, 5);
});

// -------------------------
// formatStatus
// -------------------------

test('formatStatus: state가 null이면 no state file found 출력', () => {
  const output = formatStatus('test-feature', null, null);
  assert.ok(output.includes('test-feature'));
  assert.ok(output.includes('no state file found'));
});

test('formatStatus: 정상 state — feature명, phase, status, pid 포함', () => {
  const state = {
    feature: 'user-auth',
    phase: 'check',
    status: 'running',
    pid: 12345,
    heartbeat: null,
    attempt: 2,
    startedAt: null,
    updatedAt: null,
    last_error: null,
  };
  const output = formatStatus('user-auth', state, null);
  assert.ok(output.includes('user-auth'));
  assert.ok(output.includes('check'));
  assert.ok(output.includes('running'));
  assert.ok(output.includes('12345'));
  assert.ok(output.includes('2'));
});

test('formatStatus: progress 포함 시 message와 steps 출력', () => {
  const state = {
    feature: 'user-auth',
    phase: 'do',
    status: 'running',
    pid: null,
    heartbeat: null,
    attempt: 1,
    startedAt: null,
    updatedAt: null,
    last_error: null,
  };
  const progress = { message: 'running tests', step: 2, total: 5, iteration: 1 };
  const output = formatStatus('user-auth', state, progress);
  assert.ok(output.includes('running tests'));
  assert.ok(output.includes('2/5'));
  assert.ok(output.includes('1'));
});

test('formatStatus: last_error가 있으면 출력에 포함', () => {
  const state = {
    feature: 'user-auth',
    phase: 'do',
    status: 'failed',
    pid: null,
    heartbeat: null,
    attempt: 1,
    startedAt: null,
    updatedAt: null,
    last_error: 'timeout exceeded',
  };
  const output = formatStatus('user-auth', state, null);
  assert.ok(output.includes('timeout exceeded'));
});

test('formatStatus: last_error가 객체이면 JSON 문자열로 출력', () => {
  const state = {
    feature: 'user-auth',
    phase: 'do',
    status: 'failed',
    pid: null,
    heartbeat: null,
    attempt: 1,
    startedAt: null,
    updatedAt: null,
    last_error: { code: 'ENOENT', path: '/some/file' },
  };
  const output = formatStatus('user-auth', state, null);
  assert.ok(output.includes('ENOENT'));
});

test('formatStatus: claude_permission_request이면 구체적인 remediation 출력', () => {
  const state = {
    feature: 'user-auth',
    phase: 'do',
    status: 'failed',
    pid: null,
    heartbeat: null,
    attempt: 1,
    startedAt: null,
    updatedAt: null,
    last_error: 'do.js exited with code 1',
    last_failure: {
      code: 'claude_permission_request',
      action: 'old generic action',
    },
  };
  const output = formatStatus('user-auth', state, null);
  assert.ok(output.includes('remediation:'));
  assert.ok(output.includes('/built:run-codex-do user-auth'));
  assert.ok(output.includes('.claude/settings.json'));
  assert.ok(output.includes('--dangerously-skip-permissions'));
});

// -------------------------
// formatList
// -------------------------

test('formatList: features가 빈 객체이면 No active features found 출력', () => {
  const registry = { version: 1, features: {} };
  const runtimeDir = path.join(os.tmpdir(), 'fake-runtime');
  const output = formatList(registry, runtimeDir);
  assert.ok(output.includes('No active features found'));
});

test('formatList: features가 있으면 이름 목록 포함', () => {
  const root = makeTmpDir();
  const stateData = {
    feature: 'user-auth', phase: 'check', status: 'running',
    pid: null, heartbeat: null, attempt: 1, startedAt: null,
    updatedAt: '2026-04-24T12:00:00Z', last_error: null,
  };
  makeRunDir(root, 'user-auth', stateData);
  const registry = {
    version: 1,
    features: { 'user-auth': { registeredAt: '2026-04-24T11:00:00Z' } },
  };
  const runtimeDir = path.join(root, '.built', 'runtime');
  const output = formatList(registry, runtimeDir);
  assert.ok(output.includes('user-auth'));
  assert.ok(output.includes('running'));
  assert.ok(output.includes('check'));
});

test('formatList: 여러 feature 모두 출력', () => {
  const root = makeTmpDir();
  for (const name of ['feat-a', 'feat-b']) {
    const stateData = {
      feature: name, phase: 'do', status: 'running',
      pid: null, heartbeat: null, attempt: 0, startedAt: null,
      updatedAt: null, last_error: null,
    };
    makeRunDir(root, name, stateData);
  }
  const registry = {
    version: 1,
    features: {
      'feat-a': { status: 'running' },
      'feat-b': { status: 'running' },
    },
  };
  const runtimeDir = path.join(root, '.built', 'runtime');
  const output = formatList(registry, runtimeDir);
  assert.ok(output.includes('feat-a'));
  assert.ok(output.includes('feat-b'));
  assert.ok(output.includes('Active features (2)'));
});

// -------------------------
// statusCommand
// -------------------------

test('statusCommand: .built/runtime 없으면 No runs found', () => {
  const root = makeTmpDir();
  const { output, found } = statusCommand(root, null);
  assert.ok(output.includes('No runs found'));
  assert.strictEqual(found, false);
});

test('statusCommand: feature 지정, state.json 있음 — 상세 출력', () => {
  const root = makeTmpDir();
  const stateData = {
    feature: 'user-auth', phase: 'check', status: 'running',
    pid: 99, heartbeat: null, attempt: 2,
    startedAt: null, updatedAt: null, last_error: null,
  };
  makeRunDir(root, 'user-auth', stateData);
  const { output, found } = statusCommand(root, 'user-auth');
  assert.strictEqual(found, true);
  assert.ok(output.includes('user-auth'));
  assert.ok(output.includes('check'));
  assert.ok(output.includes('running'));
});

test('statusCommand: feature 지정, state.json 없음 — No runs found for feature', () => {
  const root = makeTmpDir();
  fs.mkdirSync(path.join(root, '.built', 'runtime', 'runs'), { recursive: true });
  const { output, found } = statusCommand(root, 'no-such-feature');
  assert.ok(output.includes('no-such-feature'));
  assert.strictEqual(found, false);
});

test('statusCommand: feature 미지정, registry 있음 — 전체 요약', () => {
  const root = makeTmpDir();
  const stateData = {
    feature: 'payment', phase: 'do', status: 'running',
    pid: 100, heartbeat: null, attempt: 1,
    startedAt: null, updatedAt: null, last_error: null,
  };
  makeRunDir(root, 'payment', stateData);
  makeRegistry(root, { payment: {} });
  const { output, found } = statusCommand(root, null);
  assert.strictEqual(found, true);
  assert.ok(output.includes('payment'));
  assert.ok(output.includes('do'));
});

test('statusCommand: feature 미지정, registry 없고 runs/ 비어있음 — No runs found', () => {
  const root = makeTmpDir();
  fs.mkdirSync(path.join(root, '.built', 'runtime', 'runs'), { recursive: true });
  const { output, found } = statusCommand(root, null);
  assert.ok(output.includes('No runs found'));
  assert.strictEqual(found, false);
});

test('statusCommand: feature 미지정, registry 없어도 runs/ 디렉토리 탐색', () => {
  const root = makeTmpDir();
  const stateData = {
    feature: 'offline-feature', phase: 'report', status: 'completed',
    pid: null, heartbeat: null, attempt: 3,
    startedAt: null, updatedAt: null, last_error: null,
  };
  makeRunDir(root, 'offline-feature', stateData);
  // registry.json 없음
  const { output, found } = statusCommand(root, null);
  assert.strictEqual(found, true);
  assert.ok(output.includes('offline-feature'));
  assert.ok(output.includes('report'));
});

test('statusCommand: progress.json 함께 출력 (featureDir 기준)', () => {
  const root = makeTmpDir();
  const stateData = {
    feature: 'user-auth', phase: 'do', status: 'running',
    pid: 55, heartbeat: null, attempt: 1,
    startedAt: null, updatedAt: null, last_error: null,
  };
  const progressData = { message: 'building components', step: 1, total: 4 };
  makeRunDir(root, 'user-auth', stateData);
  makeFeatureDir(root, 'user-auth', progressData);
  const { output } = statusCommand(root, 'user-auth');
  assert.ok(output.includes('building components'));
  assert.ok(output.includes('1/4'));
});

test('statusCommand: registry resultDir pointer의 worktree progress.json을 우선 출력', () => {
  const root = makeTmpDir();
  const feature = 'worktree-feature';
  const stateData = {
    feature, phase: 'do', status: 'running',
    pid: 55, heartbeat: null, attempt: 1,
    startedAt: null, updatedAt: null, last_error: null,
    execution_worktree: {
      enabled: true,
      path: path.join(root, '.claude', 'worktrees', feature),
      branch: `built/worktree/${feature}`,
      result_dir: path.join(root, '.claude', 'worktrees', feature, '.built', 'features', feature),
    },
  };
  const worktreeFeatureDir = stateData.execution_worktree.result_dir;
  makeRunDir(root, feature, stateData);
  makeFeatureDir(root, feature, { message: 'root stale progress', step: 1, total: 4 });
  fs.mkdirSync(worktreeFeatureDir, { recursive: true });
  writeJson(path.join(worktreeFeatureDir, 'progress.json'), { message: 'worktree canonical progress', step: 3, total: 4 });
  makeRegistry(root, {
    [feature]: {
      status: 'running',
      resultDir: worktreeFeatureDir,
      worktreePath: stateData.execution_worktree.path,
      worktreeBranch: stateData.execution_worktree.branch,
    },
  });

  const { output, found } = statusCommand(root, feature);
  assert.strictEqual(found, true);
  assert.ok(output.includes('worktree canonical progress'));
  assert.ok(output.includes('3/4'));
  assert.ok(!output.includes('root stale progress'));
});

// -------------------------
// listCommand
// -------------------------

test('listCommand: .built/runtime 없으면 No runs found', () => {
  const root = makeTmpDir();
  const { output } = listCommand(root);
  assert.ok(output.includes('No runs found'));
});

test('listCommand: registry 있으면 목록 출력', () => {
  const root = makeTmpDir();
  const stateData = {
    feature: 'feat-x', phase: 'iter', status: 'running',
    pid: null, heartbeat: null, attempt: 2,
    startedAt: null, updatedAt: null, last_error: null,
  };
  makeRunDir(root, 'feat-x', stateData);
  makeRegistry(root, { 'feat-x': {} });
  const { output } = listCommand(root);
  assert.ok(output.includes('feat-x'));
  assert.ok(output.includes('running'));
  assert.ok(output.includes('iter'));
});

test('listCommand: registry 없고 runs/ 디렉토리 폴백', () => {
  const root = makeTmpDir();
  const stateData = {
    feature: 'standalone', phase: 'do', status: 'planned',
    pid: null, heartbeat: null, attempt: 0,
    startedAt: null, updatedAt: null, last_error: null,
  };
  makeRunDir(root, 'standalone', stateData);
  // registry.json 없음
  const { output } = listCommand(root);
  assert.ok(output.includes('standalone'));
});

test('listCommand: 빈 registry — No active features found', () => {
  const root = makeTmpDir();
  makeRegistry(root, {});
  const { output } = listCommand(root);
  assert.ok(output.includes('No active features found'));
});

// ---------------------------------------------------------------------------
// 결과
// ---------------------------------------------------------------------------

cleanup();
console.log(`\n총 ${passed + failed}개 중 ${passed}개 통과, ${failed}개 실패\n`);
if (failed > 0) process.exit(1);
