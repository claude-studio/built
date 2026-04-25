/**
 * src/providers/codex.js
 *
 * Codex app-server provider adapter MVP.
 *
 * OpenAI Codex app-server JSON-RPC 프로토콜을 통해 thread/turn을 실행하고,
 * Codex 알림(notification)을 built 표준 provider event로 변환해 onEvent 콜백으로 전달한다.
 * Provider는 파일을 직접 쓰지 않는다.
 *
 * API:
 *   checkAvailability([cwd])
 *     → { available: boolean, detail: string }
 *
 *   checkLogin([cwd])
 *     → { available: boolean, loggedIn: boolean, detail: string }
 *
 *   runCodex({ prompt, model, effort, sandbox, timeout_ms, outputSchema, onEvent, cwd })
 *     → Promise<{ success, exitCode, text?, error?, providerMeta? }>
 *
 *   interruptCodexTurn({ cwd, threadId, turnId })
 *     → Promise<{ attempted, interrupted, detail }>
 *
 * sandbox 값 매핑 (built 계약 → Codex app-server):
 *   'read-only'       → 'readOnly'
 *   'workspace-write' → 'workspaceWrite'
 *
 * 기본값: sandbox=read-only, approvalPolicy=never, timeout_ms=1800000
 *
 * docs/contracts/provider-events.md, docs/contracts/provider-config.md 참고.
 * vendor/codex-plugin-cc/LICENSE, NOTICE 참고 (Apache-2.0).
 */

'use strict';

const childProcess = require('child_process');

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS     = 30 * 60 * 1000; // 30분 (1800000ms)
const DEFAULT_SANDBOX        = 'read-only';
const DEFAULT_APPROVAL_POLICY = 'never';

/**
 * built 계약 sandbox 값 → Codex app-server sandbox 값 변환 테이블.
 * 공식 app-server: 'readOnly' | 'workspaceWrite'
 * built 계약:      'read-only' | 'workspace-write'
 */
const SANDBOX_TO_CODEX = {
  'read-only':       'readOnly',
  'workspace-write': 'workspaceWrite',
};

/** app-server JSON-RPC initialize에 전달할 클라이언트 정보 */
const CLIENT_INFO = {
  title: 'built Codex Provider',
  name:  'built',
  version: '0.1.0',
};

/** app-server가 보내지 않아도 되는 notification 목록 */
const CAPABILITIES = {
  experimentalApi: false,
  optOutNotificationMethods: [
    'item/agentMessage/delta',
    'item/reasoning/summaryTextDelta',
    'item/reasoning/summaryPartAdded',
    'item/reasoning/textDelta',
  ],
};

// ---------------------------------------------------------------------------
// 실패 메시지 상수 (테스트에서 import해 검증)
// ---------------------------------------------------------------------------

const MSG_BINARY_NOT_FOUND     = 'Codex CLI를 찾을 수 없습니다. @openai/codex 설치 후 다시 실행하세요.';
const MSG_APP_SERVER_UNSUPPORTED = '현재 Codex CLI가 app-server를 지원하지 않습니다. Codex CLI를 업데이트하세요.';
const MSG_AUTH_REQUIRED        = 'Codex 인증이 필요합니다. codex login 상태를 확인하세요.';
const MSG_WRITE_PHASE_READ_ONLY = 'do/iter phase에서 Codex read-only sandbox는 파일 변경을 반영할 수 없습니다. workspace-write를 사용하세요.';

// ---------------------------------------------------------------------------
// tool_call/tool_result 변환 대상 item type
// ---------------------------------------------------------------------------

const TOOL_ITEM_TYPES = new Set(['commandExecution', 'mcpToolCall', 'dynamicToolCall', 'fileChange']);

// ---------------------------------------------------------------------------
// 내부 유틸
// ---------------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// availability / login check
// ---------------------------------------------------------------------------

/**
 * Codex CLI 바이너리와 app-server 지원 여부를 확인한다.
 *
 * @param {string} [cwd]  작업 디렉토리 (기본: process.cwd())
 * @param {object} [_opts]  테스트용 주입 옵션 (_spawnSyncFn)
 * @returns {{ available: boolean, detail: string }}
 */
