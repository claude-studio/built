/**
 * src/providers/doctor.js
 *
 * provider 환경 사전 점검(diagnostics) 핵심 로직.
 * 실제 모델 호출 없이 Codex CLI 설치, app-server 지원, 인증 상태,
 * broker 상태, stale broker 후보, run-request provider 설정 유효성을 점검한다.
 *
 * API:
 *   runDoctorChecks(opts)
 *     opts: { cwd?, featureId?, _spawnSyncFn? }
 *     → CheckResult[]
 *
 * CheckResult: { id, status: 'ok'|'warn'|'fail', label, message, action? }
 *
 * 이 모듈은 pure function으로 구성된다. process.exit, process.argv를 사용하지 않는다.
 * 출력 포맷과 CLI 처리는 scripts/provider-doctor.js가 담당한다.
 *
 * docs/ops/provider-setup-guide.md 참고.
 * docs/smoke-testing.md, docs/contracts/provider-config.md 참고.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { checkAvailability, checkLogin, _loadBrokerSession } = require('./codex');
const { parseProviderConfig }                                = require('./config');
const { getAll: registryGetAll }                            = require('../../src/registry');
const { looksLikePluginRoot }                               = require('../../src/root-context');

// ---------------------------------------------------------------------------
// 내부 유틸
// ---------------------------------------------------------------------------

/**
 * CheckResult 객체 생성 헬퍼.
 *
 * @param {string} id        유니크 식별자
 * @param {'ok'|'warn'|'fail'} status  점검 상태
 * @param {string} label     사람이 읽는 점검 항목명
 * @param {string} message   상태 설명
 * @param {string} [action]  권장 조치
 * @returns {object}
 */
