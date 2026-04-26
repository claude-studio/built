#!/usr/bin/env node
/**
 * abort.js
 *
 * /built:abort <feature> 스킬 헬퍼 — 실행 중인 feature를 중단한다.
 * 외부 npm 패키지 없음 (Node.js fs/path만).
 *
 * 동작:
 *   1. .built/runtime/runs/<feature>/state.json status를 "aborted"로 갱신
 *   2. .built/runtime/locks/<feature>.lock 파일 삭제
 *   3. .built/runtime/registry.json에서 해당 feature status를 "aborted"로 갱신
 *   - feature가 없거나 이미 종료된 경우 적절한 메시지 출력
 *
 * 사용법:
 *   node scripts/abort.js <feature>
 *
 * Exit codes:
 *   0 — 성공 또는 이미 종료됨
 *   1 — 오류 (feature 미지정 등)
 *
 * API (모듈로도 사용 가능):
 *   abortCommand(projectRoot, feature) -> { output: string, aborted: boolean }
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { interruptCodexTurn } = require(path.join(__dirname, '..', 'src', 'providers', 'codex'));
const {
  loadActiveCodexTurn,
  recordCodexInterruptResult,
} = require(path.join(__dirname, '..', 'src', 'codex-active-turn'));

const DEFAULT_INTERRUPT_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// 내부 유틸
// ---------------------------------------------------------------------------

function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function writeJsonSafe(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/** 이미 종료된 상태인지 확인 */
function isTerminalStatus(status) {
  return status === 'aborted' || status === 'completed' || status === 'failed';
}

function normalizeInterruptFailure(err) {
  return {
    attempted: true,
    interrupted: false,
    detail: err && err.message ? err.message : String(err || 'Codex interrupt failed.'),
  };
}

function withInterruptTimeout(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

  let timer = null;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => {
      resolve({
        attempted: true,
        interrupted: false,
        detail: `Codex turn/interrupt timed out after ${timeoutMs}ms.`,
      });
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// ---------------------------------------------------------------------------
// 핵심 함수
// ---------------------------------------------------------------------------

/**
 * state.json status를 "aborted"로 갱신.
 * @param {string} runDir  .built/runtime/runs/<feature>/ 절대경로
 * @returns {boolean} 갱신 성공 여부
 */
function updateStateAborted(runDir) {
  const stateFile = path.join(runDir, 'state.json');
  const state = readJsonSafe(stateFile);
  if (!state) return false;

  state.status    = 'aborted';
  state.updatedAt = new Date().toISOString();
  writeJsonSafe(stateFile, state);
  return true;
}

async function interruptActiveProvider(projectRoot, feature, runDir, state, opts = {}) {
  const active = loadActiveCodexTurn(projectRoot, feature);
  const providerName = (state && state.provider) || (active && active.provider);
  if (providerName !== 'codex' || !active) {
    return null;
  }

  const interruptFn = opts.interruptCodexTurn || interruptCodexTurn;
  const interruptCwd = active.cwd
    || (state && state.execution_worktree && state.execution_worktree.path)
    || projectRoot;
  const timeoutMs = opts.interruptTimeoutMs === undefined
    ? DEFAULT_INTERRUPT_TIMEOUT_MS
    : opts.interruptTimeoutMs;
  const result = await withInterruptTimeout(
    Promise.resolve().then(() => interruptFn({
      cwd: interruptCwd,
      threadId: active.threadId,
      turnId: active.turnId,
    })).catch(normalizeInterruptFailure),
    timeoutMs
  );
  recordCodexInterruptResult(runDir, result);
  return result;
}

/**
 * lock 파일 삭제.
 * @param {string} locksDir  .built/runtime/locks/ 절대경로
 * @param {string} feature
 * @returns {boolean} 삭제했으면 true, 파일이 없어서 패스하면 false
 */
function removeLock(locksDir, feature) {
  const lockFile = path.join(locksDir, `${feature}.lock`);
  try {
    fs.unlinkSync(lockFile);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * registry.json의 feature status를 "aborted"로 갱신.
 * @param {string} runtimeDir
 * @param {string} feature
 */
function updateRegistryAborted(runtimeDir, feature) {
  const registryFile = path.join(runtimeDir, 'registry.json');
  const registry = readJsonSafe(registryFile);
  if (!registry || !registry.features) return;

  if (registry.features[feature] !== undefined) {
    registry.features[feature] = Object.assign({}, registry.features[feature], {
      status:    'aborted',
      updatedAt: new Date().toISOString(),
    });
    writeJsonSafe(registryFile, registry);
  }
}

// ---------------------------------------------------------------------------
// 커맨드 함수
// ---------------------------------------------------------------------------

/**
 * /built:abort <feature> 실행.
 * @param {string} projectRoot
 * @param {string} feature
 * @returns {{ output: string, aborted: boolean }}
 */
async function abortCommand(projectRoot, feature, opts = {}) {
  if (!feature) {
    return { output: 'Usage: /built:abort <feature>', aborted: false };
  }

  const runtimeDir = path.join(projectRoot, '.built', 'runtime');
  const runsDir    = path.join(runtimeDir, 'runs');
  const locksDir   = path.join(runtimeDir, 'locks');
  const runDir     = path.join(runsDir, feature);
  const stateFile  = path.join(runDir, 'state.json');

  // .built/runtime 없으면 feature 없음
  if (!fs.existsSync(runtimeDir)) {
    return { output: `No feature found: ${feature}`, aborted: false };
  }

  const state = readJsonSafe(stateFile);

  // state.json 없으면 feature 없음
  if (!state) {
    return { output: `No feature found: ${feature}`, aborted: false };
  }

  // 이미 종료된 상태
  if (isTerminalStatus(state.status)) {
    return {
      output: `Feature '${feature}' is already in terminal state: ${state.status}`,
      aborted: false,
    };
  }

  // 1. state.json 갱신
  updateStateAborted(runDir);

  // 2. lock 삭제
  const lockRemoved = removeLock(locksDir, feature);

  // 3. registry 갱신
  updateRegistryAborted(runtimeDir, feature);

  // 4. active provider interrupt. State/registry/lock cleanup must not wait
  // indefinitely on an unresponsive app-server/broker.
  const interruptResult = await interruptActiveProvider(projectRoot, feature, runDir, state, opts);

  const lockMsg = lockRemoved ? ' lock removed.' : '';
  let interruptMsg = '';
  if (interruptResult) {
    interruptMsg = interruptResult.interrupted
      ? ' Codex active turn interrupted.'
      : ` Codex active turn interrupt failed: ${interruptResult.detail}. 작업이 아직 계속될 수 있습니다. codex app-server/broker 프로세스를 확인하고 필요하면 수동으로 종료하세요.`;
  }
  return {
    output: `Aborted feature '${feature}'.${lockMsg}${interruptMsg}`,
    aborted: true,
  };
}

// ---------------------------------------------------------------------------
// CLI 진입점
// ---------------------------------------------------------------------------

if (require.main === module) {
  (async () => {
    const args    = process.argv.slice(2);
    const feature = args.find((a) => !a.startsWith('--')) || null;

    const projectRoot = process.cwd();

    try {
      const { output } = await abortCommand(projectRoot, feature);
      console.log(output);
      process.exit(0);
    } catch (err) {
      console.error('error: ' + err.message);
      process.exit(1);
    }
  })();
}

module.exports = {
  abortCommand,
  updateStateAborted,
  removeLock,
  updateRegistryAborted,
  isTerminalStatus,
};
