#!/usr/bin/env node
/**
 * test/providers-codex.test.js
 *
 * src/providers/codex.js 단위 테스트.
 * childProcess.spawnSync / childProcess.spawn을 mock해 실제 Codex CLI 없이 동작을 검증한다.
 *
 * 검증 항목:
 *   - checkAvailability: 바이너리 없음, app-server 미지원, 정상
 *   - checkLogin: 인증 없음, 정상
 *   - _notificationToEvents: item/started, item/completed, turn/completed, error
 *   - runCodex: availability 실패 메시지, login 실패 메시지, 정상 실행 흐름, timeout, interrupt
 *   - sandbox 변환 테이블 (SANDBOX_TO_CODEX)
 *
 * 외부 npm 패키지 없음. Node.js assert만 사용.
 */

'use strict';

const assert       = require('assert');
const childProcess = require('child_process');
const fs           = require('fs');
const net          = require('net');
const os           = require('os');
const path         = require('path');
const { EventEmitter } = require('events');

const {
  checkAvailability,
  checkLogin,
  runCodex,
  interruptCodexTurn,
  MSG_BINARY_NOT_FOUND,
  MSG_APP_SERVER_UNSUPPORTED,
  MSG_AUTH_REQUIRED,
  MSG_WRITE_PHASE_READ_ONLY,
  MSG_INTERRUPTED,
  BROKER_ENDPOINT_ENV,
  SANDBOX_TO_CODEX,
  _notificationToEvents,
  _ensureBrokerSession,
  _cleanupBrokerSession,
  _loadBrokerSession,
  _createBrokerEndpoint,
  _parseBrokerEndpoint,
} = require('../src/providers/codex');

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
    if (e.stack) {
      e.stack.split('\n').slice(1, 4).forEach((l) => console.error(`    ${l}`));
    }
    failed++;
  }
}

// ---------------------------------------------------------------------------
// spawnSync mock 헬퍼
// ---------------------------------------------------------------------------

/**
 * checkAvailability / checkLogin에 주입하는 가짜 spawnSync 함수를 만든다.
 *
 * @param {object[]} responses  호출 순서대로 반환할 결과 배열
 *   각 항목: { status, stdout, stderr, error }
 */
function makeSpawnSyncFn(responses) {
  let callIndex = 0;
  return function fakeSpawnSync(_cmd, _args, _opts) {
    const response = responses[callIndex] || { status: 0, stdout: '', stderr: '' };
    callIndex++;
    return {
      status: response.status !== undefined ? response.status : 0,
      stdout: response.stdout || '',
      stderr: response.stderr || '',
      error:  response.error  || null,
      signal: null,
    };
  };
}

// ---------------------------------------------------------------------------
// fake app-server 헬퍼
// ---------------------------------------------------------------------------

/**
 * runCodex의 _spawnFn으로 주입할 가짜 app-server 프로세스를 만든다.
 *
 * fakeMessages: JSON-RPC 교환을 시뮬레이션하는 메시지 시퀀스.
 * 각 항목은 { type, ... } 으로:
 *   - { type: 'response', id, result }  — 요청에 대한 응답
 *   - { type: 'notification', method, params }  — 서버 → 클라이언트 notification
 *
 * @param {object[]} fakeMessages
 * @returns {function}  _spawnFn으로 사용 가능한 함수
 */
function makeFakeAppServer(fakeMessages) {
  return function fakeSpawn(_cmd, _args, _opts) {
    const proc = new EventEmitter();
    proc.stdin  = { write: () => {}, end: () => {} };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.killed   = false;
    proc.exitCode = null;
    proc.kill = (signal) => {
      proc.killed = true;
      setImmediate(() => proc.emit('exit', null, signal || 'SIGTERM'));
    };

    // stdin에 쓰인 JSON-RPC 메시지를 파싱해 응답을 보내는 로직
    let writeBuffer = '';
    let messageIndex = 0;

    function sendLine(obj) {
      const line = JSON.stringify(obj) + '\n';
      setImmediate(() => proc.stdout.emit('data', line));
    }

    function processNextMessages() {
      while (messageIndex < fakeMessages.length) {
        const msg = fakeMessages[messageIndex];
        messageIndex++;

        if (msg.type === 'response') {
          sendLine({ id: msg.id, result: msg.result || {} });
        } else if (msg.type === 'notification') {
          sendLine({ method: msg.method, params: msg.params || {} });
        }
      }
    }

    proc.stdin.write = (data) => {
      writeBuffer += data;
      // 줄 단위로 처리
      const lines = writeBuffer.split('\n');
      writeBuffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          JSON.parse(line); // 파싱 검증만
          // 요청을 받으면 다음 메시지들을 순서대로 보냄
          setImmediate(() => processNextMessages());
        } catch (_) {}
      }
    };

    // 모든 메시지 전송 후 프로세스 종료
    setImmediate(() => {
      setTimeout(() => {
        if (!proc.killed && proc.exitCode === null) {
          proc.exitCode = 0;
          proc.emit('exit', 0, null);
        }
      }, 200);
    });

    return proc;
  };
}

function makeSequenceAppServer(messageSets) {
  let index = 0;
  return function sequenceSpawn(cmd, args, opts) {
    const messages = messageSets[Math.min(index, messageSets.length - 1)];
    index++;
    return makeFakeAppServer(messages)(cmd, args, opts);
  };
}

function makeTmpDir(prefix = 'built-codex-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

function makeFakeBrokerSpawn({ onSpawn } = {}) {
  let server = null;
  const spawnFn = function fakeBrokerSpawn(_cmd, args, opts) {
    const proc = new EventEmitter();
    proc.pid = 4242;
    proc.killed = false;
    proc.exitCode = null;
    proc.unref = () => {};
    proc.kill = (signal) => {
      proc.killed = true;
      if (server) server.close(() => proc.emit('exit', null, signal || 'SIGTERM'));
      else setImmediate(() => proc.emit('exit', null, signal || 'SIGTERM'));
    };

    const endpoint = args[args.indexOf('--endpoint') + 1];
    const pidFile = args[args.indexOf('--pid-file') + 1];
    const target = _parseBrokerEndpoint(endpoint);
    fs.writeFileSync(pidFile, `${proc.pid}\n`, 'utf8');
    server = net.createServer((socket) => {
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        for (const line of String(chunk).split('\n')) {
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          if (message.id !== undefined) {
            socket.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
          }
        }
      });
    });
    server.listen(target.path);
    if (onSpawn) onSpawn({ args, opts, endpoint, pidFile });
    return proc;
  };
  spawnFn.close = async () => closeServer(server);
  return spawnFn;
}