function makeResult(id, status, label, message, action) {
  const r = { id, status, label, message };
  if (action) r.action = action;
  return r;
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

// ---------------------------------------------------------------------------
// 개별 점검 함수
// ---------------------------------------------------------------------------

/**
 * 1. Codex CLI 설치 여부 점검.
 * @param {string} cwd
 * @param {object} spawnOpts  테스트용 주입 옵션 (_spawnSyncFn)
 * @returns {object} CheckResult
 */
function checkCodexInstall(cwd, spawnOpts) {
  const result = checkAvailability(cwd, spawnOpts);
  if (result.available) {
    return makeResult(
      'codex_install',
      'ok',
      'Codex CLI 설치',
      `설치됨 (${result.detail})`,
    );
  }
  const isAppServerIssue = result.detail && result.detail.includes('app-server');
  if (isAppServerIssue) {
    // app-server 문제는 별도 점검 항목에서 세분화
    return makeResult(
      'codex_install',
      'ok',
      'Codex CLI 설치',
      'Codex CLI가 설치되어 있습니다.',
    );
  }
  return makeResult(
    'codex_install',
    'fail',
    'Codex CLI 설치',
    'Codex CLI를 찾을 수 없습니다.',
    'npm install -g @openai/codex 를 실행하세요.',
  );
}

/**
 * 2. Codex app-server 지원 여부 점검.
 * @param {string} cwd
 * @param {object} spawnOpts
 * @returns {object} CheckResult
 */
function checkAppServerSupport(cwd, spawnOpts) {
  const result = checkAvailability(cwd, spawnOpts);
  if (!result.available) {
    const isAppServerIssue = result.detail && result.detail.includes('app-server');
    if (isAppServerIssue) {
      return makeResult(
        'codex_app_server',
        'fail',
        'Codex app-server 지원',
        '현재 Codex CLI가 app-server를 지원하지 않습니다.',
        'Codex CLI를 최신 버전으로 업데이트하세요: npm update -g @openai/codex',
      );
    }
    return makeResult(
      'codex_app_server',
      'fail',
      'Codex app-server 지원',
      'Codex CLI가 없어 app-server 지원 여부를 확인할 수 없습니다.',
      'Codex CLI를 먼저 설치하세요.',
    );
  }
  return makeResult(
    'codex_app_server',
    'ok',
    'Codex app-server 지원',
    'app-server 명령이 지원됩니다.',
  );
}

/**
 * 3. Codex 인증/로그인 상태 점검.
 * @param {string} cwd
 * @param {object} spawnOpts
 * @returns {object} CheckResult
 */
function checkCodexAuth(cwd, spawnOpts) {
  const result = checkLogin(cwd, spawnOpts);
  if (!result.available) {
    return makeResult(
      'codex_auth',
      'fail',
      'Codex 인증 상태',
      'Codex CLI를 사용할 수 없어 인증 상태를 확인할 수 없습니다.',
      'Codex CLI를 설치한 뒤 codex login 을 실행하세요.',
    );
  }
  if (result.loggedIn) {
    return makeResult(
      'codex_auth',
      'ok',
      'Codex 인증 상태',
      '인증됨',
    );
  }
  return makeResult(
    'codex_auth',
    'fail',
    'Codex 인증 상태',
    'Codex 로그인 상태가 아닙니다.',
    'codex login 을 실행한 뒤 다시 시도하세요.',
  );
}

/**
 * 4. Broker endpoint 접근성 및 stale broker 후보 점검.
 * @param {string} cwd
 * @returns {object[]} CheckResult[]
 */
function checkBrokerState(cwd) {
  const session = _loadBrokerSession(cwd);

  if (!session) {
    return [makeResult(
      'broker_state',
      'ok',
      'Broker 상태',
      '활성 broker session이 없습니다.',
    )];
  }

  const { endpoint, pid, startedAt } = session;
  const pidAlive = isProcessAlive(pid);

  if (!pidAlive) {
    return [makeResult(
      'broker_state',
      'warn',
      'Broker 상태',
      `Broker session 파일이 있지만 PID ${pid}가 실행 중이 아닙니다. Stale broker 후보입니다.`,
      '다음 실행 시 built가 자동으로 stale session을 정리합니다. 직접 정리하려면 .built/runtime/codex-broker.json 을 삭제하세요.',
    )];
  }

  let endpointAccessible = false;
  if (endpoint && typeof endpoint === 'string') {
    try {
      if (endpoint.startsWith('unix:')) {
        const sockPath = endpoint.replace(/^unix:/, '');
        endpointAccessible = fs.existsSync(sockPath);
      } else if (endpoint.startsWith('pipe:')) {
        // Windows named pipe: pid가 살아 있으면 접근 가능으로 간주
        endpointAccessible = true;
      }
    } catch (_) {
      endpointAccessible = false;
    }
  }

  if (endpointAccessible) {
    return [makeResult(
      'broker_state',
      'ok',
      'Broker 상태',
      `Broker가 실행 중입니다. (PID: ${pid}, 시작: ${startedAt || 'unknown'})`,
    )];
  }

  return [makeResult(
    'broker_state',
    'warn',
    'Broker 상태',
    `Broker PID ${pid}가 살아 있지만 endpoint(${endpoint || 'none'})에 소켓이 없습니다. Stale 후보입니다.`,
    '다음 실행 시 built가 자동으로 상태를 재확인합니다.',
  )];
}

/**
 * 5. Broker lock 상태 점검.
 * @param {string} cwd
 * @returns {object} CheckResult
 */
function checkBrokerLock(cwd) {
  const runtimeDir = path.join(cwd, '.built', 'runtime');
  const lockFile   = path.join(runtimeDir, 'codex-broker.lock');

  if (!fs.existsSync(lockFile)) {
    return makeResult(
      'broker_lock',
      'ok',
      'Broker Lock',
      '활성 broker lock이 없습니다.',
    );
  }

  let lock = null;
  try {
    lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  } catch (_) {
    return makeResult(
      'broker_lock',
      'warn',
      'Broker Lock',
      'Broker lock 파일이 있지만 파싱할 수 없습니다. Stale lock 후보입니다.',
      '.built/runtime/codex-broker.lock 을 삭제하세요.',
    );
  }

  const staleLimitMs = 30 * 1000;
  const now          = Date.now();
  const pidAlive     = isProcessAlive(lock.pid);
  const staleByTime  = Number.isFinite(lock.created_ms) && (now - lock.created_ms > staleLimitMs);

  if (!pidAlive || staleByTime) {
    return makeResult(
      'broker_lock',
      'warn',
      'Broker Lock',
      `Broker lock (PID: ${lock.pid})이 stale 상태로 보입니다.`,
      '다음 실행 시 built가 자동으로 stale lock을 제거합니다. 직접 정리하려면 .built/runtime/codex-broker.lock 을 삭제하세요.',
    );
  }

  return makeResult(
    'broker_lock',
    'warn',
    'Broker Lock',
    `Broker lock이 활성 상태입니다 (PID: ${lock.pid}). 다른 실행이 broker를 시작 중일 수 있습니다.`,
    '이미 실행 중인 built 작업이 있는지 확인하세요.',
  );
}

/**
 * 6. run-request provider 설정 유효성 점검.
 * @param {string} cwd
 * @param {string} featureId
 * @returns {object[]} CheckResult[]
 */
function checkRunRequestConfig(cwd, featureId) {
  if (!featureId) return [];

  const runRequestPath = path.join(
    cwd, '.built', 'runtime', 'runs', featureId, 'run-request.json',
  );

  if (!fs.existsSync(runRequestPath)) {
    return [makeResult(
      'run_request_config',
      'warn',
      `run-request 설정 (${featureId})`,
      `run-request.json을 찾을 수 없습니다: ${runRequestPath}`,
      `feature '${featureId}'의 run-request.json이 생성된 뒤 다시 점검하세요.`,
    )];
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(runRequestPath, 'utf8'));
  } catch (err) {
    return [makeResult(
      'run_request_config',
      'fail',
      `run-request 설정 (${featureId})`,
      `run-request.json 파싱 실패: ${err.message}`,
      'run-request.json의 JSON 형식을 확인하세요.',
    )];
  }

  let config;
  try {
    config = parseProviderConfig(raw);
  } catch (err) {
    return [makeResult(
      'run_request_config',
      'fail',
      `run-request 설정 (${featureId})`,
      `provider 설정 오류: ${err.message}`,
      'run-request.json의 providers 필드를 확인하세요. docs/contracts/provider-config.md 참고.',
    )];
  }

  const phases = Object.keys(config);
  if (phases.length === 0) {
    return [makeResult(
      'run_request_config',
      'ok',
      `run-request 설정 (${featureId})`,
      'provider 설정 없음 — 모든 phase가 Claude 기본값으로 실행됩니다.',
    )];
  }

  return phases.map((phase) => {
    const spec = config[phase];
    return makeResult(
      `run_request_config_${phase}`,
      'ok',
      `run-request 설정 — ${phase} phase`,
      `provider: ${spec.name}${spec.sandbox ? `, sandbox: ${spec.sandbox}` : ''}${spec.timeout_ms ? `, timeout: ${spec.timeout_ms}ms` : ''}`,
    );
  });
}