function checkAvailability(cwd, _opts = {}) {
  const spawnSyncFn = _opts._spawnSyncFn || childProcess.spawnSync;
  const workDir = cwd || process.cwd();

  const versionResult = spawnSyncFn('codex', ['--version'], {
    cwd:         workDir,
    encoding:    'utf8',
    stdio:       'pipe',
    shell:       process.platform === 'win32',
    windowsHide: true,
  });

  if (versionResult.error && versionResult.error.code === 'ENOENT') {
    return { available: false, detail: MSG_BINARY_NOT_FOUND };
  }
  if (versionResult.error) {
    return { available: false, detail: `${MSG_BINARY_NOT_FOUND}: ${versionResult.error.message}` };
  }
  if (versionResult.status !== 0) {
    return { available: false, detail: MSG_BINARY_NOT_FOUND };
  }

  // app-server 지원 확인
  const appServerResult = spawnSyncFn('codex', ['app-server', '--help'], {
    cwd:         workDir,
    encoding:    'utf8',
    stdio:       'pipe',
    shell:       process.platform === 'win32',
    windowsHide: true,
  });

  if (appServerResult.error || appServerResult.status !== 0) {
    return { available: false, detail: MSG_APP_SERVER_UNSUPPORTED };
  }

  const versionDetail = (versionResult.stdout || '').trim() || 'ok';
  return { available: true, detail: versionDetail };
}

/**
 * Codex 인증 상태를 확인한다.
 *
 * @param {string} [cwd]
 * @param {object} [_opts]  테스트용 주입 옵션 (_spawnSyncFn)
 * @returns {{ available: boolean, loggedIn: boolean, detail: string }}
 */
function checkLogin(cwd, _opts = {}) {
  const avail = checkAvailability(cwd, _opts);
  if (!avail.available) {
    return { available: false, loggedIn: false, detail: avail.detail };
  }

  const spawnSyncFn = _opts._spawnSyncFn || childProcess.spawnSync;
  const workDir = cwd || process.cwd();

  const result = spawnSyncFn('codex', ['login', 'status'], {
    cwd:         workDir,
    encoding:    'utf8',
    stdio:       'pipe',
    shell:       process.platform === 'win32',
    windowsHide: true,
  });

  if (result.error) {
    return { available: true, loggedIn: false, detail: MSG_AUTH_REQUIRED };
  }
  if (result.status === 0) {
    const detail = (result.stdout || '').trim() || 'authenticated';
    return { available: true, loggedIn: true, detail };
  }

  return { available: true, loggedIn: false, detail: MSG_AUTH_REQUIRED };
}

// ---------------------------------------------------------------------------
// 최소 JSON-RPC 클라이언트 (over stdio)
// ---------------------------------------------------------------------------

/**
 * codex app-server 프로세스와 JSON-RPC JSONL 통신하는 최소 클라이언트.
 *
 * - spawn('codex', ['app-server']) 후 stdout JSONL 파싱
 * - request(method, params) → Promise
 * - notify(method, params)  → fire-and-forget
 * - setNotificationHandler(fn) → notification 수신
 * - close() → 정리
 *
 * vendor/codex-plugin-cc의 AppServerClientBase/SpawnedCodexAppServerClient를
 * CommonJS 환경에 맞게 최소 재구현한 것이다. (Apache-2.0 재구현 참고)
 */
class _AppServerJsonRpcClient {
  constructor() {
    this.pending             = new Map();
    this.nextId              = 1;
    this.notificationHandler = null;
    this.proc                = null;
    this.rl                  = null;
    this.closed              = false;
    this.exitResolved        = false;
    this.stderr              = '';
    this._exitResolve        = null;
    this.exitPromise         = new Promise((resolve) => { this._exitResolve = resolve; });
  }

