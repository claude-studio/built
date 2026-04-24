#!/usr/bin/env node
/**
 * test/state.test.js
 *
 * state.js 단위 테스트 (Node.js assert + fs만 사용, 외부 패키지 없음)
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  atomicWrite,
  readJson,
  initRunRequest,
  readRunRequest,
  initState,
  updateState,
  readState,
} = require('../src/state');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

/** 테스트용 임시 디렉토리 생성 */
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'state-test-'));
}

/** 디렉토리 재귀 삭제 */
function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// atomicWrite / readJson
// ---------------------------------------------------------------------------

console.log('\n[atomicWrite / readJson]');

test('데이터를 파일에 쓰고 읽을 수 있다', () => {
  const dir = makeTmpDir();
  try {
    const filePath = path.join(dir, 'test.json');
    atomicWrite(filePath, { hello: 'world', n: 42 });

    const data = readJson(filePath);
    assert.strictEqual(data.hello, 'world');
    assert.strictEqual(data.n, 42);
  } finally {
    rmDir(dir);
  }
});

test('atomicWrite가 중간 디렉토리를 자동 생성한다', () => {
  const dir = makeTmpDir();
  try {
    const filePath = path.join(dir, 'nested', 'deep', 'data.json');
    atomicWrite(filePath, { ok: true });
    assert.ok(fs.existsSync(filePath));
  } finally {
    rmDir(dir);
  }
});

test('atomicWrite가 기존 파일을 덮어쓴다', () => {
  const dir = makeTmpDir();
  try {
    const filePath = path.join(dir, 'data.json');
    atomicWrite(filePath, { v: 1 });
    atomicWrite(filePath, { v: 2 });
    const data = readJson(filePath);
    assert.strictEqual(data.v, 2);
  } finally {
    rmDir(dir);
  }
});

test('readJson이 없는 파일에서 예외를 던진다', () => {
  assert.throws(() => readJson('/tmp/__no_such_file_state_test__.json'), /ENOENT/);
});