function makeFakeBrokerAppServer(fakeMessages, onSpawn) {
  let server = null;
  const spawnFn = function fakeBrokerSpawn(_cmd, args, opts) {
    const proc = new EventEmitter();
    proc.pid = 5252;
    proc.killed = false;
    proc.exitCode = null;
    proc.unref = () => {};
    proc.kill = (signal) => {
      proc.killed = true;
      if (server) server.close(() => proc.emit('exit', null, signal || 'SIGTERM'));
      else setImmediate(() => proc.emit('exit', null, signal || 'SIGTERM'));
    };

    const endpoint = args[args.indexOf('--endpoint') + 1];
    const pidFile = args[args.indexOf('--pid-file') + 1];
    const target = _parseBrokerEndpoint(endpoint);
    fs.writeFileSync(pidFile, `${proc.pid}\n`, 'utf8');

    server = net.createServer((socket) => {
      socket.setEncoding('utf8');
      let buffer = '';
      let messageIndex = 0;
      function sendLine(obj) {
        socket.write(`${JSON.stringify(obj)}\n`);
      }
      function processNextMessages() {
        while (messageIndex < fakeMessages.length) {
          const msg = fakeMessages[messageIndex++];
          if (msg.type === 'response') {
            sendLine({ id: msg.id, result: msg.result || {} });
          } else if (msg.type === 'notification') {
            sendLine({ method: msg.method, params: msg.params || {} });
          }
        }
      }
      socket.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          JSON.parse(line);
          setImmediate(processNextMessages);
        }
      });
    });
    server.listen(target.path);
    if (onSpawn) onSpawn({ args, opts, endpoint, pidFile });
    return proc;
  };
  spawnFn.close = async () => closeServer(server);
  return spawnFn;
}

/**
 * 성공적인 app-server 교환을 시뮬레이션하는 메시지 배열을 만든다.
 *
 * 흐름: initialize → thread/start → turn/start → notifications → turn/completed
 *
 * @param {object} [opts]
 * @param {string} [opts.agentText]   agentMessage text
 * @param {string} [opts.turnStatus]  turn/completed status (기본: 'completed')
 */
function makeSuccessMessages(opts = {}) {
  const agentText  = opts.agentText  || '구현 완료';
  const turnStatus = opts.turnStatus || 'completed';

  return [
    // initialize 응답
    { type: 'response', id: 1, result: {} },
    // thread/start 응답
    { type: 'response', id: 2, result: { thread: { id: 'thread-abc' } } },
    // turn/start 응답
    { type: 'response', id: 3, result: { turn: { id: 'turn-xyz', status: 'inProgress' } } },
    // turn/started notification
    { type: 'notification', method: 'turn/started', params: { threadId: 'thread-abc', turn: { id: 'turn-xyz' } } },
    // agentMessage item/completed
    { type: 'notification', method: 'item/completed', params: { threadId: 'thread-abc', item: { type: 'agentMessage', text: agentText } } },
    // turn/completed notification
    { type: 'notification', method: 'turn/completed', params: { threadId: 'thread-abc', turnId: 'turn-xyz', turn: { id: 'turn-xyz', status: turnStatus } } },
  ];
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {

// ---------------------------------------------------------------------------
// checkAvailability
// ---------------------------------------------------------------------------

console.log('\n[checkAvailability]');

await test('codex 바이너리 없음 → available:false, MSG_BINARY_NOT_FOUND', async () => {
  const spawnSyncFn = makeSpawnSyncFn([
    { error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) },
  ]);
  const result = checkAvailability('/tmp', { _spawnSyncFn: spawnSyncFn });
  assert.strictEqual(result.available, false);
  assert.ok(result.detail.includes('@openai/codex'), `메시지 확인: ${result.detail}`);
});

await test('codex --version 실패 (status!=0) → available:false', async () => {
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 1, stderr: 'not found' },
  ]);
  const result = checkAvailability('/tmp', { _spawnSyncFn: spawnSyncFn });
  assert.strictEqual(result.available, false);
  assert.strictEqual(result.detail, MSG_BINARY_NOT_FOUND);
});

await test('app-server --help 실패 → available:false, MSG_APP_SERVER_UNSUPPORTED', async () => {
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },  // version ok
    { status: 1, stderr: 'unknown subcommand' },  // app-server --help fail
  ]);
  const result = checkAvailability('/tmp', { _spawnSyncFn: spawnSyncFn });
  assert.strictEqual(result.available, false);
  assert.strictEqual(result.detail, MSG_APP_SERVER_UNSUPPORTED);
});

await test('정상 — available:true, version detail 포함', async () => {
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'Usage: codex app-server' },
  ]);
  const result = checkAvailability('/tmp', { _spawnSyncFn: spawnSyncFn });
  assert.strictEqual(result.available, true);
  assert.ok(result.detail.includes('codex'), `detail: ${result.detail}`);
});

// ---------------------------------------------------------------------------
// checkLogin
// ---------------------------------------------------------------------------

console.log('\n[checkLogin]');

await test('바이너리 없음 → loggedIn:false, available:false', async () => {
  const spawnSyncFn = makeSpawnSyncFn([
    { error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) },
  ]);
  const result = checkLogin('/tmp', { _spawnSyncFn: spawnSyncFn });
  assert.strictEqual(result.available, false);
  assert.strictEqual(result.loggedIn, false);
});

await test('login status 실패 → loggedIn:false, MSG_AUTH_REQUIRED', async () => {
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },    // version
    { status: 0, stdout: 'app-server ok' },    // app-server --help
    { status: 1, stderr: 'not authenticated' }, // login status
  ]);
  const result = checkLogin('/tmp', { _spawnSyncFn: spawnSyncFn });
  assert.strictEqual(result.available, true);
  assert.strictEqual(result.loggedIn, false);
  assert.ok(result.detail.includes('인증'), `detail: ${result.detail}`);
});