  /**
   * codex app-server 프로세스를 시작한다.
   *
   * @param {string} cwd
   * @param {object} [opts]  테스트용: { _spawnFn, env }
   */
  spawn(cwd, opts = {}) {
    const spawnFn = opts._spawnFn || childProcess.spawn;

    this.proc = spawnFn('codex', ['app-server'], {
      cwd,
      env:         opts.env || process.env,
      stdio:       ['pipe', 'pipe', 'pipe'],
      shell:       process.platform === 'win32',
      windowsHide: true,
    });

    this.proc.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString('utf8');
    });

    this.proc.on('error', (err) => {
      this._handleExit(err);
    });

    this.proc.on('exit', (code, signal) => {
      // 남은 버퍼 처리
      if (this._lineBuf) {
        this._handleLine(this._lineBuf);
        this._lineBuf = '';
      }
      const err = (code !== 0 && code !== null)
        ? new Error(`codex app-server exited (${signal ? `signal ${signal}` : `code ${code}`})`)
        : null;
      this._handleExit(err);
    });

    // stdout을 data 이벤트 기반으로 줄 단위 처리 (readline 대신)
    this._lineBuf = '';
    this.proc.stdout.on('data', (chunk) => {
      this._lineBuf += chunk.toString('utf8');
      const lines = this._lineBuf.split('\n');
      this._lineBuf = lines.pop(); // 마지막 불완전 줄 보존
      for (const line of lines) {
        this._handleLine(line);
      }
    });
  }

  _handleLine(line) {
    const trimmed = (line || '').trim();
    if (!trimmed) return;

    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (_) {
      return; // 파싱 불가 줄 무시
    }

    // 서버 응답 (id 있고, method 없음)
    if (msg.id !== undefined && !msg.method) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);

      if (msg.error) {
        const err = new Error(msg.error.message || 'JSON-RPC error');
        err.rpcCode = msg.error.code;
        err.rpcData = msg.error.data;
        pending.reject(err);
      } else {
        pending.resolve(msg.result || {});
      }
      return;
    }

    // 서버 notification (id 없고, method 있음)
    if (msg.method && msg.id === undefined) {
      if (this.notificationHandler) {
        this.notificationHandler(msg);
      }
      return;
    }

    // 서버 요청 (id 있고, method 있음) → 지원하지 않음 응답
    if (msg.id !== undefined && msg.method) {
      this._send({ id: msg.id, error: { code: -32601, message: `Unsupported: ${msg.method}` } });
    }
  }

  _handleExit(error) {
    if (this.exitResolved) return;
    this.exitResolved = true;

    const closeErr = error || new Error('codex app-server connection closed');
    for (const pending of this.pending.values()) {
      pending.reject(closeErr);
    }
    this.pending.clear();

    if (this._exitResolve) this._exitResolve();
  }

  _send(msg) {
    const line = JSON.stringify(msg) + '\n';
    try {
      this.proc.stdin.write(line);
    } catch (_) {}
  }

  /**
   * JSON-RPC 요청을 보내고 응답 Promise를 반환한다.
   */
  request(method, params) {
    if (this.closed) {
      return Promise.reject(new Error('codex app-server client is closed'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this._send({ id, method, params });
    });
  }

  /** fire-and-forget notification 전송 */
  notify(method, params = {}) {
    if (!this.closed) {
      this._send({ method, params });
    }
  }

  /**
   * app-server initialize 요청 및 initialized notification 전송.
   * spawn() 후 반드시 호출한다.
   */
  async initialize() {
    await this.request('initialize', {
      clientInfo:   CLIENT_INFO,
      capabilities: CAPABILITIES,
    });
    this.notify('initialized', {});
  }

  /** 클라이언트를 종료하고 프로세스를 정리한다. */
  async close() {
    if (this.closed) {
      return this.exitPromise;
    }
    this.closed = true;

    if (this.proc && !this.proc.killed) {
      try { this.proc.stdin.end(); } catch (_) {}
      // grace period 후 SIGTERM
      setTimeout(() => {
        if (this.proc && !this.proc.killed && this.proc.exitCode === null) {
          try { this.proc.kill('SIGTERM'); } catch (_) {}
        }
      }, 50).unref?.();
    }

    return this.exitPromise;
  }
}

// ---------------------------------------------------------------------------
// Codex notification → built 표준 이벤트 변환
// ---------------------------------------------------------------------------

