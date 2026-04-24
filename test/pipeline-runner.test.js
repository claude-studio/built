#!/usr/bin/env node
/**
 * test/pipeline-runner.test.js
 *
 * pipeline-runner.js 단위 테스트 (Node.js assert + fs만 사용, 외부 패키지 없음)
 *
 * spawn 호출을 직접 mock하기 위해 child_process 모듈 객체를 패치한다.
 * pipeline-runner.js가 require('child_process') 모듈 참조를 보유하므로
 * childProcess.spawn 프로퍼티를 교체하면 동일 모듈 캐시를 통해 mock이 동작한다.
 */

'use strict';

const assert       = require('assert');
const fs           = require('fs');
const os           = require('os');
const path         = require('path');
const childProcess = require('child_process');
const { EventEmitter } = require('events');

const { runPipeline, _parseTimeout } = require('../src/pipeline-runner');

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
// 유틸
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pr-test-'));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ---------------------------------------------------------------------------
// spawn mock 헬퍼
// ---------------------------------------------------------------------------

/**
 * childProcess.spawn을 임시로 대체해 가짜 프로세스를 반환한다.
 * pipeline-runner.js는 require('child_process') 모듈 참조를 사용하므로
 * 같은 모듈 캐시 객체의 프로퍼티를 교체하면 mock이 적용된다.
 *
 * @param {object} opts
 * @param {string[]} [opts.stdoutLines]  stdout으로 보낼 줄 배열
 * @param {string}   [opts.stderr]       stderr 내용
 * @param {number}   [opts.exitCode=0]   종료 코드
 * @param {number}   [opts.delay=0]      close 이벤트 지연 (ms)
 * @param {boolean}  [opts.spawnError]   'error' 이벤트 발생 여부
 * @returns {Function} restore — 원래 spawn으로 복원
 */