test('atomicWrite 결과가 유효한 JSON 형식이다', () => {
  const dir = makeTmpDir();
  try {
    const filePath = path.join(dir, 'out.json');
    const obj = { a: 1, b: [1, 2], c: null };
    atomicWrite(filePath, obj);

    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);  // 파싱 실패 시 예외
    assert.deepStrictEqual(parsed, obj);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// initRunRequest / readRunRequest
// ---------------------------------------------------------------------------

console.log('\n[initRunRequest / readRunRequest]');

test('run-request.json 초기 생성 — 필드 검증', () => {
  const dir = makeTmpDir();
  try {
    const result = initRunRequest(dir, {
      featureId: 'user-auth',
      planPath:  '.built/features/user-auth.md',
      model:     'claude-sonnet-4-6',
    });

    assert.strictEqual(result.featureId, 'user-auth');
    assert.strictEqual(result.planPath,  '.built/features/user-auth.md');
    assert.strictEqual(result.model,     'claude-sonnet-4-6');
    assert.ok(typeof result.createdAt === 'string');
    assert.ok(!isNaN(Date.parse(result.createdAt)));
  } finally {
    rmDir(dir);
  }
});

test('run-request.json 파일이 실제로 생성된다', () => {
  const dir = makeTmpDir();
  try {
    initRunRequest(dir, {
      featureId: 'payment',
      planPath:  '.built/features/payment.md',
      model:     'claude-opus-4-6',
    });
    assert.ok(fs.existsSync(path.join(dir, 'run-request.json')));
  } finally {
    rmDir(dir);
  }
});

test('readRunRequest가 저장된 내용을 반환한다', () => {
  const dir = makeTmpDir();
  try {
    initRunRequest(dir, {
      featureId: 'onboarding',
      planPath:  '.built/features/onboarding.md',
      model:     'claude-haiku-4-5-20251001',
    });
    const req = readRunRequest(dir);
    assert.strictEqual(req.featureId, 'onboarding');
    assert.strictEqual(req.model,     'claude-haiku-4-5-20251001');
  } finally {
    rmDir(dir);
  }
});

test('featureId 누락 시 TypeError 발생', () => {
  const dir = makeTmpDir();
  try {
    assert.throws(
      () => initRunRequest(dir, { planPath: 'x.md', model: 'claude-sonnet-4-6' }),
      /featureId/
    );
  } finally {
    rmDir(dir);
  }
});

test('planPath 누락 시 TypeError 발생', () => {
  const dir = makeTmpDir();
  try {
    assert.throws(
      () => initRunRequest(dir, { featureId: 'f', model: 'claude-sonnet-4-6' }),
      /planPath/
    );
  } finally {
    rmDir(dir);
  }
});

test('model 누락 시 TypeError 발생', () => {
  const dir = makeTmpDir();
  try {
    assert.throws(
      () => initRunRequest(dir, { featureId: 'f', planPath: 'x.md' }),
      /model/
    );
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// initState / readState / updateState
// ---------------------------------------------------------------------------

console.log('\n[initState / readState / updateState]');

test('state.json 초기 생성 — 필드 검증', () => {
  const dir = makeTmpDir();
  try {
    const state = initState(dir, 'user-auth');

    assert.strictEqual(state.feature,    'user-auth');
    assert.strictEqual(state.phase,      'planned');
    assert.strictEqual(state.status,     'planned');
    assert.strictEqual(state.pid,        null);
    assert.strictEqual(state.heartbeat,  null);
    assert.ok(typeof state.startedAt === 'string');
    assert.ok(typeof state.updatedAt === 'string');
    assert.strictEqual(state.attempt,    0);
    assert.strictEqual(state.last_error, null);
  } finally {
    rmDir(dir);
  }
});

test('state.json 파일이 실제로 생성된다', () => {
  const dir = makeTmpDir();
  try {
    initState(dir, 'payment');
    assert.ok(fs.existsSync(path.join(dir, 'state.json')));
  } finally {
    rmDir(dir);
  }
});

test('readState가 저장된 내용을 반환한다', () => {
  const dir = makeTmpDir();
  try {
    initState(dir, 'onboarding');
    const state = readState(dir);
    assert.strictEqual(state.feature, 'onboarding');
    assert.strictEqual(state.status,  'planned');
  } finally {
    rmDir(dir);
  }
});

test('featureId 누락 시 TypeError 발생', () => {
  const dir = makeTmpDir();
  try {
    assert.throws(() => initState(dir, ''), /featureId/);
  } finally {
    rmDir(dir);
  }
});

test('updateState — phase/status 갱신', () => {
  const dir = makeTmpDir();
  try {
    initState(dir, 'user-auth');
    const next = updateState(dir, { phase: 'do', status: 'running', pid: 9999 });

    assert.strictEqual(next.phase,  'do');
    assert.strictEqual(next.status, 'running');
    assert.strictEqual(next.pid,    9999);
    // 기존 필드 유지
    assert.strictEqual(next.feature, 'user-auth');
  } finally {
    rmDir(dir);
  }
});

test('updateState — updatedAt이 자동 갱신된다', () => {
  const dir = makeTmpDir();
  try {
    const initial = initState(dir, 'user-auth');
    // 1ms 이상 간격을 보장
    const before = new Date(initial.updatedAt).getTime();
    // 동기 코드에서 시간 차이를 만들기 위해 Date 오버라이드
    const origDate = global.Date;
    const fakeNow = before + 5000;
    global.Date = class extends origDate {
      static now() { return fakeNow; }
      toISOString() { return new origDate(fakeNow).toISOString(); }
      constructor(...args) {
        if (args.length === 0) super(fakeNow);
        else super(...args);
      }
    };
    try {
      const next = updateState(dir, { phase: 'do' });
      const after = new origDate(next.updatedAt).getTime();
      assert.ok(after > before, `updatedAt(${after}) should be > initial(${before})`);
    } finally {
      global.Date = origDate;
    }
  } finally {
    rmDir(dir);
  }
});

test('updateState — heartbeat 갱신', () => {
  const dir = makeTmpDir();
  try {
    initState(dir, 'user-auth');
    const heartbeatTs = new Date().toISOString();
    const next = updateState(dir, { heartbeat: heartbeatTs });
    assert.strictEqual(next.heartbeat, heartbeatTs);
  } finally {
    rmDir(dir);
  }
});

test('updateState — attempt 증가', () => {
  const dir = makeTmpDir();
  try {
    initState(dir, 'user-auth');
    updateState(dir, { attempt: 1 });
    const next = updateState(dir, { attempt: 2 });
    assert.strictEqual(next.attempt, 2);
  } finally {
    rmDir(dir);
  }
});

test('updateState — last_error 기록 후 클리어', () => {
  const dir = makeTmpDir();
  try {
    initState(dir, 'user-auth');
    updateState(dir, { last_error: 'timeout' });
    const withErr = readState(dir);
    assert.strictEqual(withErr.last_error, 'timeout');

    updateState(dir, { last_error: null });
    const cleared = readState(dir);
    assert.strictEqual(cleared.last_error, null);
  } finally {
    rmDir(dir);
  }
});

test('updateState — 변경하지 않은 필드가 유지된다', () => {
  const dir = makeTmpDir();
  try {
    initState(dir, 'payment');
    updateState(dir, { phase: 'do', pid: 1234 });
    updateState(dir, { heartbeat: new Date().toISOString() });

    const state = readState(dir);
    assert.strictEqual(state.phase, 'do');
    assert.strictEqual(state.pid,   1234);
    assert.strictEqual(state.feature, 'payment');
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// atomic write 검증 (동시성 시뮬레이션)
// ---------------------------------------------------------------------------

console.log('\n[atomic write]');

test('연속 쓰기 후에도 파일이 유효한 JSON이다', () => {
  const dir = makeTmpDir();
  try {
    const filePath = path.join(dir, 'concurrent.json');
    for (let i = 0; i < 20; i++) {
      atomicWrite(filePath, { iteration: i, ts: new Date().toISOString() });
    }
    const data = readJson(filePath);
    assert.strictEqual(data.iteration, 19);
  } finally {
    rmDir(dir);
  }
});

test('initState 후 연속 updateState — 최종 값이 정확하다', () => {
  const dir = makeTmpDir();
  try {
    initState(dir, 'loop-test');
    for (let i = 0; i < 10; i++) {
      updateState(dir, { attempt: i, heartbeat: new Date().toISOString() });
    }
    const state = readState(dir);
    assert.strictEqual(state.attempt, 9);
    assert.strictEqual(state.feature, 'loop-test');
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// 결과
// ---------------------------------------------------------------------------

console.log(`\n결과: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