/**
 * Codex app-server notification 메시지 하나를 표준 이벤트 배열로 변환한다.
 *
 * 매핑 규칙 (docs/contracts/provider-events.md 기준):
 *   item/started  + tool item type   → tool_call
 *   item/completed + agentMessage    → text_delta
 *   item/completed + tool item type  → tool_result
 *   turn/completed                   → phase_end
 *   error                            → error
 *
 * @param {{ method: string, params: object }} msg  app-server notification
 * @returns {object[]}  표준 이벤트 배열 (빈 배열 가능)
 */
function _notificationToEvents(msg) {
  if (!msg || !msg.method) return [];

  const ts     = nowIso();
  const params = msg.params || {};

  switch (msg.method) {

    case 'item/started': {
      const item = params.item;
      if (!item || !TOOL_ITEM_TYPES.has(item.type)) break;

      const summary = item.command
        || (item.server && item.tool ? `${item.server}/${item.tool}` : null)
        || item.tool
        || item.type;

      return [{
        type:      'tool_call',
        id:        item.id   || null,
        name:      item.type,
        summary:   summary   || item.type,
        timestamp: ts,
      }];
    }

    case 'item/completed': {
      const item = params.item;
      if (!item) break;

      if (item.type === 'agentMessage' && item.text) {
        return [{
          type:      'text_delta',
          text:      item.text,
          timestamp: ts,
        }];
      }

      if (TOOL_ITEM_TYPES.has(item.type)) {
        return [{
          type:      'tool_result',
          id:        item.id   || null,
          name:      item.type,
          status:    item.status   || 'completed',
          exit_code: item.exitCode !== undefined ? item.exitCode : null,
          summary:   item.command  || item.tool  || null,
          timestamp: ts,
        }];
      }
      break;
    }

    case 'turn/completed': {
      const turn = params.turn || {};
      const turnStatus = turn.status === 'completed' ? 'completed'
        : turn.status === 'interrupted' ? 'interrupted'
        : 'completed';

      return [{
        type:       'phase_end',
        status:     turnStatus,
        duration_ms: null,
        threadId:   params.threadId || null,
        turnId:     turn.id         || null,
        timestamp:  ts,
      }];
    }

    case 'error': {
      const err = params.error || {};
      return [{
        type:      'error',
        message:   err.message || 'Codex app-server error',
        retryable: false,
        timestamp: ts,
      }];
    }

    default:
      break;
  }

  return [];
}

// ---------------------------------------------------------------------------
// interruptCodexTurn
// ---------------------------------------------------------------------------

/**
 * 실행 중인 Codex turn을 중단한다.
 *
 * @param {object} opts
 * @param {string} [opts.cwd]
 * @param {string} opts.threadId
 * @param {string} opts.turnId
 * @param {function} [opts._spawnFn]      테스트용 spawn 주입
 * @param {function} [opts._spawnSyncFn]  테스트용 spawnSync 주입
 * @returns {Promise<{ attempted: boolean, interrupted: boolean, detail: string }>}
 */