await test('login error (spawnSync error) → loggedIn:false', async () => {
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { error: new Error('spawn error'), status: null },
  ]);
  const result = checkLogin('/tmp', { _spawnSyncFn: spawnSyncFn });
  assert.strictEqual(result.loggedIn, false);
});

await test('정상 — loggedIn:true', async () => {
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated as user@example.com' },
  ]);
  const result = checkLogin('/tmp', { _spawnSyncFn: spawnSyncFn });
  assert.strictEqual(result.available, true);
  assert.strictEqual(result.loggedIn, true);
  assert.ok(result.detail.includes('authenticated'));
});

// ---------------------------------------------------------------------------
// _notificationToEvents — item/started → tool_call
// ---------------------------------------------------------------------------

console.log('\n[_notificationToEvents — tool_call]');

await test('item/started commandExecution → tool_call', async () => {
  const events = _notificationToEvents({
    method: 'item/started',
    params: { threadId: 'th1', item: { id: 'i1', type: 'commandExecution', command: 'npm test' } },
  });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'tool_call');
  assert.strictEqual(events[0].id, 'i1');
  assert.strictEqual(events[0].name, 'commandExecution');
  assert.ok(events[0].summary.includes('npm test'), `summary: ${events[0].summary}`);
  assert.ok(events[0].timestamp, 'timestamp 존재');
});

await test('item/started mcpToolCall → tool_call (server/tool 조합)', async () => {
  const events = _notificationToEvents({
    method: 'item/started',
    params: { item: { id: 'i2', type: 'mcpToolCall', server: 'github', tool: 'read_file' } },
  });
  assert.strictEqual(events[0].type, 'tool_call');
  assert.ok(events[0].summary.includes('github'), `summary: ${events[0].summary}`);
});

await test('item/started fileChange → tool_call', async () => {
  const events = _notificationToEvents({
    method: 'item/started',
    params: { item: { id: 'i3', type: 'fileChange' } },
  });
  assert.strictEqual(events[0].type, 'tool_call');
  assert.strictEqual(events[0].name, 'fileChange');
});

await test('item/started dynamicToolCall → tool_call', async () => {
  const events = _notificationToEvents({
    method: 'item/started',
    params: { item: { id: 'i4', type: 'dynamicToolCall', tool: 'myTool' } },
  });
  assert.strictEqual(events[0].type, 'tool_call');
});

await test('item/started agentMessage → 빈 배열 (tool_call 대상 아님)', async () => {
  const events = _notificationToEvents({
    method: 'item/started',
    params: { item: { type: 'agentMessage', text: 'hello' } },
  });
  assert.strictEqual(events.length, 0);
});

// ---------------------------------------------------------------------------
// _notificationToEvents — item/completed → text_delta / tool_result
// ---------------------------------------------------------------------------

console.log('\n[_notificationToEvents — text_delta / tool_result]');

await test('item/completed agentMessage → text_delta', async () => {
  const events = _notificationToEvents({
    method: 'item/completed',
    params: { item: { type: 'agentMessage', text: '구현을 진행합니다.' } },
  });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'text_delta');
  assert.strictEqual(events[0].text, '구현을 진행합니다.');
});

await test('item/completed agentMessage (빈 text) → 빈 배열', async () => {
  const events = _notificationToEvents({
    method: 'item/completed',
    params: { item: { type: 'agentMessage', text: '' } },
  });
  assert.strictEqual(events.length, 0);
});

await test('item/completed commandExecution → tool_result', async () => {
  const events = _notificationToEvents({
    method: 'item/completed',
    params: { item: { id: 'i1', type: 'commandExecution', command: 'npm test', status: 'completed', exitCode: 0 } },
  });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'tool_result');
  assert.strictEqual(events[0].id, 'i1');
  assert.strictEqual(events[0].status, 'completed');
  assert.strictEqual(events[0].exit_code, 0);
});

await test('item/completed fileChange → tool_result', async () => {
  const events = _notificationToEvents({
    method: 'item/completed',
    params: { item: { id: 'i3', type: 'fileChange', status: 'completed' } },
  });
  assert.strictEqual(events[0].type, 'tool_result');
  assert.strictEqual(events[0].name, 'fileChange');
});

// ---------------------------------------------------------------------------
// _notificationToEvents — turn/completed → phase_end
// ---------------------------------------------------------------------------

console.log('\n[_notificationToEvents — phase_end / error]');

await test('turn/completed(completed) → phase_end(completed)', async () => {
  const events = _notificationToEvents({
    method: 'turn/completed',
    params: { threadId: 'th1', turn: { id: 'turn1', status: 'completed' } },
  });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'phase_end');
  assert.strictEqual(events[0].status, 'completed');
  assert.strictEqual(events[0].threadId, 'th1');
  assert.strictEqual(events[0].turnId, 'turn1');
});

await test('turn/completed(interrupted) → phase_end(interrupted)', async () => {
  const events = _notificationToEvents({
    method: 'turn/completed',
    params: { turn: { id: 'turn2', status: 'interrupted' } },
  });
  assert.strictEqual(events[0].status, 'interrupted');
});

await test('error notification → error 이벤트', async () => {
  const events = _notificationToEvents({
    method: 'error',
    params: { error: { message: '연결 오류' } },
  });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'error');
  assert.ok(events[0].message.includes('연결 오류'));
  assert.strictEqual(events[0].retryable, false);
});

await test('error notification 메시지의 민감정보(sk- 키)를 마스킹한다', async () => {
  const sensitiveMsg = 'auth failed: sk-abcdefghijklmnopqrstuvwxyz1234567890';
  const events = _notificationToEvents({
    method: 'error',
    params: { error: { message: sensitiveMsg } },
  });
  assert.strictEqual(events.length, 1);
  assert.ok(!events[0].message.includes('sk-abcdef'), `민감정보 노출: ${events[0].message}`);
});

