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
 *   runCodex({ prompt, model, effort, sandbox, timeout_ms, max_retries, signal, outputSchema, onEvent, cwd })
 *     → Promise<{ success, exitCode, text?, error?, providerMeta? }>
 *
 *   interruptCodexTurn({ cwd, threadId, turnId })
 *     → Promise<{ attempted, interrupted, detail }>
 *
 * sandbox 값 매핑 (built 계약 → Codex app-server):
 *   'read-only'          → 'read-only'
 *   'workspace-write'    → 'workspace-write'
 *   'danger-full-access' → 'danger-full-access'
 *
 * 기본값: sandbox=read-only, approvalPolicy=never, timeout_ms=1800000
 *
 * docs/contracts/provider-events.md, docs/contracts/provider-config.md 참고.
 * vendor/codex-plugin-cc/LICENSE, NOTICE 참고 (Apache-2.0).
 */

'use strict';

const childProcess = require('child_process');
const fs           = require('fs');
const net          = require('net');
const os           = require('os');
const path         = require('path');

const {
  FAILURE_KINDS,
  classifyCodexFailure,
  failureToEventFields,
  sanitizeDebugDetail,
} = require('./failure');

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS     = 30 * 60 * 1000; // 30분 (1800000ms)
const DEFAULT_MAX_RETRIES    = 0;
const DEFAULT_SANDBOX        = 'read-only';
const DEFAULT_APPROVAL_POLICY = 'never';
const BROKER_STATE_FILE      = 'codex-broker.json';
const BROKER_LOCK_FILE       = 'codex-broker.lock';
const BROKER_LOCK_STALE_MS   = 30 * 1000;
const BROKER_READY_TIMEOUT_MS = 2000;

/**
 * built 계약 sandbox 값 → Codex app-server sandbox 값 변환 테이블.
 * 공식 app-server: 'read-only' | 'workspace-write' | 'danger-full-access'
 * built 계약:      'read-only' | 'workspace-write'
 */
const SANDBOX_TO_CODEX = {
  'read-only':          'read-only',
  'workspace-write':    'workspace-write',
  'danger-full-access': 'danger-full-access',
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
const MSG_READ_ONLY_FILE_CHANGE = 'Codex read-only sandbox에서 파일 변경 시도가 감지되었습니다. check/report/plan_synthesis는 파일을 수정하지 않아야 하며, 구현 변경은 do/iter phase에서 workspace-write로 실행하세요.';
const MSG_BROKER_START_FAILED  = 'Codex broker를 시작하지 못했습니다. app-server lifecycle과 broker 로그를 확인하세요.';
const MSG_BROKER_CLEANUP_FAILED = 'Codex broker cleanup에 실패했습니다.';
const MSG_BROKER_BUSY          = 'Codex broker가 다른 turn을 처리 중입니다. 잠시 후 다시 실행하세요.';
const MSG_INTERRUPTED          = 'Codex 실행이 사용자 중단 신호로 취소되었습니다.';
const MSG_INTERRUPT_RISK       = '작업이 아직 계속될 수 있습니다. codex app-server/broker 프로세스를 확인하고 필요하면 수동으로 종료하세요.';

const BROKER_ENDPOINT_ENV = 'CODEX_COMPANION_APP_SERVER_ENDPOINT';
const BROKER_PID_FILE_ENV = 'CODEX_COMPANION_APP_SERVER_PID_FILE';
const BROKER_LOG_FILE_ENV = 'CODEX_COMPANION_APP_SERVER_LOG_FILE';
const BROKER_BUSY_RPC_CODE = -32001;

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

function normalizeMaxRetries(value) {
  if (value === undefined || value === null) return DEFAULT_MAX_RETRIES;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return DEFAULT_MAX_RETRIES;
  return Math.floor(num);
}

function retryDelay(ms, signal) {
  const delayMs = Number(ms) > 0 ? Number(ms) : 0;
  if (delayMs <= 0) return Promise.resolve();

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    if (!signal) return;
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

function interruptedFailure() {
  return classifyCodexFailure({ kind: FAILURE_KINDS.INTERRUPTED, message: MSG_INTERRUPTED });
}

function isAbortRequested(opts = {}) {
  if (opts.signal && opts.signal.aborted) return true;
  if (typeof opts.shouldAbort !== 'function') return false;
  try {
    return Boolean(opts.shouldAbort());
  } catch (_) {
    return false;
  }
}

function appendInterruptRisk(message, interrupt) {
  if (!interrupt || interrupt.interrupted) return message;
  const detail = interrupt.detail ? ` interrupt 실패: ${sanitizeDebugDetail(interrupt.detail)}.` : '';
  return `${message} ${MSG_INTERRUPT_RISK}${detail}`;
}

function withInterruptRiskMessage(failure, userMessage, interrupt) {
  if (!interrupt || interrupt.interrupted) return failure;
  return {
    ...failure,
    user_message: userMessage,
  };
}

function resolveRuntimeDir(cwd) {
  return path.join(cwd || process.cwd(), '.built', 'runtime');
}

function resolveBrokerStateFile(cwd) {
  return path.join(resolveRuntimeDir(cwd), BROKER_STATE_FILE);
}

function resolveBrokerLockFile(cwd) {
  return path.join(resolveRuntimeDir(cwd), BROKER_LOCK_FILE);
}

function createBrokerSessionDir(prefix = 'built-codex-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sanitizePipeName(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^-+|-+$/g, '');
}

function createBrokerEndpoint(sessionDir, platform = process.platform) {
  if (platform === 'win32') {
    const pipeName = sanitizePipeName(`${path.win32.basename(sessionDir)}-codex-app-server`);
    return `pipe:\\\\.\\pipe\\${pipeName}`;
  }
  return `unix:${path.join(sessionDir, 'broker.sock')}`;
}

function parseBrokerEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    throw new Error('Missing broker endpoint.');
  }
  if (endpoint.startsWith('pipe:')) {
    const pipePath = endpoint.slice('pipe:'.length);
    if (!pipePath) throw new Error('Broker pipe endpoint is missing its path.');
    return { kind: 'pipe', path: pipePath };
  }
  if (endpoint.startsWith('unix:')) {
    const socketPath = endpoint.slice('unix:'.length);
    if (!socketPath) throw new Error('Broker Unix socket endpoint is missing its path.');
    return { kind: 'unix', path: socketPath };
  }
  throw new Error(`Unsupported broker endpoint: ${endpoint}`);
}