/**
 * 7. Feature Registry 상태 점검 (실행 중인 feature 확인).
 * @param {string} cwd
 * @returns {object} CheckResult
 */
function checkRegistry(cwd) {
  const runtimeDir = path.join(cwd, '.built', 'runtime');
  let features;
  try {
    features = registryGetAll(runtimeDir);
  } catch (_) {
    return makeResult(
      'registry',
      'ok',
      'Feature Registry',
      'registry.json이 없거나 비어 있습니다.',
    );
  }

  if (!features || Object.keys(features).length === 0) {
    return makeResult(
      'registry',
      'ok',
      'Feature Registry',
      '활성 feature가 없습니다.',
    );
  }

  const running = Object.values(features).filter((f) => f.status === 'running');
  if (running.length === 0) {
    return makeResult(
      'registry',
      'ok',
      'Feature Registry',
      `등록된 feature ${Object.keys(features).length}개 (실행 중 없음)`,
    );
  }

  const runningIds = running.map((f) => f.featureId).join(', ');
  return makeResult(
    'registry',
    'warn',
    'Feature Registry',
    `실행 중인 feature가 있습니다: ${runningIds}`,
    '동시 실행 시 broker 경합이 발생할 수 있습니다.',
  );
}

/**
 * 8. Target project root와 plugin repo root 혼동 점검.
 * @param {string} cwd
 * @param {string} featureId
 * @returns {object} CheckResult
 */