await test('error notification 메시지의 홈 경로를 마스킹한다', async () => {
  const events = _notificationToEvents({
    method: 'error',
    params: { error: { message: 'file not found: /Users/alice/projects/app/config.json' } },
  });
  assert.strictEqual(events.length, 1);
  assert.ok(!events[0].message.includes('/Users/alice/'), `홈 경로 노출: ${events[0].message}`);
});

await test('error notification 메시지가 없으면 기본 메시지 반환', async () => {
  const events = _notificationToEvents({
    method: 'error',
    params: { error: {} },
  });
  assert.strictEqual(events[0].message, 'Codex app-server error');
});

await test('알 수 없는 method → 빈 배열', async () => {
  const events = _notificationToEvents({ method: 'thread/started', params: {} });
  assert.strictEqual(events.length, 0);
});

await test('null/undefined input → 빈 배열', async () => {
  assert.strictEqual(_notificationToEvents(null).length, 0);
  assert.strictEqual(_notificationToEvents(undefined).length, 0);
  assert.strictEqual(_notificationToEvents({}).length, 0);
});

// ---------------------------------------------------------------------------
// sandbox 변환 테이블
// ---------------------------------------------------------------------------

console.log('\n[SANDBOX_TO_CODEX 변환]');

await test('read-only → readOnly', async () => {
  assert.strictEqual(SANDBOX_TO_CODEX['read-only'], 'readOnly');
});

await test('workspace-write → workspaceWrite', async () => {
  assert.strictEqual(SANDBOX_TO_CODEX['workspace-write'], 'workspaceWrite');
});

// ---------------------------------------------------------------------------
// 실패 메시지 상수
// ---------------------------------------------------------------------------

console.log('\n[실패 메시지 상수]');

await test('MSG_BINARY_NOT_FOUND — @openai/codex 포함', async () => {
  assert.ok(MSG_BINARY_NOT_FOUND.includes('@openai/codex'));
});

await test('MSG_APP_SERVER_UNSUPPORTED — app-server 관련 메시지', async () => {
  assert.ok(MSG_APP_SERVER_UNSUPPORTED.includes('app-server'));
});

await test('MSG_AUTH_REQUIRED — 인증 관련 메시지', async () => {
  assert.ok(MSG_AUTH_REQUIRED.includes('인증'));
});

await test('MSG_WRITE_PHASE_READ_ONLY — workspace-write 언급', async () => {
  assert.ok(MSG_WRITE_PHASE_READ_ONLY.includes('workspace-write'));
});

// ---------------------------------------------------------------------------
// broker lifecycle
// ---------------------------------------------------------------------------

console.log('\n[broker lifecycle]');

await test('broker endpoint 생성/파싱 — unix endpoint', async () => {
  const sessionDir = makeTmpDir('built-broker-endpoint-');
  const endpoint = _createBrokerEndpoint(sessionDir, 'linux');
  const parsed = _parseBrokerEndpoint(endpoint);
  assert.strictEqual(parsed.kind, 'unix');
  assert.ok(parsed.path.endsWith('broker.sock'), `path: ${parsed.path}`);
});

await test('ensureBrokerSession — broker process 시작, endpoint/env/pid/log state 저장', async () => {
  const cwd = makeTmpDir('built-broker-project-');
  let captured = null;
  const brokerSpawn = makeFakeBrokerSpawn({ onSpawn: (info) => { captured = info; } });

  try {
    const result = await _ensureBrokerSession(cwd, {
      _spawnFn: brokerSpawn,
      readyTimeoutMs: 1000,
    });

    assert.ok(result.session, `session 생성 실패: ${result.cleanupError}`);
    assert.ok(result.session.endpoint.startsWith('unix:'), `endpoint: ${result.session.endpoint}`);
    assert.ok(captured, 'spawn 정보 캡처됨');
    assert.strictEqual(captured.opts.env[BROKER_ENDPOINT_ENV], result.session.endpoint);
    assert.ok(fs.existsSync(result.session.pidFile), 'pid file 생성됨');
    assert.ok(fs.existsSync(result.session.logFile), 'log file 생성됨');

    const saved = _loadBrokerSession(cwd);
    assert.strictEqual(saved.endpoint, result.session.endpoint);

    const cleanup = await _cleanupBrokerSession(cwd, result.session);
    assert.strictEqual(cleanup.ok, true, `cleanup errors: ${cleanup.errors}`);
    assert.strictEqual(_loadBrokerSession(cwd), null);
  } finally {
    await brokerSpawn.close();
  }
});

await test('ensureBrokerSession — stale broker state cleanup 후 새 session 시작', async () => {
  const cwd = makeTmpDir('built-broker-stale-');
  const staleDir = makeTmpDir('built-stale-session-');
  const staleEndpoint = _createBrokerEndpoint(staleDir, 'linux');
  const staleStateDir = path.join(cwd, '.built', 'runtime');
  fs.mkdirSync(staleStateDir, { recursive: true });
  fs.writeFileSync(path.join(staleDir, 'broker.pid'), '999999\n', 'utf8');
  fs.writeFileSync(path.join(staleDir, 'broker.log'), '', 'utf8');
  fs.writeFileSync(path.join(staleStateDir, 'codex-broker.json'), JSON.stringify({
    endpoint: staleEndpoint,
    pidFile: path.join(staleDir, 'broker.pid'),
    logFile: path.join(staleDir, 'broker.log'),
    sessionDir: staleDir,
    pid: 999999,
  }), 'utf8');

  const brokerSpawn = makeFakeBrokerSpawn();
  try {
    const result = await _ensureBrokerSession(cwd, {
      _spawnFn: brokerSpawn,
      readyTimeoutMs: 1000,
    });
    assert.ok(result.session, `session 생성 실패: ${result.cleanupError}`);
    assert.notStrictEqual(result.session.endpoint, staleEndpoint);
    assert.ok(!fs.existsSync(path.join(staleDir, 'broker.pid')), 'stale pid file 제거됨');
    await _cleanupBrokerSession(cwd, result.session);
  } finally {
    await brokerSpawn.close();
  }
});

