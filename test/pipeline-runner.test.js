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
const { createStandardWriter } = require('../src/providers/standard-writer');
const {
  recordCodexInterruptResult,
  updateActiveCodexTurn,
} = require('../src/codex-active-turn');

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

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
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
function mockSpawn({ stdoutLines = [], stderr = '', exitCode = 0, delay = 0, spawnError = false, onKill } = {}) {
  const originalSpawn = childProcess.spawn;

  childProcess.spawn = function fakeSpawn() {
    const proc = new EventEmitter();

    // kill mock — SIGTERM 수신 시 exit code null로 close 발생
    proc.kill = (signal) => {
      if (typeof onKill === 'function') onKill(signal);
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

  await test('stderr 내용이 failure.debug_detail에 포함됨', async () => {
    const restore = mockSpawn({ exitCode: 2, stderr: 'fatal error message' });
    const dir = makeTmpDir();
    try {
      const result = await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f' });
      assert.ok(result.failure, 'failure 객체 존재해야 함');
      assert.ok(result.failure.debug_detail && result.failure.debug_detail.includes('fatal error message'),
        `debug_detail: ${result.failure && result.failure.debug_detail}`);
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

  await test('permission approval result → success:false 및 do-result.md status=failed', async () => {
    const resultEvent = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: '파일 생성 권한 승인이 필요합니다.',
      total_cost_usd: 0.005,
    });

    const restore = mockSpawn({ stdoutLines: [resultEvent], exitCode: 0 });
    const dir = makeTmpDir();
    const outputPath = path.join(dir, 'runs', 'feat', 'do-result.md');
    try {
      const result = await runPipeline({
        prompt: 'do the task',
        runtimeRoot: dir,
        featureId: 'feat',
        resultOutputPath: outputPath,
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.failure.code, 'claude_permission_request');
      const progress = readJson(path.join(dir, 'progress.json'));
      assert.strictEqual(progress.status, 'failed');
      assert.strictEqual(progress.last_failure.code, 'claude_permission_request');
      const content = fs.readFileSync(outputPath, 'utf8');
      assert.ok(content.includes('status: failed'), content);
    } finally {
      restore();
      rmDir(dir);
    }
  });

  await test('tool_result approval 반복 → success:false, progress failed, do-result.md status=failed', async () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
      JSON.stringify({
        type: 'tool_result',
        tool_use_id: 'toolu_1',
        content: 'This command requires approval',
      }),
      JSON.stringify({
        type: 'tool_result',
        tool_use_id: 'toolu_2',
        content: 'This command requires approval',
      }),
    ];

    let killCount = 0;
    const restore = mockSpawn({
      stdoutLines: lines,
      exitCode: 0,
      delay: 50,
      onKill: () => { killCount++; },
    });
    const dir = makeTmpDir();
    const outputPath = path.join(dir, 'runs', 'feat', 'do-result.md');
    try {
      const result = await runPipeline({
        prompt: 'do the task',
        runtimeRoot: dir,
        featureId: 'feat',
        resultOutputPath: outputPath,
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.failure.code, 'claude_permission_request');
      assert.ok(killCount >= 1, 'provider 프로세스 종료가 호출되어야 함');

      const progress = readJson(path.join(dir, 'progress.json'));
      assert.strictEqual(progress.status, 'failed');
      assert.strictEqual(progress.last_failure.code, 'claude_permission_request');

      const content = fs.readFileSync(outputPath, 'utf8');
      assert.ok(content.includes('status: failed'), content);
      assert.ok(content.includes('Claude가 headless 실행 중'), content);
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
      assert.ok(result.failure, 'failure 객체 존재해야 함');
      assert.strictEqual(result.failure.kind, 'timeout');
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
  // Codex do path
  // -------------------------------------------------------------------------

  console.log('\n[runPipeline] Codex do path');

  /**
   * childProcess.spawnSync을 임시로 대체한다.
   * checkAvailability / checkLogin이 childProcess.spawnSync를 직접 사용하므로
   * 모듈 객체 프로퍼티를 교체해 mock을 적용한다.
   *
   * @param {object[]} responses  호출 순서대로 반환할 결과 배열
   * @returns {Function} restore 함수
   */
  function mockSpawnSync(responses) {
    const originalSpawnSync = childProcess.spawnSync;
    let callIndex = 0;
    childProcess.spawnSync = function fakeSpawnSync() {
      const resp = responses[callIndex] || { status: 0, stdout: '', stderr: '' };
      callIndex++;
      return {
        status: resp.status !== undefined ? resp.status : 0,
        stdout: resp.stdout || '',
        stderr: resp.stderr || '',
        signal: null,
        error:  resp.error  || null,
      };
    };
    return function restore() {
      childProcess.spawnSync = originalSpawnSync;
    };
  }

  /**
   * Codex app-server JSONL 교환을 시뮬레이션하는 가짜 spawn 함수.
   * stdin으로 들어온 JSON-RPC 요청에 순서대로 응답하고
   * turn/start 응답 후 완료 notification을 방출한다.
   *
   * @param {string} resultText  phase_end에 담길 최종 텍스트
   * @returns {Function} _spawnFn으로 사용 가능한 함수
   */
  function makeFakeCodexAppServer(resultText) {
    return function fakeSpawn() {
      const proc = new EventEmitter();
      proc.stdin    = { write: () => {}, end: () => {} };
      proc.stdout   = new EventEmitter();
      proc.stderr   = new EventEmitter();
      proc.killed   = false;
      proc.exitCode = null;
      proc.kill = () => {
        proc.killed = true;
        setImmediate(() => proc.emit('exit', 0, null));
      };

      let writeBuffer  = '';
      let requestCount = 0;

      function sendLine(obj) {
        setImmediate(() => proc.stdout.emit('data', JSON.stringify(obj) + '\n'));
      }

      proc.stdin.write = (data) => {
        writeBuffer += data;
        const lines = writeBuffer.split('\n');
        writeBuffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg;
          try { msg = JSON.parse(line); } catch (_) { continue; }
          if (msg.id === undefined) continue; // notification은 응답 불필요

          requestCount++;
          if (requestCount === 1) {
            // initialize
            sendLine({ id: msg.id, result: {} });
          } else if (requestCount === 2) {
            // thread/start
            sendLine({ id: msg.id, result: { thread: { id: 'thread-pr-test' } } });
          } else if (requestCount === 3) {
            // turn/start → 즉시 응답 후 notifications 방출
            sendLine({ id: msg.id, result: { turn: { id: 'turn-pr-test', status: 'inProgress' } } });
            // notifications: turn/started → item/completed → turn/completed
            setTimeout(() => {
              sendLine({
                method: 'turn/started',
                params: { turn: { id: 'turn-pr-test' }, threadId: 'thread-pr-test' },
              });
              setTimeout(() => {
                sendLine({
                  method: 'item/completed',
                  params: { item: { type: 'agentMessage', text: resultText } },
                });
                setTimeout(() => {
                  sendLine({
                    method: 'turn/completed',
                    params: {
                      turn:     { id: 'turn-pr-test', status: 'completed' },
                      threadId: 'thread-pr-test',
                    },
                  });
                  setTimeout(() => proc.emit('exit', 0, null), 20);
                }, 10);
              }, 10);
            }, 10);
          }
        }
      };

      proc.stdin.end = () => {
        setImmediate(() => {
          if (!proc.killed) proc.emit('exit', 0, null);
        });
      };

      return proc;
    };
  }

  await test('providerSpec={name:codex} — Codex 바이너리 없으면 success:false 반환', async () => {
    // checkAvailability: codex --version → ENOENT
    const restoreSync = mockSpawnSync([
      { status: 1, stdout: '', error: { code: 'ENOENT' } },
    ]);

    const dir = makeTmpDir();
    try {
      const events = [];
      const result = await runPipeline({
        prompt:       'hi',
        runtimeRoot:  dir,
        featureId:    'f',
        phase:        'do',
        providerSpec: { name: 'codex', sandbox: 'workspace-write' },
        resultOutputPath: path.join(dir, 'do-result.md'),
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.error, 'error 메시지 있어야 함');
    } finally {
      restoreSync();
      rmDir(dir);
    }
  });

  await test('providerSpec={name:codex, sandbox:workspace-write} — 정상 실행 시 progress.json + do-result.md 작성', async () => {
    // spawnSync: codex --version ok → app-server --help ok → (checkLogin: 같은 2번) → login status ok
    const restoreSync = mockSpawnSync([
      { status: 0, stdout: '1.0.0' },      // checkAvailability: codex --version
      { status: 0, stdout: 'usage' },      // checkAvailability: codex app-server --help
      { status: 0, stdout: '1.0.0' },      // checkLogin → checkAvailability: codex --version
      { status: 0, stdout: 'usage' },      // checkLogin → checkAvailability: codex app-server --help
      { status: 0, stdout: 'logged in' },  // checkLogin: codex login status
    ]);

    const originalSpawn = childProcess.spawn;
    childProcess.spawn = makeFakeCodexAppServer('구현 완료');

    const root = makeTmpDir();
    const dir = path.join(root, '.built', 'features', 'test-feat');
    const runDir = path.join(root, '.built', 'runtime', 'runs', 'test-feat');
    const previousRuntimeRoot = process.env.BUILT_RUNTIME_ROOT;
    process.env.BUILT_RUNTIME_ROOT = path.join(root, '.built', 'runtime');
    fs.mkdirSync(runDir, { recursive: true });
    writeJson(path.join(runDir, 'state.json'), { feature: 'test-feat', status: 'running', phase: 'do' });
    try {
      const result = await runPipeline({
        prompt:           'test do prompt',
        runtimeRoot:      dir,
        featureId:        'test-feat',
        phase:            'do',
        resultOutputPath: path.join(dir, 'do-result.md'),
        providerSpec:     { name: 'codex', sandbox: 'workspace-write' },
      });

      assert.strictEqual(result.success, true, `success:true 예상, error=${result.error}`);

      const progress = readJson(path.join(dir, 'progress.json'));
      assert.strictEqual(progress.feature, 'test-feat');
      assert.strictEqual(progress.phase,   'do');
      assert.strictEqual(progress.status,  'completed');
      assert.strictEqual(progress.active_provider.threadId, 'thread-pr-test');
      assert.strictEqual(progress.active_provider.turnId, 'turn-pr-test');

      const state = readJson(path.join(runDir, 'state.json'));
      assert.strictEqual(state.active_provider.threadId, 'thread-pr-test');
      assert.strictEqual(state.active_provider.turnId, 'turn-pr-test');

      assert.ok(fs.existsSync(path.join(dir, 'do-result.md')), 'do-result.md 존재');
    } finally {
      restoreSync();
      childProcess.spawn = originalSpawn;
      if (previousRuntimeRoot === undefined) delete process.env.BUILT_RUNTIME_ROOT;
      else process.env.BUILT_RUNTIME_ROOT = previousRuntimeRoot;
      rmDir(root);
    }
  });

  await test('Codex interrupt 실패 error → 최종 progress/state에 codex_interrupt 보존', async () => {
    const root = makeTmpDir();
    const dir = path.join(root, '.built', 'features', 'interrupt-fail');
    const runDir = path.join(root, '.built', 'runtime', 'runs', 'interrupt-fail');
    fs.mkdirSync(runDir, { recursive: true });
    writeJson(path.join(runDir, 'state.json'), { feature: 'interrupt-fail', status: 'running', phase: 'do' });

    const interrupt = {
      attempted: true,
      interrupted: false,
      detail: 'turn/interrupt timed out',
    };
    const writer = createStandardWriter({
      runtimeRoot: dir,
      phase: 'do',
      featureId: 'interrupt-fail',
      resultOutputPath: path.join(dir, 'do-result.md'),
    });

    try {
      writer.handleEvent({ type: 'phase_start', provider: 'codex', model: 'gpt-5.5' });
      const activeProvider = {
        provider: 'codex',
        threadId: 'thread-interrupt-fail',
        turnId: 'turn-interrupt-fail',
        phase: 'do',
        status: 'interrupt_failed',
        cwd: root,
        interrupt,
      };
      updateActiveCodexTurn(runDir, activeProvider);
      writer.handleEvent({
        type: 'provider_metadata',
        provider: 'codex',
        active_provider: activeProvider,
      });
      writer.handleEvent({
        type: 'error',
        message: 'Codex 실행이 25ms 후 타임아웃되었습니다. 작업이 아직 계속될 수 있습니다.',
        codex_interrupt: interrupt,
        failure: {
          kind: 'timeout',
          code: 'codex_timeout',
          retryable: true,
          blocked: false,
          action: 'codex app-server/broker 프로세스를 확인하고 필요하면 수동으로 종료하세요.',
        },
      });
      recordCodexInterruptResult(runDir, interrupt);

      const progress = readJson(path.join(dir, 'progress.json'));
      assert.strictEqual(progress.status, 'failed');
      assert.strictEqual(progress.codex_interrupt.attempted, true);
      assert.strictEqual(progress.codex_interrupt.interrupted, false);
      assert.strictEqual(progress.active_provider.status, 'interrupt_failed');
      assert.strictEqual(progress.active_provider.interrupt.detail, 'turn/interrupt timed out');
      assert.ok(progress.last_error.includes('작업이 아직 계속될 수 있습니다'));

      const state = readJson(path.join(runDir, 'state.json'));
      assert.strictEqual(state.codex_interrupt.attempted, true);
      assert.strictEqual(state.codex_interrupt.interrupted, false);
      assert.strictEqual(state.active_provider.status, 'interrupt_failed');
      assert.strictEqual(state.active_provider.interrupt.detail, 'turn/interrupt timed out');
    } finally {
      writer.close();
      rmDir(root);
    }
  });

  await test('providerSpec={name:codex, sandbox:read-only} + phase=do → success:false (sandbox 정책)', async () => {
    // checkAvailability + login 통과 후 sandbox 검증 실패
    const restoreSync = mockSpawnSync([
      { status: 0, stdout: '1.0.0' },
      { status: 0, stdout: 'usage' },
      { status: 0, stdout: '1.0.0' },
      { status: 0, stdout: 'usage' },
      { status: 0, stdout: 'logged in' },
    ]);

    const dir = makeTmpDir();
    try {
      const result = await runPipeline({
        prompt:       'hi',
        runtimeRoot:  dir,
        featureId:    'f',
        phase:        'do',
        providerSpec: { name: 'codex', sandbox: 'read-only' },
      });

      assert.strictEqual(result.success,   false);
      assert.strictEqual(result.exitCode,  1);
      assert.ok(result.error && result.error.includes('workspace-write'), `error에 workspace-write 언급 없음: ${result.error}`);
    } finally {
      restoreSync();
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