function mockSpawn({ stdoutLines = [], stderr = '', exitCode = 0, delay = 0, spawnError = false } = {}) {
  const originalSpawn = childProcess.spawn;

  childProcess.spawn = function fakeSpawn() {
    const proc = new EventEmitter();

    // kill mock — SIGTERM 수신 시 exit code null로 close 발생
    proc.kill = (signal) => {
      setImmediate(() => proc.emit('close', null));
    };

    // stdin mock
    proc.stdin = { write: () => {}, end: () => {} };

    // stdout mock
    proc.stdout = new EventEmitter();

    // stderr mock
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
// 메인 테스트 함수
// ---------------------------------------------------------------------------

async function main() {

  // -------------------------------------------------------------------------
  // _parseTimeout 테스트
  // -------------------------------------------------------------------------

  console.log('\n[_parseTimeout] 환경 변수 파싱');

  await test('undefined → 기본값 반환', async () => {
    assert.strictEqual(_parseTimeout(undefined, 60000), 60000);
  });

  await test('빈 문자열 → 기본값 반환', async () => {
    assert.strictEqual(_parseTimeout('', 60000), 60000);
  });

  await test('숫자만 → ms로 해석', async () => {
    assert.strictEqual(_parseTimeout('5000', 60000), 5000);
  });

  await test('숫자+ms → ms로 해석', async () => {
    assert.strictEqual(_parseTimeout('2000ms', 60000), 2000);
  });

  await test('숫자+s → 초로 해석', async () => {
    assert.strictEqual(_parseTimeout('90s', 60000), 90000);
  });

  await test('숫자+m → 분으로 해석', async () => {
    assert.strictEqual(_parseTimeout('30m', 60000), 30 * 60 * 1000);
  });

  await test('숫자+h → 시간으로 해석', async () => {
    assert.strictEqual(_parseTimeout('1h', 60000), 3600 * 1000);
  });

  await test('잘못된 형식 → 기본값 반환', async () => {
    assert.strictEqual(_parseTimeout('abc', 60000), 60000);
  });

  await test('대소문자 무시: 30M → 분', async () => {
    assert.strictEqual(_parseTimeout('30M', 60000), 30 * 60 * 1000);
  });

  // -------------------------------------------------------------------------
  // runPipeline 인자 검증
  // -------------------------------------------------------------------------

  console.log('\n[runPipeline] 인자 검증');

  await test('prompt 미제공 시 TypeError', async () => {
    assert.throws(
      () => runPipeline({ runtimeRoot: '/tmp', featureId: 'f' }),
      (e) => e instanceof TypeError && /prompt/.test(e.message)
    );
  });

  await test('runtimeRoot 미제공 시 TypeError', async () => {
    assert.throws(
      () => runPipeline({ prompt: 'hi', featureId: 'f' }),
      (e) => e instanceof TypeError && /runtimeRoot/.test(e.message)
    );
  });

  await test('featureId 미제공 시 TypeError', async () => {
    assert.throws(
      () => runPipeline({ prompt: 'hi', runtimeRoot: '/tmp' }),
      (e) => e instanceof TypeError && /featureId/.test(e.message)
    );
  });

  // -------------------------------------------------------------------------
  // 정상 종료 (exit code 0)
  // -------------------------------------------------------------------------

  console.log('\n[runPipeline] 정상 종료');

  await test('exit code 0 → success:true 반환', async () => {
    const restore = mockSpawn({ exitCode: 0 });
    const dir = makeTmpDir();
    try {
      const result = await runPipeline({ prompt: 'hello', runtimeRoot: dir, featureId: 'feat' });
      assert.strictEqual(result.success,  true);
      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.error,    undefined);
    } finally {
      restore();
      rmDir(dir);
    }
  });

  await test('stream-json 이벤트 라인을 progress-writer에 전달', async () => {
    const systemEvent = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess_abc' });
    const resultEvent = JSON.stringify({ type: 'result', result: 'done', total_cost_usd: 0.01 });

    const restore = mockSpawn({ stdoutLines: [systemEvent, resultEvent], exitCode: 0 });
    const dir = makeTmpDir();
    try {
      await runPipeline({ prompt: 'hello', runtimeRoot: dir, featureId: 'feat', phase: 'do' });

      const progressPath = path.join(dir, 'progress.json');
      assert.ok(fs.existsSync(progressPath), 'progress.json 존재해야 함');

      const progress = readJson(progressPath);
      assert.strictEqual(progress.feature,    'feat');
      assert.strictEqual(progress.phase,      'do');
      assert.strictEqual(progress.session_id, 'sess_abc');
    } finally {
      restore();
      rmDir(dir);
    }
  });

  await test('model 인자 미제공 시 정상 동작', async () => {
    const restore = mockSpawn({ exitCode: 0 });
    const dir = makeTmpDir();
    try {
      const result = await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f' });
      assert.strictEqual(result.success, true);
    } finally {
      restore();
      rmDir(dir);
    }
  });

  await test('phase 기본값 do로 동작', async () => {
    const systemEvent = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' });
    const restore = mockSpawn({ stdoutLines: [systemEvent], exitCode: 0 });
    const dir = makeTmpDir();
    try {
      await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f' });
      const progress = readJson(path.join(dir, 'progress.json'));
      assert.strictEqual(progress.phase, 'do');
    } finally {
      restore();
      rmDir(dir);
    }
  });

  await test('phase 지정 시 해당 phase 사용', async () => {
    const systemEvent = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's2' });
    const restore = mockSpawn({ stdoutLines: [systemEvent], exitCode: 0 });
    const dir = makeTmpDir();
    try {
      await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f', phase: 'check' });
      const progress = readJson(path.join(dir, 'progress.json'));
      assert.strictEqual(progress.phase, 'check');
    } finally {
      restore();
      rmDir(dir);
    }
  });

  // -------------------------------------------------------------------------
  // 비정상 종료 (exit code != 0)
  // -------------------------------------------------------------------------

  console.log('\n[runPipeline] 비정상 종료');

  await test('exit code 1 → success:false, exitCode:1 반환', async () => {
    const restore = mockSpawn({ exitCode: 1, stderr: 'something went wrong' });
    const dir = makeTmpDir();
    try {
      const result = await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f' });
      assert.strictEqual(result.success,  false);
      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.error, 'error 필드 존재해야 함');
    } finally {
      restore();
      rmDir(dir);
    }
  });

  await test('stderr 내용이 error 필드에 포함됨', async () => {
    const restore = mockSpawn({ exitCode: 2, stderr: 'fatal error message' });
    const dir = makeTmpDir();
    try {
      const result = await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f' });
      assert.ok(result.error.includes('fatal error message'), `error: ${result.error}`);
    } finally {
      restore();
      rmDir(dir);
    }
  });

  await test('stderr 없고 비정상 종료 시 exit code 정보 포함', async () => {
    const restore = mockSpawn({ exitCode: 3, stderr: '' });
    const dir = makeTmpDir();
    try {
      const result = await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f' });
      assert.strictEqual(result.success,  false);
      assert.strictEqual(result.exitCode, 3);
      assert.ok(result.error.includes('3'), `error: ${result.error}`);
    } finally {
      restore();
      rmDir(dir);
    }
  });

  // -------------------------------------------------------------------------
  // spawn 에러 (claude CLI 없음 등)
  // -------------------------------------------------------------------------

  console.log('\n[runPipeline] spawn 에러');

  await test('spawn error → success:false, exitCode:1 반환', async () => {
    const restore = mockSpawn({ spawnError: true });
    const dir = makeTmpDir();
    try {
      const result = await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f' });
      assert.strictEqual(result.success,  false);
      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.error, 'error 필드 존재해야 함');
    } finally {
      restore();
      rmDir(dir);
    }
  });

  await test('spawn error 시 error 필드에 메시지 포함', async () => {
    const restore = mockSpawn({ spawnError: true });
    const dir = makeTmpDir();
    try {
      const result = await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f' });
      assert.ok(result.error.includes('spawn ENOENT'), `error: ${result.error}`);
    } finally {
      restore();
      rmDir(dir);
    }
  });

  // -------------------------------------------------------------------------
  // resultOutputPath 지원
  // -------------------------------------------------------------------------

  console.log('\n[runPipeline] resultOutputPath');

  await test('resultOutputPath 제공 시 result 이벤트 → 파일 생성', async () => {
    const resultEvent = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: '# Done\nWork complete.',
      total_cost_usd: 0.005,
      duration_ms: 1200,
    });

    const restore = mockSpawn({ stdoutLines: [resultEvent], exitCode: 0 });
    const dir = makeTmpDir();
    const outputPath = path.join(dir, 'runs', 'feat', 'do-result.md');
    try {
      await runPipeline({
        prompt: 'do the task',
        runtimeRoot: dir,
        featureId: 'feat',
        resultOutputPath: outputPath,
      });

      assert.ok(fs.existsSync(outputPath), 'do-result.md 파일 생성되어야 함');
      const content = fs.readFileSync(outputPath, 'utf8');
      assert.ok(content.includes('feat'),  'feature_id 포함해야 함');
      assert.ok(content.includes('Done'),  '본문 내용 포함해야 함');
    } finally {
      restore();
      rmDir(dir);
    }
  });

  await test('resultOutputPath 미제공 시도 정상 동작', async () => {
    const resultEvent = JSON.stringify({ type: 'result', result: 'ok', total_cost_usd: 0 });
    const restore = mockSpawn({ stdoutLines: [resultEvent], exitCode: 0 });
    const dir = makeTmpDir();
    try {
      const result = await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f' });
      assert.strictEqual(result.success, true);
    } finally {
      restore();
      rmDir(dir);
    }
  });

  // -------------------------------------------------------------------------
  // MULTICA_AGENT_TIMEOUT 환경 변수
  // -------------------------------------------------------------------------

  console.log('\n[runPipeline] MULTICA_AGENT_TIMEOUT');

  await test('MULTICA_AGENT_TIMEOUT 환경 변수 설정 시 타임아웃 적용', async () => {
    const orig = process.env.MULTICA_AGENT_TIMEOUT;
    process.env.MULTICA_AGENT_TIMEOUT = '10ms';

    // 50ms 지연 프로세스 → 10ms 타임아웃으로 종료
    const restore = mockSpawn({ exitCode: 0, delay: 50 });
    const dir = makeTmpDir();
    try {
      const result = await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f' });
      assert.strictEqual(result.success, false);
      assert.ok(result.error && result.error.includes('timed out'), `error: ${result.error}`);
    } finally {
      restore();
      rmDir(dir);
      if (orig === undefined) delete process.env.MULTICA_AGENT_TIMEOUT;
      else process.env.MULTICA_AGENT_TIMEOUT = orig;
    }
  });

  await test('MULTICA_AGENT_TIMEOUT 미설정 시 기본 30분으로 정상 동작', async () => {
    const orig = process.env.MULTICA_AGENT_TIMEOUT;
    delete process.env.MULTICA_AGENT_TIMEOUT;

    const restore = mockSpawn({ exitCode: 0 });
    const dir = makeTmpDir();
    try {
      const result = await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f' });
      assert.strictEqual(result.success, true);
    } finally {
      restore();
      rmDir(dir);
      if (orig !== undefined) process.env.MULTICA_AGENT_TIMEOUT = orig;
    }
  });

  // -------------------------------------------------------------------------
  // 멀티라인 stdout 청크 처리
  // -------------------------------------------------------------------------

  console.log('\n[runPipeline] stdout 청크 처리');

  await test('여러 이벤트 줄이 있어도 모두 처리', async () => {
    const events = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sx' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }], usage: {} } }),
      JSON.stringify({ type: 'result', result: 'done', total_cost_usd: 0.01 }),
    ];

    const restore = mockSpawn({ stdoutLines: events, exitCode: 0 });
    const dir = makeTmpDir();
    try {
      await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f', phase: 'do' });

      const progress = readJson(path.join(dir, 'progress.json'));
      assert.strictEqual(progress.session_id, 'sx');
      assert.strictEqual(progress.turn,       1);
    } finally {
      restore();
      rmDir(dir);
    }
  });

  await test('잘못된 JSON 라인이 있어도 crash 없이 계속 진행', async () => {
    const events = [
      'not-json-at-all',
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'ok' }),
      'another bad line',
      JSON.stringify({ type: 'result', result: 'done', total_cost_usd: 0 }),
    ];

    const restore = mockSpawn({ stdoutLines: events, exitCode: 0 });
    const dir = makeTmpDir();
    try {
      const result = await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f' });
      assert.strictEqual(result.success, true);

      const progress = readJson(path.join(dir, 'progress.json'));
      assert.strictEqual(progress.session_id, 'ok');
    } finally {
      restore();
      rmDir(dir);
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
