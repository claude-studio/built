#!/usr/bin/env node
/**
 * resume.js
 *
 * /built:resume <feature> 스킬 헬퍼 — 중단된 feature를 재실행 가능 상태로 복원한다.
 * 외부 npm 패키지 없음 (Node.js fs/path만).
 *
 * 동작:
 *   1. .built/runtime/runs/<feature>/state.json status를 "planned"로 초기화 (재실행 대기)
 *   2. .built/runtime/locks/<feature>.lock 삭제 (없으면 오류 없이 통과)
 *   3. .built/runtime/registry.json의 feature status를 "planned"로 갱신
 *   - feature가 없거나 이미 실행 중인 경우 적절한 메시지 출력
 *
 * 사용법:
 *   node scripts/resume.js <feature>
 *
 * Exit codes:
 *   0 — 성공 또는 이미 실행 가능 상태
 *   1 — 오류 (feature 미지정 등)
 *
 * API (모듈로도 사용 가능):
 *   resumeCommand(projectRoot, feature) -> { output: string, resumed: boolean }
 */

'use strict';

const fs   = require('fs');
const path = require('path');

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

/** 실행 중 또는 이미 완료된 상태인지 확인 */
function isActiveOrCompleted(status) {
  return status === 'running' || status === 'completed';
}

// ---------------------------------------------------------------------------
// 핵심 함수
// ---------------------------------------------------------------------------

/**
 * state.json status를 "planned"로 초기화.
 * @param {string} runDir  .built/runtime/runs/<feature>/ 절대경로
 * @returns {boolean} 갱신 성공 여부
 */
function updateStatePlanned(runDir) {
  const stateFile = path.join(runDir, 'state.json');
  const state = readJsonSafe(stateFile);
  if (!state) return false;

  state.status    = 'planned';
  state.updatedAt = new Date().toISOString();
  // 재실행 준비이므로 last_error 초기화
  state.last_error = null;
  writeJsonSafe(stateFile, state);
  return true;
}

/**
 * lock 파일 삭제. 없으면 오류 없이 통과.
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
 * registry.json의 feature status를 "planned"로 갱신.
 * @param {string} runtimeDir
 * @param {string} feature
 */
function updateRegistryPlanned(runtimeDir, feature) {
  const registryFile = path.join(runtimeDir, 'registry.json');
  const registry = readJsonSafe(registryFile);
  if (!registry || !registry.features) return;

  if (registry.features[feature] !== undefined) {
    registry.features[feature] = Object.assign({}, registry.features[feature], {
      status:    'planned',
      updatedAt: new Date().toISOString(),
    });
    writeJsonSafe(registryFile, registry);
  }
}

// ---------------------------------------------------------------------------
// 커맨드 함수
// ---------------------------------------------------------------------------

/**
 * /built:resume <feature> 실행.
 * @param {string} projectRoot
 * @param {string} feature
 * @returns {{ output: string, resumed: boolean }}
 */
function resumeCommand(projectRoot, feature) {
  if (!feature) {
    return { output: 'Usage: /built:resume <feature>', resumed: false };
  }

  const runtimeDir = path.join(projectRoot, '.built', 'runtime');
  const runsDir    = path.join(runtimeDir, 'runs');
  const locksDir   = path.join(runtimeDir, 'locks');
  const runDir     = path.join(runsDir, feature);
  const stateFile  = path.join(runDir, 'state.json');

  // .built/runtime 없으면 feature 없음
  if (!fs.existsSync(runtimeDir)) {
    return { output: `No feature found: ${feature}`, resumed: false };
  }

  const state = readJsonSafe(stateFile);

  // state.json 없으면 feature 없음
  if (!state) {
    return { output: `No feature found: ${feature}`, resumed: false };
  }

  // 이미 실행 중이거나 완료된 상태
  if (isActiveOrCompleted(state.status)) {
    return {
      output: `Feature '${feature}' is already in state: ${state.status}`,
      resumed: false,
    };
  }

  // 1. state.json 갱신
  updateStatePlanned(runDir);

  // 2. lock 삭제 (없어도 오류 없이 통과)
  removeLock(locksDir, feature);

  // 3. registry 갱신
  updateRegistryPlanned(runtimeDir, feature);

  return {
    output: `Resumed feature '${feature}'. Status reset to planned.`,
    resumed: true,
  };
}

// ---------------------------------------------------------------------------
// CLI 진입점
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args    = process.argv.slice(2);
  const feature = args.find((a) => !a.startsWith('--')) || null;

  const projectRoot = process.cwd();

  try {
    const { output } = resumeCommand(projectRoot, feature);
    console.log(output);
    process.exit(0);
  } catch (err) {
    console.error('error: ' + err.message);
    process.exit(1);
  }
}

module.exports = {
  resumeCommand,
  updateStatePlanned,
  removeLock,
  updateRegistryPlanned,
  isActiveOrCompleted,
};