async function interruptCodexTurn({ cwd, threadId, turnId, _spawnFn, _spawnSyncFn } = {}) {
  if (!threadId || !turnId) {
    return { attempted: false, interrupted: false, detail: 'threadId와 turnId가 필요합니다.' };
  }

  const workDir = cwd || process.cwd();
  const avail   = checkAvailability(workDir, { _spawnSyncFn });
  if (!avail.available) {
    return { attempted: false, interrupted: false, detail: avail.detail };
  }

  const client = new _AppServerJsonRpcClient();
  try {
    client.spawn(workDir, { _spawnFn });
    await client.initialize();
    await client.request('turn/interrupt', { threadId, turnId });
    return { attempted: true, interrupted: true, detail: `Interrupted ${turnId} on ${threadId}.` };
  } catch (err) {
    return { attempted: true, interrupted: false, detail: err.message };
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// runCodex
// ---------------------------------------------------------------------------

/**
 * Codex app-server provider 실행 함수.
 *
 * 1. readiness/login check → 실패 시 error 이벤트 emit 후 반환
 * 2. do/iter phase + read-only sandbox 조합 검증 → 실패 시 error 이벤트 emit 후 반환
 * 3. phase_start 이벤트 emit
 * 4. codex app-server 프로세스 spawn → thread/start → turn/start
 * 5. notification을 표준 이벤트로 변환해 onEvent 콜백 전달 (phase 필드 포함)
 * 6. turn/completed → phase_end (duration_ms 포함) 후 resolve
 * 7. timeout → error 이벤트 즉시 emit + settle, interrupt는 best-effort
 *
 * @param {object} opts
 * @param {string}   opts.prompt        Codex에 전달할 프롬프트
 * @param {string}   [opts.model]       모델 ID
 * @param {string}   [opts.effort]      reasoning effort ('low'|'medium'|'high')
 * @param {string}   [opts.sandbox]     'read-only' | 'workspace-write' (기본: 'read-only')
 * @param {string}   [opts.phase]       현재 phase ('do'|'iter'|'plan_synthesis' 등)
 * @param {number}   [opts.timeout_ms]  실행 타임아웃 ms (기본: 1800000)
 * @param {object}   [opts.outputSchema] structured output schema
 * @param {function} [opts.onEvent]     표준 이벤트 콜백
 * @param {string}   [opts.cwd]        작업 디렉토리
 * @param {function} [opts._spawnFn]   테스트용 spawn 주입
 * @param {function} [opts._spawnSyncFn] 테스트용 spawnSync 주입
 * @returns {Promise<{success: boolean, exitCode: number, text?: string, error?: string, providerMeta?: object}>}
 */
function runCodex({
  prompt, model, effort, sandbox, phase, timeout_ms, outputSchema,
  onEvent, cwd, _spawnFn, _spawnSyncFn,
} = {}) {
  if (!prompt) throw new TypeError('runCodex: prompt is required');

  const workDir   = cwd || process.cwd();
  const timeoutMs = timeout_ms || DEFAULT_TIMEOUT_MS;
  const sandboxValue = sandbox || DEFAULT_SANDBOX;
  const codexSandbox = SANDBOX_TO_CODEX[sandboxValue] || 'readOnly';

  // phase를 이벤트에 포함해서 emit한다.
  function emit(event) {
    if (typeof onEvent === 'function') {
      onEvent(phase ? { phase, ...event } : event);
    }
  }

  // --- readiness check ---
  const avail = checkAvailability(workDir, { _spawnSyncFn });
  if (!avail.available) {
    emit({ type: 'error', message: avail.detail, retryable: false, timestamp: nowIso() });
    return Promise.resolve({ success: false, exitCode: 1, error: avail.detail });
  }

  // --- login check ---
  const loginStatus = checkLogin(workDir, { _spawnSyncFn });
  if (!loginStatus.loggedIn) {
    emit({ type: 'error', message: MSG_AUTH_REQUIRED, retryable: false, timestamp: nowIso() });
    return Promise.resolve({ success: false, exitCode: 1, error: MSG_AUTH_REQUIRED });
  }

  // --- do/iter + read-only sandbox 검증 ---
  // do/iter phase에서 read-only sandbox를 사용하면 파일 변경이 반영되지 않는다.
  if ((phase === 'do' || phase === 'iter') && sandboxValue === 'read-only') {
    emit({ type: 'error', message: MSG_WRITE_PHASE_READ_ONLY, retryable: false, timestamp: nowIso() });
    return Promise.resolve({ success: false, exitCode: 1, error: MSG_WRITE_PHASE_READ_ONLY });
  }

  // --- emit phase_start ---
  emit({
    type:      'phase_start',
    provider:  'codex',
    model:     model || null,
    threadId:  null,
    timestamp: nowIso(),
  });

  return new Promise((resolve) => {
    const client    = new _AppServerJsonRpcClient();
    const startTime = Date.now();

    let settled       = false;
    let timedOut      = false;
    let finalThreadId = null;
    let finalTurnId   = null;
    let lastText      = '';

    function settle(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      client.close().then(() => resolve(result));
    }

    // --- timeout ---
    // app-server 무응답 시 interrupt await가 hang될 수 있으므로
    // error emit + settle을 먼저 처리하고 interrupt는 best-effort로 처리한다.
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      if (settled) return;

      const msg = `Codex 실행이 ${timeoutMs}ms 후 타임아웃되었습니다.`;
      emit({ type: 'error', message: msg, retryable: true, timestamp: nowIso() });
      settle({ success: false, exitCode: 1, error: msg });

      // interrupt best-effort: settle/close 후 pending request는 자동 reject됨
      if (finalThreadId && finalTurnId) {
        client.request('turn/interrupt', { threadId: finalThreadId, turnId: finalTurnId })
          .catch(() => {});
      }
    }, timeoutMs);

    // --- notification handler ---
    client.notificationHandler = (msg) => {
      if (settled) return;

      // turn/started에서 ID 추출
      if (msg.method === 'turn/started' && msg.params) {
        if (msg.params.turn && msg.params.turn.id) {
          finalTurnId = msg.params.turn.id;
        }
        if (msg.params.threadId) {
          finalThreadId = msg.params.threadId;
        }
      }

      const events = _notificationToEvents(msg);
      for (const rawEvt of events) {
        if (rawEvt.type === 'text_delta') {
          lastText = rawEvt.text;
        }

        // phase_end에 실제 경과 시간을 채운다 (_notificationToEvents는 순수함수라 null 반환).
        const evt = rawEvt.type === 'phase_end'
          ? { ...rawEvt, duration_ms: Date.now() - startTime }
          : rawEvt;

        emit(evt);

        if (evt.type === 'phase_end' || evt.type === 'error') {
          const isSuccess = evt.type === 'phase_end' && evt.status === 'completed';
          settle({
            success:      isSuccess,
            exitCode:     isSuccess ? 0 : 1,
            text:         lastText,
            providerMeta: {
              threadId:    finalThreadId || (evt.threadId || null),
              turnId:      finalTurnId   || (evt.turnId   || null),
              duration_ms: Date.now() - startTime,
            },
          });
          return;
        }
      }
    };

    // --- main async flow ---
    (async () => {
      try {
        client.spawn(workDir, { _spawnFn });
        await client.initialize();

        // thread/start
        const threadResponse = await client.request('thread/start', {
          cwd:            workDir,
          model:          model           || null,
          approvalPolicy: DEFAULT_APPROVAL_POLICY,
          sandbox:        codexSandbox,
          serviceName:    'built',
          ephemeral:      true,
          experimentalRawEvents: false,
        });

        finalThreadId = (threadResponse.thread && threadResponse.thread.id) || null;

        // turn/start
        const turnInput = [{ type: 'text', text: prompt, text_elements: [] }];
        const turnResponse = await client.request('turn/start', {
          threadId:     finalThreadId,
          input:        turnInput,
          model:        model        || null,
          effort:       effort       || null,
          outputSchema: outputSchema || null,
        });

        finalTurnId = (turnResponse.turn && turnResponse.turn.id) || null;

        // turn이 즉시 완료된 경우
        const immediateStatus = turnResponse.turn && turnResponse.turn.status;
        if (immediateStatus && immediateStatus !== 'inProgress') {
          if (!settled) {
            const isSuccess = immediateStatus === 'completed';
            emit({
              type:        'phase_end',
              status:      immediateStatus,
              duration_ms: Date.now() - startTime,
              threadId:    finalThreadId,
              turnId:      finalTurnId,
              timestamp:   nowIso(),
            });
            settle({
              success:      isSuccess,
              exitCode:     isSuccess ? 0 : 1,
              text:         lastText,
              providerMeta: {
                threadId:    finalThreadId,
                turnId:      finalTurnId,
                duration_ms: Date.now() - startTime,
              },
            });
          }
        }

      } catch (err) {
        if (!settled) {
          const errMsg = timedOut
            ? `Codex 실행이 ${timeoutMs}ms 후 타임아웃되었습니다.`
            : (err.message || 'Codex app-server 실행 실패');
          emit({ type: 'error', message: errMsg, retryable: timedOut, timestamp: nowIso() });
          settle({ success: false, exitCode: 1, error: errMsg });
        }
      }
    })();
  });
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = {
  checkAvailability,
  checkLogin,
  runCodex,
  interruptCodexTurn,
  // 테스트 및 내부 사용 노출
  MSG_BINARY_NOT_FOUND,
  MSG_APP_SERVER_UNSUPPORTED,
  MSG_AUTH_REQUIRED,
  MSG_WRITE_PHASE_READ_ONLY,
  SANDBOX_TO_CODEX,
  _AppServerJsonRpcClient,
  _notificationToEvents,
};
