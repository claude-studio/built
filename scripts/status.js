#!/usr/bin/env node
/**
 * status.js
 *
 * /built:status, /built:list 스킬 헬퍼 — state.json / registry.json 기반 진행 상황 조회.
 * 외부 npm 패키지 없음 (Node.js fs/path만).
 *
 * 사용법:
 *   node scripts/status.js [feature]   # /built:status [feature]
 *   node scripts/status.js --list      # /built:list
 *
 * 동작:
 *   --list (또는 feature 미지정 + --list):
 *     .built/runtime/registry.json 읽어 등록된 feature 목록 출력
 *
 *   feature 미지정 (status 모드):
 *     registry.json에서 모든 feature 읽어 각 state.json 요약 출력
 *
 *   feature 지정 (status 모드):
 *     .built/runtime/runs/<feature>/state.json, progress.json 읽어 상세 출력
 *
 * Exit codes:
 *   0 — 성공
 *   1 — 오류
 *
 * API (모듈로도 사용 가능):
 *   readRegistry(runtimeDir)          -> { version, features: { [name]: {...} } }
 *   readStateFile(runDir)             -> state 객체 또는 null
 *   readProgressFile(runDir)          -> progress 객체 또는 null
 *   formatStatus(feature, state, progress) -> 출력 문자열
 *   formatList(registry)             -> 출력 문자열
 *   statusCommand(projectRoot, feature) -> { output: string, found: boolean }
 *   listCommand(projectRoot)          -> { output: string }
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// 내부 유틸
// ---------------------------------------------------------------------------

/**
 * JSON 파일을 읽어 파싱. 파일이 없거나 파싱 실패 시 null 반환.
 * @param {string} filePath
 * @returns {object|null}
 */
function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/**
 * ISO8601 문자열을 "N분 전" / "N시간 전" 등 상대 시간으로 변환.
 * @param {string|null} isoStr
 * @returns {string}
 */
function relativeTime(isoStr) {
  if (!isoStr) return '-';
  const diffMs = Date.now() - new Date(isoStr).getTime();
  if (isNaN(diffMs)) return isoStr;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60)       return `${diffSec}초 전`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60)       return `${diffMin}분 전`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)        return `${diffHr}시간 전`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}일 전`;
}

// ---------------------------------------------------------------------------
// 핵심 읽기 함수
// ---------------------------------------------------------------------------

/**
 * registry.json 읽기.
 * @param {string} runtimeDir  .built/runtime/ 절대경로
 * @returns {{ version: number, features: object }|null}
 */
function readRegistry(runtimeDir) {
  return readJsonSafe(path.join(runtimeDir, 'registry.json'));
}

/**
 * state.json 읽기.
 * @param {string} runDir  .built/runtime/runs/<feature>/ 절대경로
 * @returns {object|null}
 */
function readStateFile(runDir) {
  return readJsonSafe(path.join(runDir, 'state.json'));
}

/**
 * progress.json 읽기.
 * @param {string} runDir
 * @returns {object|null}
 */
function readProgressFile(runDir) {
  return readJsonSafe(path.join(runDir, 'progress.json'));
}

// ---------------------------------------------------------------------------
// 포맷 함수
// ---------------------------------------------------------------------------

/**
 * 단일 feature 상태 출력 문자열 생성.
 * @param {string} feature
 * @param {object|null} state
 * @param {object|null} progress
 * @returns {string}
 */
function formatStatus(feature, state, progress) {
  const lines = [];
  lines.push(`feature: ${feature}`);

  if (!state) {
    lines.push('  state: no state file found');
    return lines.join('\n');
  }

  lines.push(`  phase:       ${state.phase || '-'}`);
  lines.push(`  status:      ${state.status || '-'}`);
  lines.push(`  pid:         ${state.pid != null ? state.pid : '-'}`);
  lines.push(`  heartbeat:   ${relativeTime(state.heartbeat)}`);
  lines.push(`  attempt:     ${state.attempt != null ? state.attempt : '-'}`);
  lines.push(`  started:     ${relativeTime(state.startedAt)}`);
  lines.push(`  updated:     ${relativeTime(state.updatedAt)}`);

  if (state.last_error) {
    const errMsg = typeof state.last_error === 'string'
      ? state.last_error
      : JSON.stringify(state.last_error);
    lines.push(`  last_error:  ${errMsg}`);
  }

  if (progress) {
    if (progress.message)    lines.push(`  progress:    ${progress.message}`);
    if (progress.step != null && progress.total != null) {
      lines.push(`  steps:       ${progress.step}/${progress.total}`);
    }
    if (progress.iteration != null) {
      lines.push(`  iteration:   ${progress.iteration}`);
    }
  }

  return lines.join('\n');
}

/**
 * feature 목록 출력 문자열 생성 (/built:list 용).
 * @param {object} registry  readRegistry() 반환값
 * @param {string} runtimeDir  .built/runtime/ 절대경로
 * @returns {string}
 */
function formatList(registry, runtimeDir) {
  const features = registry && registry.features ? registry.features : {};
  const names = Object.keys(features);

  if (names.length === 0) {
    return 'No active features found.';
  }

  const lines = [];
  lines.push(`Active features (${names.length}):`);
  lines.push('');

  for (const name of names) {
    const meta  = features[name] || {};
    const runDir = path.join(runtimeDir, 'runs', name);
    const state  = readStateFile(runDir);

    const phase   = state ? (state.phase  || '-') : '-';
    const status  = state ? (state.status || '-') : '-';
    const updated = state
      ? relativeTime(state.updatedAt || state.heartbeat)
      : relativeTime(meta.updatedAt);

    lines.push(`  ${name}`);
    lines.push(`    status:  ${status}  phase: ${phase}  updated: ${updated}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 커맨드 함수