await test('ensureBrokerSession — cleanup 실패를 cleanupError로 반환', async () => {
  const cwd = makeTmpDir('built-broker-cleanup-fail-');
  const staleDir = makeTmpDir('built-stale-fail-');
  const stateDir = path.join(cwd, '.built', 'runtime');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(staleDir, 'leftover'), { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'codex-broker.json'), JSON.stringify({
    endpoint: _createBrokerEndpoint(staleDir, 'linux'),
    pidFile: path.join(staleDir, 'broker.pid'),
    logFile: path.join(staleDir, 'broker.log'),
    sessionDir: staleDir,
    pid: 999999,
  }), 'utf8');

  const result = await _ensureBrokerSession(cwd, {
    _spawnFn: makeFakeBrokerSpawn(),
    readyTimeoutMs: 100,
  });
  assert.strictEqual(result.session, null);
  assert.ok(result.cleanupError, 'cleanupError가 반환되어야 함');
});

// ---------------------------------------------------------------------------
// runCodex — availability 실패
// ---------------------------------------------------------------------------

console.log('\n[runCodex — 실패 경로]');

await test('availability 실패 → error 이벤트 emit + success:false 반환', async () => {
  const events = [];
  const spawnSyncFn = makeSpawnSyncFn([
    { error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) },
  ]);
  const result = await runCodex({
    prompt:       '테스트',
    cwd:          '/tmp',
    onEvent:      (e) => events.push(e),
    _spawnSyncFn: spawnSyncFn,
  });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.exitCode, 1);
  assert.ok(result.error.includes('@openai/codex'), `error: ${result.error}`);
  const errEvent = events.find((e) => e.type === 'error');
  assert.ok(errEvent, 'error 이벤트 emit됨');
  assert.ok(errEvent.message.includes('@openai/codex'));
});

await test('login 실패 → error 이벤트 emit + success:false 반환', async () => {
  const events = [];
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },  // version ok
    { status: 0, stdout: 'app-server ok' },  // app-server --help ok
    { status: 1, stderr: 'not logged in' },  // login status fail
  ]);
  const result = await runCodex({
    prompt:       '테스트',
    cwd:          '/tmp',
    onEvent:      (e) => events.push(e),
    _spawnSyncFn: spawnSyncFn,
  });
  assert.strictEqual(result.success, false);
  assert.ok(result.error.includes('인증'), `error: ${result.error}`);
  const errEvent = events.find((e) => e.type === 'error');
  assert.ok(errEvent, 'error 이벤트 emit됨');
});

await test('prompt 미제공 → TypeError', async () => {
  assert.throws(() => runCodex({}), TypeError);
  assert.throws(() => runCodex({ prompt: '' }), TypeError);
});

// ---------------------------------------------------------------------------
// runCodex — 정상 실행 흐름
// ---------------------------------------------------------------------------

console.log('\n[runCodex — 정상 실행]');

await test('정상 실행 — phase_start, text_delta, phase_end 이벤트 순서', async () => {
  const events = [];
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated' },
  ]);
  const spawnFn = makeFakeAppServer(makeSuccessMessages({ agentText: '작업 완료' }));

  const result = await runCodex({
    prompt:       '코드를 구현해줘',
    cwd:          '/tmp',
    onEvent:      (e) => events.push(e),
    _spawnSyncFn: spawnSyncFn,
    _spawnFn:     spawnFn,
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.exitCode, 0);

  const types = events.map((e) => e.type);
  assert.ok(types.includes('phase_start'), `phase_start 없음: ${types}`);
  assert.ok(types.includes('text_delta'),  `text_delta 없음: ${types}`);
  assert.ok(types.includes('phase_end'),   `phase_end 없음: ${types}`);

  const phaseStart = events.find((e) => e.type === 'phase_start');
  assert.strictEqual(phaseStart.provider, 'codex');

  const textDelta = events.find((e) => e.type === 'text_delta');
  assert.strictEqual(textDelta.text, '작업 완료');

  const phaseEnd = events.find((e) => e.type === 'phase_end');
  assert.strictEqual(phaseEnd.status, 'completed');
});

await test('broker 경유 정상 실행 — broker endpoint로 app-server JSON-RPC 연결', async () => {
  const cwd = makeTmpDir('built-run-broker-');
  const events = [];
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated' },
  ]);
  const brokerSpawn = makeFakeBrokerAppServer(makeSuccessMessages({ agentText: 'broker 완료' }));

  try {
    const result = await runCodex({
      prompt:         '브로커 경유 실행',
      cwd,
      onEvent:        (e) => events.push(e),
      _spawnSyncFn:   spawnSyncFn,
      _brokerSpawnFn: brokerSpawn,
    });

    assert.strictEqual(result.success, true, result.error || '');
    assert.strictEqual(result.text, 'broker 완료');
    assert.ok(_loadBrokerSession(cwd), 'broker session state 저장됨');
    const phaseEnd = events.find((e) => e.type === 'phase_end');
    assert.ok(phaseEnd, 'phase_end 수신됨');
  } finally {
    const session = _loadBrokerSession(cwd);
    if (session) await _cleanupBrokerSession(cwd, session);
    await brokerSpawn.close();
  }
});

await test('정상 실행 — result.text에 마지막 agentMessage 포함', async () => {
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated' },
  ]);
  const spawnFn = makeFakeAppServer(makeSuccessMessages({ agentText: '최종 답변입니다.' }));

  const result = await runCodex({
    prompt:       '질문',
    cwd:          '/tmp',
    _spawnSyncFn: spawnSyncFn,
    _spawnFn:     spawnFn,
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.text, '최종 답변입니다.');
});

await test('정상 실행 — providerMeta에 threadId/turnId 포함', async () => {
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated' },
  ]);
  const spawnFn = makeFakeAppServer(makeSuccessMessages());

  const result = await runCodex({
    prompt:       '테스트',
    cwd:          '/tmp',
    _spawnSyncFn: spawnSyncFn,
    _spawnFn:     spawnFn,
  });

  assert.ok(result.providerMeta, 'providerMeta 존재');
  assert.strictEqual(result.providerMeta.threadId, 'thread-abc');
  assert.ok(result.providerMeta.duration_ms >= 0, 'duration_ms 존재');
});

