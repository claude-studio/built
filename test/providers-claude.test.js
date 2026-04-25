#!/usr/bin/env node
/**
 * test/providers-claude.test.js
 *
 * src/providers/claude.js 단위 테스트.
 * childProcess.spawn을 mock해 실제 claude CLI 없이 동작을 검증한다.
 *
 * 검증 항목:
 *   - parseTimeout: 환경 변수 파싱
 *   - runClaude: 인자 검증, 정상 종료, 비정상 종료, spawn 에러, onEvent 콜백, 타임아웃
 *
 * 외부 npm 패키지 없음. Node.js assert + fs만 사용.
 */

'use strict';

const assert       = require('assert');
const childProcess = require('child_process');
const { EventEmitter } = require('events');

const { runClaude, parseTimeout } = require('../src/providers/claude');

// ---------------------------------------------------------------------------
// 테스트 러너
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// spawn mock 헬퍼
// ---------------------------------------------------------------------------

/**
 * childProcess.spawn을 임시로 교체한다.
 * 모듈 캐시를 공유하므로 providers/claude.js의 spawn도 intercepted된다.
 */
function mockSpawn({ stdoutLines = [], stderr = '', exitCode = 0, delay = 0, spawnError = false } = {}) {
  const originalSpawn = childProcess.spawn;

  childProcess.spawn = function fakeSpawn() {
    const proc = new EventEmitter();

    proc.kill = () => { setImmediate(() => proc.emit('close', null)); };
    proc.stdin  = { write: () => {}, end: () => {} };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();

    setImmediate(() => {
      if (spawnError) {
        proc.emit('error', new Error('spawn ENOENT'));
        return;
      }

      if (stderr) proc.stderr.emit('data', Buffer.from(stderr));

      for (const line of stdoutLines) {
        proc.stdout.emit('data', Buffer.from(line + '\n'));
      }
      proc.stdout.emit('end');

      const doClose = () => proc.emit('close', exitCode);
      if (delay > 0) setTimeout(doClose, delay);
      else setImmediate(doClose);
    });

    return proc;
  };

  return function restore() {
    childProcess.spawn = originalSpawn;
  };
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------

async function main() {

  // -------------------------------------------------------------------------
  // parseTimeout 테스트
  // -------------------------------------------------------------------------

  console.log('\n[parseTimeout]');

  await test('undefined → 기본값 반환', async () => {
    assert.strictEqual(parseTimeout(undefined, 60000), 60000);
  });

  await test('빈 문자열 → 기본값 반환', async () => {
    assert.strictEqual(parseTimeout('', 60000), 60000);
  });

  await test('숫자만 → ms로 해석', async () => {
    assert.strictEqual(parseTimeout('5000', 60000), 5000);
  });

  await test('숫자+ms → ms로 해석', async () => {
    assert.strictEqual(parseTimeout('2000ms', 60000), 2000);
  });

  await test('숫자+s → 초로 해석', async () => {
    assert.strictEqual(parseTimeout('90s', 60000), 90000);
  });

  await test('숫자+m → 분으로 해석', async () => {
    assert.strictEqual(parseTimeout('30m', 60000), 30 * 60 * 1000);
  });

  await test('숫자+h → 시간으로 해석', async () => {
    assert.strictEqual(parseTimeout('1h', 60000), 3600 * 1000);
  });

  await test('잘못된 형식 → 기본값 반환', async () => {
    assert.strictEqual(parseTimeout('abc', 60000), 60000);
  });

  await test('대소문자 무시: 30M → 분', async () => {
    assert.strictEqual(parseTimeout('30M', 60000), 30 * 60 * 1000);
  });

  // -------------------------------------------------------------------------
  // runClaude 인자 검증
  // -------------------------------------------------------------------------

  console.log('\n[runClaude] 인자 검증');

  await test('prompt 미제공 시 TypeError', async () => {
    assert.throws(() => runClaude({}), (e) => e instanceof TypeError && /prompt/.test(e.message));
  });

  await test('prompt 빈 문자열 시 TypeError', async () => {
    assert.throws(() => runClaude({ prompt: '' }), (e) => e instanceof TypeError && /prompt/.test(e.message));
  });

  // -------------------------------------------------------------------------
  // 정상 종료
  // -------------------------------------------------------------------------

  console.log('\n[runClaude] 정상 종료');

  await test('exit code 0 → success:true 반환', async () => {
    const restore = mockSpawn({ exitCode: 0 });
    try {
      const result = await runClaude({ prompt: 'hello' });
      assert.strictEqual(result.success,  true);
      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.error,    undefined);
    } finally {
      restore();
    }
  });

  await test('model 인자 미제공 시 정상 동작', async () => {
    const restore = mockSpawn({ exitCode: 0 });
    try {
      const result = await runClaude({ prompt: 'hi' });
      assert.strictEqual(result.success, true);
    } finally {
      restore();
    }
  });

  await test('model 인자 제공 시 정상 동작', async () => {
    const restore = mockSpawn({ exitCode: 0 });
    try {
      const result = await runClaude({ prompt: 'hi', model: 'claude-sonnet-4-6' });
      assert.strictEqual(result.success, true);
    } finally {
      restore();
    }
  });

  // -------------------------------------------------------------------------
  // onEvent 콜백
  // -------------------------------------------------------------------------

  console.log('\n[runClaude] onEvent 콜백');

  await test('system 이벤트가 onEvent로 전달됨', async () => {
    const systemEvent = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-x' });
    const restore = mockSpawn({ stdoutLines: [systemEvent], exitCode: 0 });
    try {
      const events = [];
      await runClaude({ prompt: 'hi', onEvent: (e) => events.push(e) });
      assert.ok(events.some((e) => e.type === 'system' && e.session_id === 'sess-x'),
                'system 이벤트 수신해야 함');
    } finally {
      restore();
    }
  });

  await test('assistant/result 이벤트가 onEvent로 순서대로 전달됨', async () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }], usage: {} } }),
      JSON.stringify({ type: 'result', result: 'done', total_cost_usd: 0.01 }),
    ];
    const restore = mockSpawn({ stdoutLines: lines, exitCode: 0 });
    try {
      const events = [];
      await runClaude({ prompt: 'hi', onEvent: (e) => events.push(e) });
      assert.strictEqual(events[0].type, 'system');
      assert.strictEqual(events[1].type, 'assistant');
      assert.strictEqual(events[2].type, 'result');
    } finally {
      restore();
    }
  });

  await test('onEvent 미제공 시도 정상 동작 (이벤트 무시)', async () => {
    const systemEvent = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's2' });
    const restore = mockSpawn({ stdoutLines: [systemEvent], exitCode: 0 });
    try {
      const result = await runClaude({ prompt: 'hi' });
      assert.strictEqual(result.success, true);
    } finally {
      restore();
    }
  });

  await test('잘못된 JSON 줄이 있어도 onEvent crash 없이 계속', async () => {
    const lines = [
      'not-json',
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'ok' }),
      'another bad line',
      JSON.stringify({ type: 'result', result: 'done', total_cost_usd: 0 }),
    ];
    const restore = mockSpawn({ stdoutLines: lines, exitCode: 0 });
    try {
      const events = [];
      const result = await runClaude({ prompt: 'hi', onEvent: (e) => events.push(e) });
      assert.strictEqual(result.success, true);
      assert.ok(events.some((e) => e.type === 'system'), 'system 이벤트 수신해야 함');
    } finally {
      restore();
    }
  });

  // -------------------------------------------------------------------------
  // 비정상 종료
  // -------------------------------------------------------------------------

  console.log('\n[runClaude] 비정상 종료');

  await test('exit code 1 → success:false, exitCode:1 반환', async () => {
    const restore = mockSpawn({ exitCode: 1, stderr: 'something went wrong' });
    try {
      const result = await runClaude({ prompt: 'hi' });
      assert.strictEqual(result.success,  false);
      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.error, 'error 필드 존재해야 함');
    } finally {
      restore();
    }
  });

  await test('stderr 내용이 error 필드에 포함됨', async () => {
    const restore = mockSpawn({ exitCode: 2, stderr: 'fatal error message' });
    try {
      const result = await runClaude({ prompt: 'hi' });
      assert.ok(result.error.includes('fatal error message'), `error: ${result.error}`);
    } finally {
      restore();
    }
  });

  await test('stderr 없고 비정상 종료 시 exit code 정보 포함', async () => {
    const restore = mockSpawn({ exitCode: 3, stderr: '' });
    try {
      const result = await runClaude({ prompt: 'hi' });
      assert.strictEqual(result.success,  false);
      assert.strictEqual(result.exitCode, 3);
      assert.ok(result.error.includes('3'), `error: ${result.error}`);
    } finally {
      restore();
    }
  });

  // -------------------------------------------------------------------------
  // spawn 에러
  // -------------------------------------------------------------------------

  console.log('\n[runClaude] spawn 에러');

  await test('spawn error → success:false 반환', async () => {
    const restore = mockSpawn({ spawnError: true });
    try {
      const result = await runClaude({ prompt: 'hi' });
      assert.strictEqual(result.success,  false);
      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.error.includes('spawn ENOENT'), `error: ${result.error}`);
    } finally {
      restore();
    }
  });

  // -------------------------------------------------------------------------
  // 타임아웃
  // -------------------------------------------------------------------------

  console.log('\n[runClaude] 타임아웃');

  await test('MULTICA_AGENT_TIMEOUT 10ms 설정 시 50ms 프로세스는 타임아웃', async () => {
    const orig = process.env.MULTICA_AGENT_TIMEOUT;
    process.env.MULTICA_AGENT_TIMEOUT = '10ms';

    const restore = mockSpawn({ exitCode: 0, delay: 50 });
    try {
      const result = await runClaude({ prompt: 'hi' });
      assert.strictEqual(result.success, false);
      assert.ok(result.error && result.error.includes('timed out'), `error: ${result.error}`);
    } finally {
      restore();
      if (orig === undefined) delete process.env.MULTICA_AGENT_TIMEOUT;
      else process.env.MULTICA_AGENT_TIMEOUT = orig;
    }
  });

  await test('MULTICA_AGENT_TIMEOUT 미설정 시 정상 동작', async () => {
    const orig = process.env.MULTICA_AGENT_TIMEOUT;
    delete process.env.MULTICA_AGENT_TIMEOUT;

    const restore = mockSpawn({ exitCode: 0 });
    try {
      const result = await runClaude({ prompt: 'hi' });
      assert.strictEqual(result.success, true);
    } finally {
      restore();
      if (orig !== undefined) process.env.MULTICA_AGENT_TIMEOUT = orig;
    }
  });

  // -------------------------------------------------------------------------
  // json-schema 모드
  // -------------------------------------------------------------------------

  console.log('\n[runClaude] json-schema 모드');

  await test('jsonSchema 제공 시 structuredOutput 반환', async () => {
    const fakeOutput = JSON.stringify({ structured_output: { answer: 42 } });
    const restore = mockSpawn({ stdoutLines: [fakeOutput], exitCode: 0 });
    try {
      const result = await runClaude({ prompt: 'hi', jsonSchema: '{"type":"object"}' });
      assert.strictEqual(result.success, true);
      assert.ok(result.structuredOutput, 'structuredOutput 존재해야 함');
      assert.strictEqual(result.structuredOutput.answer, 42);
    } finally {
      restore();
    }
  });

  await test('jsonSchema 모드에서 stdout이 유효하지 않은 JSON이면 failure', async () => {
    const restore = mockSpawn({ stdoutLines: ['not-json'], exitCode: 0 });
    try {
      const result = await runClaude({ prompt: 'hi', jsonSchema: '{}' });
      assert.strictEqual(result.success, false);
      assert.ok(result.error && result.error.includes('JSON parse failed'), `error: ${result.error}`);
    } finally {
      restore();
    }
  });

  // -------------------------------------------------------------------------
  // 결과
  // -------------------------------------------------------------------------

  console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