// ---------------------------------------------------------------------------

/**
 * /built:status [feature] 실행.
 * @param {string} projectRoot
 * @param {string|null} feature  feature 이름 (미지정 시 null)
 * @returns {{ output: string, found: boolean }}
 */
function statusCommand(projectRoot, feature) {
  const runtimeDir = path.join(projectRoot, '.built', 'runtime');
  const runsDir    = path.join(runtimeDir, 'runs');

  // .built/runtime 없으면 early exit
  if (!fs.existsSync(runtimeDir)) {
    return { output: 'No runs found.', found: false };
  }

  if (feature) {
    // 특정 feature 상세 조회
    const runDir  = path.join(runsDir, feature);
    const state   = readStateFile(runDir);
    const progress = readProgressFile(runDir);

    if (!state) {
      return {
        output: `No runs found for feature: ${feature}`,
        found: false,
      };
    }

    return { output: formatStatus(feature, state, progress), found: true };
  }

  // feature 미지정 — registry 기반 전체 요약
  const registry = readRegistry(runtimeDir);

  if (!registry || !registry.features || Object.keys(registry.features).length === 0) {
    // registry 없으면 runs/ 디렉토리에서 직접 탐색
    if (!fs.existsSync(runsDir)) {
      return { output: 'No runs found.', found: false };
    }

    let entries;
    try {
      entries = fs.readdirSync(runsDir).filter((e) => {
        return fs.statSync(path.join(runsDir, e)).isDirectory();
      });
    } catch (_) {
      return { output: 'No runs found.', found: false };
    }

    if (entries.length === 0) {
      return { output: 'No runs found.', found: false };
    }

    const blocks = entries.map((name) => {
      const runDir  = path.join(runsDir, name);
      const state   = readStateFile(runDir);
      const progress = readProgressFile(runDir);
      return formatStatus(name, state, progress);
    });

    return { output: blocks.join('\n\n'), found: true };
  }

  // registry 있음 — 각 feature state 요약
  const blocks = Object.keys(registry.features).map((name) => {
    const runDir  = path.join(runsDir, name);
    const state   = readStateFile(runDir);
    const progress = readProgressFile(runDir);
    return formatStatus(name, state, progress);
  });

  return { output: blocks.join('\n\n'), found: true };
}

/**
 * /built:list 실행.
 * @param {string} projectRoot
 * @returns {{ output: string }}
 */
function listCommand(projectRoot) {
  const runtimeDir = path.join(projectRoot, '.built', 'runtime');

  if (!fs.existsSync(runtimeDir)) {
    return { output: 'No runs found.' };
  }

  const registry = readRegistry(runtimeDir);

  if (!registry || !registry.features || Object.keys(registry.features).length === 0) {
    // registry 없으면 runs/ 디렉토리 기반 폴백
    const runsDir = path.join(runtimeDir, 'runs');
    if (!fs.existsSync(runsDir)) {
      return { output: 'No active features found.' };
    }

    let entries;
    try {
      entries = fs.readdirSync(runsDir).filter((e) => {
        return fs.statSync(path.join(runsDir, e)).isDirectory();
      });
    } catch (_) {
      return { output: 'No active features found.' };
    }

    if (entries.length === 0) {
      return { output: 'No active features found.' };
    }

    // 임시 registry 객체 생성
    const syntheticRegistry = { features: {} };
    for (const name of entries) {
      syntheticRegistry.features[name] = {};
    }
    return { output: formatList(syntheticRegistry, runtimeDir) };
  }

  return { output: formatList(registry, runtimeDir) };
}

// ---------------------------------------------------------------------------
// CLI 진입점
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args    = process.argv.slice(2);
  const isList  = args.includes('--list');
  const feature = args.find((a) => !a.startsWith('--')) || null;

  const projectRoot = process.cwd();

  try {
    if (isList) {
      const { output } = listCommand(projectRoot);
      console.log(output);
    } else {
      const { output } = statusCommand(projectRoot, feature);
      console.log(output);
    }
    process.exit(0);
  } catch (err) {
    console.error('error: ' + err.message);
    process.exit(1);
  }
}

module.exports = {
  readRegistry,
  readStateFile,
  readProgressFile,
  formatStatus,
  formatList,
  statusCommand,
  listCommand,
};