await test('정상 실행 — model 파라미터가 thread/start에 전달됨 (phase_start에 model 포함)', async () => {
  const events = [];
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated' },
  ]);
  const spawnFn = makeFakeAppServer(makeSuccessMessages());

  await runCodex({
    prompt:       '테스트',
    model:        'gpt-5.5',
    cwd:          '/tmp',
    onEvent:      (e) => events.push(e),
    _spawnSyncFn: spawnSyncFn,
    _spawnFn:     spawnFn,
  });

  const phaseStart = events.find((e) => e.type === 'phase_start');
  assert.strictEqual(phaseStart.model, 'gpt-5.5');
});

await test('turn 즉시 완료 (inProgress 아닌 status) → phase_end emit + success:true', async () => {
  const events = [];
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated' },
  ]);

  // turn/start 응답에서 즉시 completed 반환
  const immediateMessages = [
    { type: 'response', id: 1, result: {} },                              // initialize
    { type: 'response', id: 2, result: { thread: { id: 'th1' } } },      // thread/start
    { type: 'response', id: 3, result: { turn: { id: 't1', status: 'completed' } } }, // turn/start immediate
  ];
  const spawnFn = makeFakeAppServer(immediateMessages);

  const result = await runCodex({
    prompt:       '테스트',
    cwd:          '/tmp',
    onEvent:      (e) => events.push(e),
    _spawnSyncFn: spawnSyncFn,
    _spawnFn:     spawnFn,
  });

  assert.strictEqual(result.success, true);
  const phaseEnd = events.find((e) => e.type === 'phase_end');
  assert.ok(phaseEnd, 'phase_end 이벤트 emit됨');
  assert.strictEqual(phaseEnd.status, 'completed');
});

// ---------------------------------------------------------------------------
// runCodex — app-server 오류
// ---------------------------------------------------------------------------

console.log('\n[runCodex — app-server 오류 경로]');

await test('error notification → error 이벤트 emit + success:false', async () => {
  const events = [];
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated' },
  ]);

  const errorMessages = [
    { type: 'response', id: 1, result: {} },
    { type: 'response', id: 2, result: { thread: { id: 'th1' } } },
    { type: 'response', id: 3, result: { turn: { id: 't1', status: 'inProgress' } } },
    { type: 'notification', method: 'error', params: { error: { message: 'Codex internal error' } } },
  ];
  const spawnFn = makeFakeAppServer(errorMessages);

  const result = await runCodex({
    prompt:       '테스트',
    cwd:          '/tmp',
    onEvent:      (e) => events.push(e),
    _spawnSyncFn: spawnSyncFn,
    _spawnFn:     spawnFn,
  });

  assert.strictEqual(result.success, false);
  const errEvent = events.find((e) => e.type === 'error');
  assert.ok(errEvent, 'error 이벤트 존재');
  assert.ok(errEvent.message.includes('Codex internal error'), `message: ${errEvent.message}`);
});

await test('app-server 프로세스 비정상 종료 → error 이벤트 + success:false', async () => {
  const events = [];
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated' },
  ]);

  // 프로세스가 initialize 이후 바로 비정상 종료
  const spawnFn = function crashingSpawn() {
    const proc = new EventEmitter();
    proc.stdin  = { write: () => {}, end: () => {} };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.killed   = false;
    proc.exitCode = null;
    proc.kill     = () => {};

    let callCount = 0;
    proc.stdin.write = (data) => {
      callCount++;
      if (callCount === 1) {
        // initialize 응답 후 비정상 종료
        setImmediate(() => {
          proc.stdout.emit('data', JSON.stringify({ id: 1, result: {} }) + '\n');
          setTimeout(() => {
            proc.exitCode = 1;
            proc.emit('exit', 1, null);
          }, 10);
        });
      }
    };
    return proc;
  };

  const result = await runCodex({
    prompt:       '테스트',
    cwd:          '/tmp',
    onEvent:      (e) => events.push(e),
    _spawnSyncFn: spawnSyncFn,
    _spawnFn:     spawnFn,
  });

  assert.strictEqual(result.success, false);
});

await test('broker 경유 timeout → broker session state cleanup 후 후속 실행 가능', async () => {
  const cwd = makeTmpDir('built-run-broker-timeout-');
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated' },
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated' },
  ]);

  const hangingMessages = [
    { type: 'response', id: 1, result: {} },
    { type: 'response', id: 2, result: { thread: { id: 'th-timeout' } } },
    { type: 'response', id: 3, result: { turn: { id: 'turn-timeout', status: 'inProgress' } } },
    { type: 'notification', method: 'turn/started', params: { threadId: 'th-timeout', turn: { id: 'turn-timeout' } } },
  ];
  const hangingBroker = makeFakeBrokerAppServer(hangingMessages);

  try {
    const timeoutResult = await runCodex({
      prompt:         'timeout',
      cwd,
      timeout_ms:     50,
      _spawnSyncFn:   spawnSyncFn,
      _brokerSpawnFn: hangingBroker,
    });
    assert.strictEqual(timeoutResult.success, false);
    assert.ok(timeoutResult.error.includes('타임아웃'), `error: ${timeoutResult.error}`);
    assert.strictEqual(_loadBrokerSession(cwd), null, 'timeout 이후 broker session state 제거됨');
  } finally {
    await hangingBroker.close();
  }

  const successBroker = makeFakeBrokerAppServer(makeSuccessMessages({ agentText: '후속 실행 완료' }));
  try {
    const retryResult = await runCodex({
      prompt:         'retry',
      cwd,
      _spawnSyncFn:   spawnSyncFn,
      _brokerSpawnFn: successBroker,
    });
    assert.strictEqual(retryResult.success, true, retryResult.error || '');
    assert.strictEqual(retryResult.text, '후속 실행 완료');
  } finally {
    const session = _loadBrokerSession(cwd);
    if (session) await _cleanupBrokerSession(cwd, session);
    await successBroker.close();
  }
});