function checkRootSeparation(cwd, featureId) {
  const projectRoot = path.resolve(cwd);
  const featureSpecPath = featureId
    ? path.join(projectRoot, '.built', 'features', `${featureId}.md`)
    : null;
  const featureSpecExists = featureSpecPath ? fs.existsSync(featureSpecPath) : false;
  const builtConfigExists = fs.existsSync(path.join(projectRoot, '.built', 'config.json'));
  const pluginLike = looksLikePluginRoot(projectRoot);

  if (featureId && !featureSpecExists && pluginLike) {
    return makeResult(
      'root_separation',
      'fail',
      'Root 분리',
      `현재 cwd가 plugin/repository root로 보이며 target feature spec이 없습니다: ${featureSpecPath}`,
      'target project root에서 doctor를 실행하거나 --cwd <target-project-root>를 지정하세요.',
    );
  }

  if (pluginLike && !builtConfigExists) {
    return makeResult(
      'root_separation',
      'warn',
      'Root 분리',
      '현재 cwd가 plugin/repository root로 보입니다. target project root와 분리된 실행인지 확인하세요.',
      'target project를 점검하려면 node scripts/provider-doctor.js --cwd <target-project-root>를 사용하세요.',
    );
  }

  return makeResult(
    'root_separation',
    'ok',
    'Root 분리',
    'target project root 기준으로 점검 중입니다.',
  );
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * 모든 점검을 실행하고 결과 배열을 반환한다.
 *
 * @param {object} [opts]
 * @param {string}   [opts.cwd]          점검할 워크스페이스 경로 (기본: process.cwd())
 * @param {string}   [opts.featureId]    특정 feature의 run-request.json 점검
 * @param {object}   [opts._spawnSyncFn] 테스트용 spawnSync 주입
 * @returns {Array<{id: string, status: 'ok'|'warn'|'fail', label: string, message: string, action?: string}>}
 */
function runDoctorChecks(opts = {}) {
  const cwd       = opts.cwd || process.cwd();
  const featureId = opts.featureId || null;
  const spawnOpts = opts._spawnSyncFn ? { _spawnSyncFn: opts._spawnSyncFn } : {};

  const checks = [];

  checks.push(checkCodexInstall(cwd, spawnOpts));
  checks.push(checkAppServerSupport(cwd, spawnOpts));
  checks.push(checkCodexAuth(cwd, spawnOpts));
  checks.push(...checkBrokerState(cwd));
  checks.push(checkBrokerLock(cwd));
  if (featureId) {
    checks.push(...checkRunRequestConfig(cwd, featureId));
  }
  checks.push(checkRootSeparation(cwd, featureId));
  checks.push(checkRegistry(cwd));

  return checks;
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = {
  runDoctorChecks,
  // 개별 점검 함수 (테스트용)
  checkCodexInstall,
  checkAppServerSupport,
  checkCodexAuth,
  checkBrokerState,
  checkBrokerLock,
  checkRunRequestConfig,
  checkRootSeparation,
  checkRegistry,
};