function connectToEndpoint(endpoint) {
  const target = parseBrokerEndpoint(endpoint);
  return net.createConnection({ path: target.path });
}

async function waitForBrokerEndpoint(endpoint, timeoutMs = BROKER_READY_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await new Promise((resolve) => {
      const socket = connectToEndpoint(endpoint);
      socket.on('connect', () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
    });
    if (ready) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

function loadBrokerSession(cwd) {
  const stateFile = resolveBrokerStateFile(cwd);
  if (!fs.existsSync(stateFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (_) {
    return null;
  }
}

function saveBrokerSession(cwd, session) {
  const runtimeDir = resolveRuntimeDir(cwd);
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(resolveBrokerStateFile(cwd), `${JSON.stringify(session, null, 2)}\n`, 'utf8');
}

function clearBrokerSession(cwd) {
  const stateFile = resolveBrokerStateFile(cwd);
  if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
}

function isProcessAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function safeUnlink(file, errors) {
  if (!file) return;
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (err) {
    errors.push(`${file}: ${err.message}`);
  }
}

function teardownBrokerSession({ endpoint = null, pidFile = null, logFile = null, sessionDir = null, pid = null, killProcess = null } = {}) {
  const errors = [];

  if (Number.isFinite(pid) && pid > 0) {
    try {
      const killer = killProcess || ((targetPid) => process.kill(targetPid, 'SIGTERM'));
      if (isProcessAlive(pid) || killProcess) killer(pid);
    } catch (err) {
      if (err && err.code !== 'ESRCH') errors.push(`pid ${pid}: ${err.message}`);
    }
  }

  safeUnlink(pidFile, errors);
  safeUnlink(logFile, errors);

  if (endpoint) {
    try {
      const target = parseBrokerEndpoint(endpoint);
      if (target.kind === 'unix') safeUnlink(target.path, errors);
    } catch (err) {
      errors.push(`endpoint ${endpoint}: ${err.message}`);
    }
  }

  const resolvedSessionDir = sessionDir || (pidFile ? path.dirname(pidFile) : null) || (logFile ? path.dirname(logFile) : null);
  if (resolvedSessionDir && fs.existsSync(resolvedSessionDir)) {
    try {
      fs.rmdirSync(resolvedSessionDir);
    } catch (err) {
      errors.push(`${resolvedSessionDir}: ${err.message}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function acquireBrokerLock(cwd, opts = {}) {
  const lockFile = resolveBrokerLockFile(cwd);
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const now = Date.now();
  const pid = process.pid;

  try {
    const fd = fs.openSync(lockFile, 'wx');
    fs.writeFileSync(fd, JSON.stringify({ pid, created_at: nowIso(), created_ms: now }));
    fs.closeSync(fd);
    return { acquired: true, lockFile };
  } catch (err) {
    if (err.code !== 'EEXIST') {
      return { acquired: false, lockFile, error: err.message };
    }
  }

  let lock = null;
  try {
    lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  } catch (_) {}

  const stale =
    !lock ||
    !Number.isFinite(lock.pid) ||
    !isProcessAlive(lock.pid) ||
    (Number.isFinite(lock.created_ms) && now - lock.created_ms > (opts.staleMs || BROKER_LOCK_STALE_MS));

  if (!stale) {
    return { acquired: false, lockFile, error: 'Codex broker lock이 이미 사용 중입니다.' };
  }

  try {
    fs.unlinkSync(lockFile);
    const fd = fs.openSync(lockFile, 'wx');
    fs.writeFileSync(fd, JSON.stringify({ pid, created_at: nowIso(), created_ms: now }));
    fs.closeSync(fd);
    return { acquired: true, lockFile, recoveredStale: true };
  } catch (err) {
    return { acquired: false, lockFile, error: err.message };
  }
}

function releaseBrokerLock(lock) {
  if (!lock || !lock.acquired || !lock.lockFile) return;
  try {
    if (fs.existsSync(lock.lockFile)) fs.unlinkSync(lock.lockFile);
  } catch (_) {}
}

async function sendBrokerShutdown(endpoint) {
  if (!endpoint) return;
  await new Promise((resolve) => {
    let done = false;
    function finish() {
      if (!done) {
        done = true;
        resolve();
      }
    }
    const socket = connectToEndpoint(endpoint);
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id: 1, method: 'broker/shutdown', params: {} })}\n`);
    });
    socket.on('data', () => {
      socket.end();
      finish();
    });
    socket.on('error', finish);
    socket.on('close', finish);
    setTimeout(finish, 250).unref?.();
  });
}

async function cleanupBrokerSession(cwd, session, opts = {}) {
  if (!session) return { ok: true, errors: [] };
  try {
    await sendBrokerShutdown(session.endpoint);
  } catch (_) {}

  const result = teardownBrokerSession({
    endpoint: session.endpoint || null,
    pidFile: session.pidFile || null,
    logFile: session.logFile || null,
    sessionDir: session.sessionDir || null,
    pid: session.pid || null,
    killProcess: opts.killProcess || null,
  });

  try {
    clearBrokerSession(cwd);
  } catch (err) {
    result.errors.push(`${resolveBrokerStateFile(cwd)}: ${err.message}`);
  }

  result.ok = result.errors.length === 0;
  return result;
}

function spawnBrokerProcess({ scriptPath, cwd, endpoint, pidFile, logFile, env = process.env, _spawnFn }) {
  const spawnFn = _spawnFn || childProcess.spawn;
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const logFd = fs.openSync(logFile, 'a');
  const child = spawnFn(process.execPath, [scriptPath, 'serve', '--endpoint', endpoint, '--cwd', cwd, '--pid-file', pidFile], {
    cwd,
    env: {
      ...env,
      [BROKER_ENDPOINT_ENV]: endpoint,
      [BROKER_PID_FILE_ENV]: pidFile,
      [BROKER_LOG_FILE_ENV]: logFile,
    },
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });
  if (typeof child.unref === 'function') child.unref();
  fs.closeSync(logFd);
  return child;
}

async function ensureBrokerSession(cwd, opts = {}) {
  const workDir = cwd || process.cwd();
  const externalEndpoint = opts.env && opts.env[BROKER_ENDPOINT_ENV]
    ? opts.env[BROKER_ENDPOINT_ENV]
    : process.env[BROKER_ENDPOINT_ENV];

  if (externalEndpoint) {
    const ready = await waitForBrokerEndpoint(externalEndpoint, opts.readyTimeoutMs || 150);
    if (ready) {
      return { session: { endpoint: externalEndpoint, external: true }, cleanupError: null, reused: true };
    }
    return {
      session: null,
      cleanupError: `${BROKER_ENDPOINT_ENV}=${externalEndpoint} endpoint에 연결할 수 없습니다.`,
      reused: false,
    };
  }

  const lock = acquireBrokerLock(workDir, opts);
  if (!lock.acquired) {
    return { session: null, cleanupError: lock.error, reused: false };
  }

  try {
    const existing = loadBrokerSession(workDir);
    if (existing && existing.endpoint && await waitForBrokerEndpoint(existing.endpoint, opts.readyTimeoutMs || 150)) {
      return { session: existing, cleanupError: null, reused: true };
    }

    if (existing) {
      const cleanup = await cleanupBrokerSession(workDir, existing, opts);
      if (!cleanup.ok) {
        return { session: null, cleanupError: cleanup.errors.join('; '), reused: false };
      }
    }

    const sessionDir = opts.sessionDir || createBrokerSessionDir();
    const endpoint = opts.endpoint || createBrokerEndpoint(sessionDir, opts.platform);
    const pidFile = path.join(sessionDir, 'broker.pid');
    const logFile = path.join(sessionDir, 'broker.log');
    const scriptPath = opts.scriptPath || path.join(__dirname, '..', '..', 'vendor', 'codex-plugin-cc', 'scripts', 'app-server-broker.mjs');

    const child = spawnBrokerProcess({
      scriptPath,
      cwd: workDir,
      endpoint,
      pidFile,
      logFile,
      env: opts.env || process.env,
      _spawnFn: opts._spawnFn,
    });

    const ready = await waitForBrokerEndpoint(endpoint, opts.readyTimeoutMs || BROKER_READY_TIMEOUT_MS);
    if (!ready) {
      const cleanup = await cleanupBrokerSession(workDir, {
        endpoint,
        pidFile,
        logFile,
        sessionDir,
        pid: child && child.pid ? child.pid : null,
      }, opts);
      const detail = cleanup.ok ? MSG_BROKER_START_FAILED : `${MSG_BROKER_START_FAILED} ${MSG_BROKER_CLEANUP_FAILED}: ${cleanup.errors.join('; ')}`;
      return { session: null, cleanupError: detail, reused: false };
    }

    const session = {
      endpoint,
      pidFile,
      logFile,
      sessionDir,
      pid: child && child.pid ? child.pid : null,
      created_at: nowIso(),
    };
    saveBrokerSession(workDir, session);
    return { session, cleanupError: null, reused: false };
  } finally {
    releaseBrokerLock(lock);
  }
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
    this.socket              = null;
    this.rl                  = null;
    this.closed              = false;
    this.exitResolved        = false;
    this.stderr              = '';
    this._lineBuf            = '';
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

  async connectBroker(_cwd, opts = {}) {
    const endpoint = opts.brokerEndpoint;
    if (!endpoint) {
      throw new Error('Codex broker endpoint가 필요합니다.');
    }

    await new Promise((resolve, reject) => {
      const socket = connectToEndpoint(endpoint);
      this.socket = socket;
      socket.setEncoding('utf8');
      socket.on('connect', resolve);
      socket.on('data', (chunk) => {
        this._lineBuf += chunk.toString('utf8');
        const lines = this._lineBuf.split('\n');
        this._lineBuf = lines.pop();
        for (const line of lines) {
          this._handleLine(line);
        }
      });
      socket.on('error', (err) => {
        if (!this.exitResolved) reject(err);
        this._handleExit(err);
      });
      socket.on('close', () => {
        this._handleExit(this.exitResolved ? null : new Error('codex app-server broker connection closed'));
      });
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
      if (this.socket) {
        this.socket.write(line);
      } else {
        this.proc.stdin.write(line);
      }
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

    if (this.socket) {
      try { this.socket.end(); } catch (_) {}
      return this.exitPromise;
    }

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
      const rawMsg = err.message || '';
      return [{
        type:      'error',
        message:   sanitizeDebugDetail(rawMsg) || 'Codex app-server error',
        retryable: false,
        timestamp: ts,
      }];
    }

    default:
      break;
  }

  return [];
}

function isReadOnlyFileChangeNotification(msg) {
  const item = msg && msg.params && msg.params.item;
  return Boolean(item && item.type === 'fileChange');
}

function describeFileChangeNotification(msg) {
  const item = msg && msg.params && msg.params.item ? msg.params.item : {};
  const target = item.path || item.file || item.uri || item.id || 'unknown target';
  const action = item.action || item.operation || item.status || msg.method || 'fileChange';
  return `${action}: ${target}`;
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
    const brokerSession = loadBrokerSession(workDir);
    if (brokerSession && brokerSession.endpoint && await waitForBrokerEndpoint(brokerSession.endpoint, 150)) {
      await client.connectBroker(workDir, { brokerEndpoint: brokerSession.endpoint });
    } else {
      client.spawn(workDir, { _spawnFn });
    }
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
function runCodex(opts = {}) {
  if (!opts.prompt) throw new TypeError('runCodex: prompt is required');
  return _runCodexWithRetries(opts);
}

async function _runCodexWithRetries(opts = {}) {
  const retryConfig = opts.retry && typeof opts.retry === 'object' ? opts.retry : {};
  const maxRetries = normalizeMaxRetries(
    opts.max_retries !== undefined ? opts.max_retries
      : opts.retries !== undefined ? opts.retries
      : retryConfig.max_retries
  );
  const delayMs = opts.retry_delay_ms !== undefined ? opts.retry_delay_ms : retryConfig.delay_ms;
  const retryLog = [];
  let phaseStartedEmitted = false;

  function emitControlEvent(event) {
    if (typeof opts.onEvent === 'function') opts.onEvent(event);
  }

  function emitRetryAttemptFinished(result) {
    if (!result || !result.providerMeta) return;
    const threadId = result.providerMeta.threadId || null;
    const turnId = result.providerMeta.turnId || null;
    if (!threadId || !turnId) return;

    const interrupt = result.providerMeta.interrupt || null;
    const status = interrupt
      ? (interrupt.interrupted ? 'interrupted' : 'interrupt_failed')
      : 'failed';
    emitControlEvent({
      type: 'provider_metadata',
      provider: 'codex',
      active_provider: {
        provider: 'codex',
        threadId,
        turnId,
        phase: opts.phase || null,
        status,
        cwd: opts.cwd || process.cwd(),
        ...(interrupt ? { interrupt } : {}),
        updatedAt: nowIso(),
      },
      timestamp: nowIso(),
    });
  }

  for (let attemptIndex = 0; attemptIndex <= maxRetries; attemptIndex++) {
    if (isAbortRequested(opts)) {
      const failure = interruptedFailure();
      return {
        success: false,
        exitCode: 1,
        error: failure.user_message,
        failure,
        providerMeta: {
          retry: {
            attempts: attemptIndex,
            max_retries: maxRetries,
            log: retryLog,
          },
        },
      };
    }

    const attempt = attemptIndex + 1;
    const bufferedEvents = [];
    const result = await _runCodexOnce({
      ...opts,
      attempt,
      max_retries: maxRetries,
      onEvent: (event) => {
        if (event && event.type === 'phase_start') {
          if (!phaseStartedEmitted) {
            phaseStartedEmitted = true;
            emitControlEvent(event);
          }
          return;
        }
        if (event && event.type === 'provider_metadata') {
          emitControlEvent(event);
          return;
        }
        bufferedEvents.push(event);
      },
    });

    const failure = result && result.failure;
    const retryable = Boolean(failure && failure.retryable);
    const shouldRetry =
      !result.success &&
      retryable &&
      attemptIndex < maxRetries &&
      !isAbortRequested(opts);

    if (shouldRetry) {
      const reason = {
        attempt,
        next_attempt: attempt + 1,
        max_retries: maxRetries,
        kind: failure.kind || null,
        code: failure.code || null,
        message: failure.user_message || result.error || null,
      };
      retryLog.push(reason);
      const line = `[built:codex] retry ${attempt}/${maxRetries}: ${reason.code || reason.kind || 'unknown'} - ${reason.message || ''}`;
      if (opts.logger && typeof opts.logger.warn === 'function') opts.logger.warn(line);
      else if (opts.logger && typeof opts.logger.log === 'function') opts.logger.log(line);
      else console.warn(line);
      emitRetryAttemptFinished(result);
      await retryDelay(delayMs, opts.signal);
      if (isAbortRequested(opts)) {
        const failureAfterDelay = interruptedFailure();
        return {
          success: false,
          exitCode: 1,
          error: failureAfterDelay.user_message,
          failure: failureAfterDelay,
          providerMeta: {
            ...((result && result.providerMeta) || {}),
            retry: {
              attempts: attempt,
              max_retries: maxRetries,
              log: retryLog,
            },
          },
        };
      }
      continue;
    }

    if (typeof opts.onEvent === 'function') {
      for (const event of bufferedEvents) opts.onEvent(event);
    }

    return {
      ...result,
      providerMeta: {
        ...((result && result.providerMeta) || {}),
        retry: {
          attempts: attempt,
          max_retries: maxRetries,
          log: retryLog,
        },
      },
    };
  }

  return {
    success: false,
    exitCode: 1,
    error: 'Codex retry policy failed unexpectedly.',
    providerMeta: { retry: { attempts: 0, max_retries: maxRetries, log: retryLog } },
  };
}

function _runCodexOnce({
  prompt, model, effort, sandbox, phase, timeout_ms, outputSchema,
  onEvent, cwd, signal, _spawnFn, _spawnSyncFn, _brokerSpawnFn, _disableBroker, _brokerOptions,
} = {}) {
  if (!prompt) throw new TypeError('runCodex: prompt is required');

  const workDir   = cwd || process.cwd();
  const timeoutMs = timeout_ms || DEFAULT_TIMEOUT_MS;
  const sandboxValue = sandbox || DEFAULT_SANDBOX;
  const codexSandbox = SANDBOX_TO_CODEX[sandboxValue] || DEFAULT_SANDBOX;

  // phase를 이벤트에 포함해서 emit한다.
  function emit(event) {
    if (typeof onEvent === 'function') {
      onEvent(phase ? { phase, ...event } : event);
    }
  }

  if (signal && signal.aborted) {
    const failure = interruptedFailure();
    emit({ type: 'error', ...failureToEventFields(failure), timestamp: nowIso() });
    return Promise.resolve({ success: false, exitCode: 1, error: failure.user_message, failure });
  }

  // --- readiness check ---
  const avail = checkAvailability(workDir, { _spawnSyncFn });
  if (!avail.available) {
    const isBinaryNotFound = avail.detail === MSG_BINARY_NOT_FOUND || avail.detail.startsWith(MSG_BINARY_NOT_FOUND);
    const availFailure = classifyCodexFailure({
      kind:    isBinaryNotFound ? FAILURE_KINDS.PROVIDER_UNAVAILABLE : FAILURE_KINDS.PROVIDER_UNAVAILABLE,
      message: avail.detail,
    });
    emit({ type: 'error', ...failureToEventFields(availFailure), timestamp: nowIso() });
    return Promise.resolve({ success: false, exitCode: 1, error: avail.detail, failure: availFailure });
  }

  // --- login check ---
  const loginStatus = checkLogin(workDir, { _spawnSyncFn });
  if (!loginStatus.loggedIn) {
    const authFailure = classifyCodexFailure({ kind: FAILURE_KINDS.AUTH, message: MSG_AUTH_REQUIRED });
    emit({ type: 'error', ...failureToEventFields(authFailure), timestamp: nowIso() });
    return Promise.resolve({ success: false, exitCode: 1, error: MSG_AUTH_REQUIRED, failure: authFailure });
  }

  // --- do/iter + read-only sandbox 검증 ---
  // do/iter phase에서 read-only sandbox를 사용하면 파일 변경이 반영되지 않는다.
  if ((phase === 'do' || phase === 'iter') && sandboxValue === 'read-only') {
    const sandboxFailure = classifyCodexFailure({ kind: FAILURE_KINDS.SANDBOX, message: MSG_WRITE_PHASE_READ_ONLY });
    emit({ type: 'error', ...failureToEventFields(sandboxFailure), timestamp: nowIso() });
    return Promise.resolve({ success: false, exitCode: 1, error: MSG_WRITE_PHASE_READ_ONLY, failure: sandboxFailure });
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
    let brokerSession = null;
    let brokerCleanupDetail = null;
    let abortListener = null;

    function settle(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (signal && abortListener) {
        signal.removeEventListener('abort', abortListener);
        abortListener = null;
      }
      client.close().then(async () => {
        if (timedOut && brokerSession && !brokerSession.external) {
          const cleanup = await cleanupBrokerSession(workDir, brokerSession, _brokerOptions || {});
          if (!cleanup.ok) {
            brokerCleanupDetail = `${MSG_BROKER_CLEANUP_FAILED}: ${cleanup.errors.join('; ')}`;
          }
        }
        const finalResult = brokerCleanupDetail
          ? { ...result, cleanupError: brokerCleanupDetail }
          : result;
        resolve(finalResult);
      }).catch((err) => {
        const detail = `${MSG_BROKER_CLEANUP_FAILED}: ${err.message}`;
        resolve({ ...result, cleanupError: detail });
      });
    }

    function emitActiveProvider(status = 'running', interrupt = null) {
      if (!finalThreadId || !finalTurnId) return;
      emit({
        type: 'provider_metadata',
        provider: 'codex',
        active_provider: {
          provider: 'codex',
          threadId: finalThreadId,
          turnId: finalTurnId,
          phase: phase || null,
          status,
          cwd: workDir,
          ...(interrupt ? { interrupt } : {}),
          updatedAt: nowIso(),
        },
        timestamp: nowIso(),
      });
    }

    async function requestInterrupt() {
      if (!finalThreadId || !finalTurnId) {
        return { attempted: false, interrupted: false, detail: 'threadId와 turnId가 아직 기록되지 않았습니다.' };
      }
      try {
        await Promise.race([
          client.request('turn/interrupt', { threadId: finalThreadId, turnId: finalTurnId }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('turn/interrupt timed out')), 2000)),
        ]);
        const result = { attempted: true, interrupted: true, detail: `Interrupted ${finalTurnId} on ${finalThreadId}.` };
        emitActiveProvider('interrupted', result);
        return result;
      } catch (err) {
        const result = { attempted: true, interrupted: false, detail: err.message };
        emitActiveProvider('interrupt_failed', result);
        return result;
      }
    }

    // --- timeout ---
    // app-server 무응답 시 interrupt await가 hang될 수 있으므로
    // error emit + settle을 먼저 처리하고 interrupt는 best-effort로 처리한다.
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      if (settled) return;

      (async () => {
        const msg = `Codex 실행이 ${timeoutMs}ms 후 타임아웃되었습니다.`;
        const interrupt = await requestInterrupt();
        const userMessage = appendInterruptRisk(msg, interrupt);
        const timeoutFailure = withInterruptRiskMessage(
          classifyCodexFailure({ kind: FAILURE_KINDS.TIMEOUT, message: userMessage }),
          userMessage,
          interrupt
        );
        emit({ type: 'error', ...failureToEventFields(timeoutFailure), codex_interrupt: interrupt, timestamp: nowIso() });
        settle({
          success: false,
          exitCode: 1,
          error: userMessage,
          failure: timeoutFailure,
          providerMeta: { threadId: finalThreadId, turnId: finalTurnId, interrupt },
        });
      })();
    }, timeoutMs);

    abortListener = () => {
      if (settled) return;
      (async () => {
        const interrupt = await requestInterrupt();
        const userMessage = appendInterruptRisk(MSG_INTERRUPTED, interrupt);
        const failure = withInterruptRiskMessage(
          classifyCodexFailure({ kind: FAILURE_KINDS.INTERRUPTED, message: userMessage }),
          userMessage,
          interrupt
        );
        emit({ type: 'error', ...failureToEventFields(failure), codex_interrupt: interrupt, timestamp: nowIso() });
        settle({
          success: false,
          exitCode: 1,
          error: userMessage,
          failure,
          providerMeta: { threadId: finalThreadId, turnId: finalTurnId, interrupt },
        });
      })();
    };
    if (signal) {
      if (signal.aborted) abortListener();
      else signal.addEventListener('abort', abortListener, { once: true });
    }

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
        emitActiveProvider('running');
      }

      if (sandboxValue === 'read-only' && isReadOnlyFileChangeNotification(msg)) {
        const detail = `${MSG_READ_ONLY_FILE_CHANGE} (${describeFileChangeNotification(msg)})`;
        const sandboxFailure = classifyCodexFailure({ kind: FAILURE_KINDS.SANDBOX, message: detail });
        emit({ type: 'error', ...failureToEventFields(sandboxFailure), timestamp: nowIso() });
        settle({ success: false, exitCode: 1, error: MSG_READ_ONLY_FILE_CHANGE, failure: sandboxFailure });
        return;
      }

      const events = _notificationToEvents(msg);
      for (const rawEvt of events) {
        if (rawEvt.type === 'text_delta') {
          lastText = rawEvt.text;
        }

        // phase_end에 실제 경과 시간을 채운다 (_notificationToEvents는 순수함수라 null 반환).
        const evt = rawEvt.type === 'phase_end'
          ? { ...rawEvt, duration_ms: Date.now() - startTime, result: lastText }
          : rawEvt;

        if (evt.type === 'phase_end') {
          emitActiveProvider(evt.status || 'completed');
        }
        emit(evt);

        if (evt.type === 'phase_end' || evt.type === 'error') {
          const isSuccess = evt.type === 'phase_end' && evt.status === 'completed';
          const eventFailure = evt.type === 'error'
            ? (evt.failure || classifyCodexFailure({ kind: FAILURE_KINDS.UNKNOWN, message: evt.message }))
            : null;
          settle({
            success:      isSuccess,
            exitCode:     isSuccess ? 0 : 1,
            text:         lastText,
            error:        eventFailure ? eventFailure.user_message : undefined,
            failure:      eventFailure || undefined,
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
        const useBroker = !_disableBroker && (!_spawnFn || _brokerSpawnFn);
        if (useBroker) {
          const ensured = await ensureBrokerSession(workDir, {
            ...(_brokerOptions || {}),
            _spawnFn: _brokerSpawnFn || (_brokerOptions && _brokerOptions._spawnFn),
          });
          if (!ensured.session) {
            const detail = ensured.cleanupError || MSG_BROKER_START_FAILED;
            const brokerFailure = classifyCodexFailure({ brokerStartFailed: true, message: detail });
            emit({ type: 'error', ...failureToEventFields(brokerFailure), timestamp: nowIso() });
            settle({ success: false, exitCode: 1, error: detail, failure: brokerFailure });
            return;
          }
          brokerSession = ensured.session;
          await client.connectBroker(workDir, { brokerEndpoint: brokerSession.endpoint });
        } else {
          client.spawn(workDir, { _spawnFn });
        }
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
        emitActiveProvider('running');

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
        if (timedOut) return;
        if (!settled) {
          const errMsg = timedOut
            ? `Codex 실행이 ${timeoutMs}ms 후 타임아웃되었습니다.`
            : err.rpcCode === BROKER_BUSY_RPC_CODE
              ? MSG_BROKER_BUSY
            : (err.message || 'Codex app-server 실행 실패');
          const catchFailure = timedOut
            ? classifyCodexFailure({ kind: FAILURE_KINDS.TIMEOUT, message: errMsg })
            : err.rpcCode === BROKER_BUSY_RPC_CODE
              ? classifyCodexFailure({ brokerBusy: true, message: errMsg })
              : classifyCodexFailure({ kind: FAILURE_KINDS.UNKNOWN, message: errMsg });
          emit({ type: 'error', ...failureToEventFields(catchFailure), timestamp: nowIso() });
          settle({ success: false, exitCode: 1, error: errMsg, failure: catchFailure });
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
  MSG_READ_ONLY_FILE_CHANGE,
  MSG_BROKER_START_FAILED,
  MSG_BROKER_CLEANUP_FAILED,
  MSG_BROKER_BUSY,
  MSG_INTERRUPTED,
  SANDBOX_TO_CODEX,
  BROKER_ENDPOINT_ENV,
  _AppServerJsonRpcClient,
  _notificationToEvents,
  _ensureBrokerSession: ensureBrokerSession,
  _cleanupBrokerSession: cleanupBrokerSession,
  _loadBrokerSession: loadBrokerSession,
  _waitForBrokerEndpoint: waitForBrokerEndpoint,
  _createBrokerEndpoint: createBrokerEndpoint,
  _parseBrokerEndpoint: parseBrokerEndpoint,
};