await test('timeout retry → 중간 error event 없이 최종 성공 이벤트만 flush + retry log 기록', async () => {
  const events = [];
  const logLines = [];
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated' },
  ]);
  const hangingMessages = [
    { type: 'response', id: 1, result: {} },
    { type: 'response', id: 2, result: { thread: { id: 'th-retry' } } },
    { type: 'response', id: 3, result: { turn: { id: 'turn-retry', status: 'inProgress' } } },
    { type: 'notification', method: 'turn/started', params: { threadId: 'th-retry', turn: { id: 'turn-retry' } } },
  ];
  const spawnFn = makeSequenceAppServer([
    hangingMessages,
    makeSuccessMessages({ agentText: 'retry 성공' }),
  ]);

  const result = await runCodex({
    prompt:         'retry 테스트',
    cwd:            '/tmp',
    timeout_ms:     25,
    max_retries:    1,
    retry_delay_ms: 0,
    onEvent:        (e) => events.push(e),
    logger:         { warn: (line) => logLines.push(line) },
    _spawnSyncFn:   spawnSyncFn,
    _spawnFn:       spawnFn,
  });

  assert.strictEqual(result.success, true, result.error || '');
  assert.strictEqual(result.text, 'retry 성공');
  assert.strictEqual(result.providerMeta.retry.attempts, 2);
  assert.strictEqual(result.providerMeta.retry.log.length, 1);
  assert.ok(result.providerMeta.retry.log[0].code.includes('timeout'), JSON.stringify(result.providerMeta.retry.log[0]));
  assert.strictEqual(logLines.length, 1);
  assert.ok(!events.some((e) => e.type === 'error'), `중간 retry error는 emit되면 안 됨: ${JSON.stringify(events)}`);
  assert.deepStrictEqual(events.map((e) => e.type), ['phase_start', 'text_delta', 'phase_end']);
});

await test('AbortSignal abort → adapter가 interrupted error로 종료하고 terminal 이후 이벤트 없음', async () => {
  const events = [];
  const controller = new AbortController();
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated' },
  ]);
  const hangingMessages = [
    { type: 'response', id: 1, result: {} },
    { type: 'response', id: 2, result: { thread: { id: 'th-abort' } } },
    { type: 'response', id: 3, result: { turn: { id: 'turn-abort', status: 'inProgress' } } },
    { type: 'notification', method: 'turn/started', params: { threadId: 'th-abort', turn: { id: 'turn-abort' } } },
  ];
  const spawnFn = makeFakeAppServer(hangingMessages);
  setTimeout(() => controller.abort(), 20);

  const result = await runCodex({
    prompt:       'abort 테스트',
    cwd:          '/tmp',
    timeout_ms:   500,
    signal:       controller.signal,
    onEvent:      (e) => events.push(e),
    _spawnSyncFn: spawnSyncFn,
    _spawnFn:     spawnFn,
  });

  assert.strictEqual(result.success, false);
  assert.ok(result.error.includes('중단'), result.error);
  const errorIndex = events.findIndex((e) => e.type === 'error');
  assert.ok(errorIndex >= 0, 'interrupted error 이벤트가 필요함');
  assert.strictEqual(events[errorIndex].failure.kind, 'interrupted');
  assert.strictEqual(events[errorIndex].retryable, false);
  assert.strictEqual(events.length, errorIndex + 1, `terminal 이후 이벤트 금지: ${JSON.stringify(events)}`);
  assert.strictEqual(events[errorIndex].message, MSG_INTERRUPTED);
});

// ---------------------------------------------------------------------------
// runCodex — tool_call/tool_result 이벤트 흐름
// ---------------------------------------------------------------------------

console.log('\n[runCodex — tool_call/tool_result 이벤트]');

await test('item/started commandExecution → tool_call, item/completed → tool_result 순서', async () => {
  const events = [];
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated' },
  ]);

  const messages = [
    { type: 'response', id: 1, result: {} },
    { type: 'response', id: 2, result: { thread: { id: 'th1' } } },
    { type: 'response', id: 3, result: { turn: { id: 't1', status: 'inProgress' } } },
    { type: 'notification', method: 'turn/started', params: { threadId: 'th1', turn: { id: 't1' } } },
    { type: 'notification', method: 'item/started',   params: { item: { id: 'cmd1', type: 'commandExecution', command: 'npm test' } } },
    { type: 'notification', method: 'item/completed', params: { item: { id: 'cmd1', type: 'commandExecution', command: 'npm test', status: 'completed', exitCode: 0 } } },
    { type: 'notification', method: 'item/completed', params: { item: { type: 'agentMessage', text: '테스트 통과' } } },
    { type: 'notification', method: 'turn/completed', params: { threadId: 'th1', turn: { id: 't1', status: 'completed' } } },
  ];
  const spawnFn = makeFakeAppServer(messages);

  await runCodex({
    prompt:       '테스트',
    cwd:          '/tmp',
    onEvent:      (e) => events.push(e),
    _spawnSyncFn: spawnSyncFn,
    _spawnFn:     spawnFn,
  });

  const types = events.map((e) => e.type);
  const toolCallIdx   = types.indexOf('tool_call');
  const toolResultIdx = types.indexOf('tool_result');
  const textDeltaIdx  = types.indexOf('text_delta');
  const phaseEndIdx   = types.indexOf('phase_end');

  assert.ok(toolCallIdx   >= 0, `tool_call 없음: ${types}`);
  assert.ok(toolResultIdx >= 0, `tool_result 없음: ${types}`);
  assert.ok(toolCallIdx < toolResultIdx, 'tool_call이 tool_result보다 먼저여야 함');
  assert.ok(textDeltaIdx  > toolResultIdx, 'text_delta가 tool_result 다음이어야 함');
  assert.ok(phaseEndIdx   > textDeltaIdx,  'phase_end가 마지막이어야 함');

  const toolCall = events[toolCallIdx];
  assert.strictEqual(toolCall.name, 'commandExecution');
  assert.ok(toolCall.summary.includes('npm test'), `tool_call summary: ${toolCall.summary}`);

  const toolResult = events[toolResultIdx];
  assert.strictEqual(toolResult.id, 'cmd1');
  assert.strictEqual(toolResult.exit_code, 0);
});

// ---------------------------------------------------------------------------
// runCodex — do/iter + read-only sandbox 검증
// ---------------------------------------------------------------------------

console.log('\n[runCodex — do/iter + read-only 검증]');

await test('phase=do + sandbox=read-only → MSG_WRITE_PHASE_READ_ONLY 에러 emit + success:false', async () => {
  const events = [];
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated' },
  ]);

  const result = await runCodex({
    prompt:       '테스트',
    phase:        'do',
    sandbox:      'read-only',
    cwd:          '/tmp',
    onEvent:      (e) => events.push(e),
    _spawnSyncFn: spawnSyncFn,
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.exitCode, 1);
  assert.ok(result.error.includes('workspace-write'), `error: ${result.error}`);
  const errEvent = events.find((e) => e.type === 'error');
  assert.ok(errEvent, 'error 이벤트 emit됨');
  assert.ok(errEvent.message.includes('workspace-write'), `message: ${errEvent.message}`);
});

await test('phase=iter + sandbox=read-only → MSG_WRITE_PHASE_READ_ONLY 에러 emit', async () => {
  const events = [];
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated' },
  ]);

  const result = await runCodex({
    prompt:       '테스트',
    phase:        'iter',
    sandbox:      'read-only',
    cwd:          '/tmp',
    onEvent:      (e) => events.push(e),
    _spawnSyncFn: spawnSyncFn,
  });

  assert.strictEqual(result.success, false);
  const errEvent = events.find((e) => e.type === 'error');
  assert.ok(errEvent && errEvent.message.includes('workspace-write'));
});

await test('phase=do + sandbox=workspace-write → 정상 진행 (reject 안 함)', async () => {
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated' },
  ]);
  const spawnFn = makeFakeAppServer(makeSuccessMessages());

  const result = await runCodex({
    prompt:       '테스트',
    phase:        'do',
    sandbox:      'workspace-write',
    cwd:          '/tmp',
    _spawnSyncFn: spawnSyncFn,
    _spawnFn:     spawnFn,
  });

  assert.strictEqual(result.success, true, `do+workspace-write는 정상 실행: ${result.error}`);
});

await test('phase=plan_synthesis + sandbox=read-only → 정상 진행 (do/iter 아님)', async () => {
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated' },
  ]);
  const spawnFn = makeFakeAppServer(makeSuccessMessages());

  const result = await runCodex({
    prompt:       '테스트',
    phase:        'plan_synthesis',
    sandbox:      'read-only',
    cwd:          '/tmp',
    _spawnSyncFn: spawnSyncFn,
    _spawnFn:     spawnFn,
  });

  assert.strictEqual(result.success, true, `plan_synthesis+read-only는 정상 실행: ${result.error}`);
});

// ---------------------------------------------------------------------------
// runCodex — phase 필드가 이벤트에 포함
// ---------------------------------------------------------------------------

console.log('\n[runCodex — phase 필드 이벤트 포함]');

await test('phase 파라미터 제공 시 모든 이벤트에 phase 필드 포함', async () => {
  const events = [];
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated' },
  ]);
  const spawnFn = makeFakeAppServer(makeSuccessMessages({ agentText: '완료' }));

  await runCodex({
    prompt:       '테스트',
    phase:        'do',
    sandbox:      'workspace-write',
    cwd:          '/tmp',
    onEvent:      (e) => events.push(e),
    _spawnSyncFn: spawnSyncFn,
    _spawnFn:     spawnFn,
  });

  assert.ok(events.length > 0, '이벤트 수신됨');
  for (const evt of events) {
    assert.strictEqual(evt.phase, 'do', `phase 필드 없음: ${JSON.stringify(evt)}`);
  }
});

await test('phase 파라미터 미제공 시 이벤트에 phase 필드 없음', async () => {
  const events = [];
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated' },
  ]);
  const spawnFn = makeFakeAppServer(makeSuccessMessages());

  await runCodex({
    prompt:       '테스트',
    cwd:          '/tmp',
    onEvent:      (e) => events.push(e),
    _spawnSyncFn: spawnSyncFn,
    _spawnFn:     spawnFn,
  });

  for (const evt of events) {
    assert.ok(!('phase' in evt), `phase 필드가 있으면 안 됨: ${JSON.stringify(evt)}`);
  }
});

// ---------------------------------------------------------------------------
// runCodex — phase_end.duration_ms 보강
// ---------------------------------------------------------------------------

console.log('\n[runCodex — phase_end.duration_ms]');

await test('정상 async 완료 경로에서 phase_end.duration_ms가 null이 아님', async () => {
  const events = [];
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated' },
  ]);
  const spawnFn = makeFakeAppServer(makeSuccessMessages());

  await runCodex({
    prompt:       '테스트',
    cwd:          '/tmp',
    onEvent:      (e) => events.push(e),
    _spawnSyncFn: spawnSyncFn,
    _spawnFn:     spawnFn,
  });

  const phaseEnd = events.find((e) => e.type === 'phase_end');
  assert.ok(phaseEnd, 'phase_end 이벤트 존재');
  assert.ok(phaseEnd.duration_ms !== null, `duration_ms null이면 안 됨: ${phaseEnd.duration_ms}`);
  assert.ok(typeof phaseEnd.duration_ms === 'number', `duration_ms는 number여야 함: ${typeof phaseEnd.duration_ms}`);
  assert.ok(phaseEnd.duration_ms >= 0, `duration_ms >= 0 이어야 함: ${phaseEnd.duration_ms}`);
});

// ---------------------------------------------------------------------------
// runCodex — onEvent 없을 때
// ---------------------------------------------------------------------------

console.log('\n[runCodex — onEvent 옵션]');

await test('onEvent 미제공 시 이벤트 없이 정상 실행', async () => {
  const spawnSyncFn = makeSpawnSyncFn([
    { status: 0, stdout: 'codex 0.125.0' },
    { status: 0, stdout: 'app-server ok' },
    { status: 0, stdout: 'authenticated' },
  ]);
  const spawnFn = makeFakeAppServer(makeSuccessMessages());

  const result = await runCodex({
    prompt:       '테스트',
    cwd:          '/tmp',
    _spawnSyncFn: spawnSyncFn,
    _spawnFn:     spawnFn,
  });

  assert.strictEqual(result.success, true);
});

// ---------------------------------------------------------------------------
// 결과
// ---------------------------------------------------------------------------

console.log(`\n결과: ${passed} 통과, ${failed} 실패`);

if (failed > 0) process.exit(1);

} // end main

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
