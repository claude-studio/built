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
const { formatClaudePermissionRemediation } = require(path.join(__dirname, '..', 'src', 'providers/failure'));

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

function kstTime(isoStr) {
  if (!isoStr) return '-';
  const date = new Date(isoStr);
  if (isNaN(date.getTime())) return isoStr;

  const kst = new Date(date.getTime() + (9 * 60 * 60 * 1000));
  const pad = (value) => String(value).padStart(2, '0');
  return [
    `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}`,
    `${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())}`,
    'KST',
  ].join(' ');
}

function displayTime(isoStr) {
  if (!isoStr) return '-';
  const kst = kstTime(isoStr);
  const relative = relativeTime(isoStr);
  return kst === relative ? kst : `${kst} (${relative})`;
}

function failureFrom(state, progress) {
  const candidates = [
    state && state.last_failure,
    progress && progress.last_failure,
  ];
  for (const failure of candidates) {
    if (failure && typeof failure === 'object') {
      return failure;
    }
  }
  return null;
}

function oneLine(value) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value).replace(/\s+/g, ' ').trim();
}

function yesNo(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return '-';
}

function truncateForStatus(value, maxLen = 300) {
  const text = oneLine(value);
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3)}...`;
}

function formatLastError(lastError) {
  if (!lastError) return null;
  if (typeof lastError === 'string') return truncateForStatus(lastError);

  const safe = {};
  for (const [key, value] of Object.entries(lastError)) {
    if (key === 'debug_detail' || key === 'raw_provider') continue;
    safe[key] = value;
  }
  return truncateForStatus(JSON.stringify(safe));
}

function formatUsage(progress) {
  const input = progress.input_tokens;
  const output = progress.output_tokens;
  if (input == null && output == null) return '미제공';

  const parts = [];
  if (input != null) parts.push(`input=${input}`);
  if (output != null) parts.push(`output=${output}`);
  return parts.join(' ');
}

function formatFailureSummary(lines, failure, opts = {}) {
  lines.push('  failure:');
  lines.push(`    kind:      ${oneLine(failure.kind)}`);
  if (failure.code) {
    lines.push(`    code:      ${oneLine(failure.code)}`);
  }
  if (opts.actionOverride) {
    lines.push(`    action(next_action): ${truncateForStatus(opts.actionOverride)}`);
  } else if (failure.action) {
    lines.push(`    action(next_action): ${truncateForStatus(failure.action)}`);
  }
  lines.push(`    retryable: ${yesNo(failure.retryable)}`);
  lines.push(`    blocked:   ${yesNo(failure.blocked)}`);
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

function resolveFeatureDir(projectRoot, runtimeDir, feature, state, registryEntry) {
  const candidates = [];
  if (registryEntry && registryEntry.resultDir) candidates.push(registryEntry.resultDir);
  if (state && state.execution_worktree && state.execution_worktree.result_dir) {
    candidates.push(state.execution_worktree.result_dir);
  }
  candidates.push(path.join(projectRoot, '.built', 'features', feature));

  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (fs.existsSync(path.join(resolved, 'progress.json'))) {
      return resolved;
    }
  }

  return path.join(projectRoot, '.built', 'features', feature);
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

  const failure = failureFrom(state, progress);
  const provider = (progress && progress.provider) || (failure && failure.raw_provider) || state.provider || null;
  const model = (progress && progress.model) || state.model || null;

  lines.push(`  phase:       ${state.phase || (progress && progress.phase) || '-'}`);
  lines.push(`  status:      ${state.status || '-'}`);
  lines.push(`  pid:         ${state.pid != null ? state.pid : '-'}`);
  lines.push(`  heartbeat:   ${displayTime(state.heartbeat)}`);
  lines.push(`  attempt:     ${state.attempt != null ? state.attempt : '-'}`);
  lines.push(`  started:     ${displayTime(state.startedAt)}`);
  lines.push(`  updated:     ${displayTime(state.updatedAt)}`);

  const errMsg = formatLastError(state.last_error);
  if (errMsg) {
    lines.push(`  last_error:  ${errMsg}`);
  }

  if (provider) lines.push(`  provider:    ${provider}`);
  if (model)    lines.push(`  model:       ${model}`);

  if (progress) {
    if (progress.duration_ms != null) {
      lines.push(`  duration:    ${progress.duration_ms}ms`);
    }
    if (typeof progress.cost_usd === 'number') {
      lines.push(`  cost:        $${progress.cost_usd.toFixed(4)}`);
    } else {
      lines.push('  cost:        미제공');
    }
    lines.push(`  usage:       ${formatUsage(progress)}`);
    if (progress.message)    lines.push(`  progress:    ${progress.message}`);
    if (progress.step != null && progress.total != null) {
      lines.push(`  steps:       ${progress.step}/${progress.total}`);
    }
    if (progress.iteration != null) {
      lines.push(`  iteration:   ${progress.iteration}`);
    }
  }

  if (failure && failure.code === 'claude_permission_request') {
    formatFailureSummary(lines, failure, {
      actionOverride: '아래 remediation 중 하나를 선택하세요.',
    });
    lines.push('  remediation:');
    formatClaudePermissionRemediation(feature)
      .split('\n')
      .forEach((line) => lines.push(`    ${line}`));
  } else if (failure) {
    formatFailureSummary(lines, failure);
  }

  return lines.join('\n');
}

/**
 * feature 목록 출력 문자열 생성 (/built:list 용).
 * registry.json 기반으로 활성/완료/실패 3그룹으로 분류해 출력한다.
 *
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

  // registry status 기준으로 3그룹 분류
  // registry meta.status가 없으면 state.json status로 폴백
  const active    = [];
  const completed = [];
  const failed    = [];

  for (const name of names) {
    const meta   = features[name] || {};
    const runDir = path.join(runtimeDir, 'runs', name);
    const state  = readStateFile(runDir);

    const registryStatus = meta.status || (state ? state.status : null) || 'unknown';
    const phase          = state ? (state.phase  || '-') : '-';
    const stateStatus    = state ? (state.status || '-') : '-';
    const updated        = state
      ? displayTime(state.updatedAt || state.heartbeat)
      : displayTime(meta.updatedAt);

    const entry = { name, registryStatus, phase, stateStatus, updated, pid: meta.pid || (state ? state.pid : null) };

    if (registryStatus === 'running') {
      active.push(entry);
    } else if (registryStatus === 'completed') {
      completed.push(entry);
    } else {
      failed.push(entry);
    }
  }

  const lines = [];
  lines.push(`Features (${names.length} total):`);

  // ---- 활성 (running) ----
  if (active.length > 0) {
    lines.push('');
    lines.push(`  Active features (${active.length})`);
    for (const e of active) {
      const pidStr = e.pid != null ? `  pid: ${e.pid}` : '';
      lines.push(`    ${e.name}`);
      lines.push(`      phase: ${e.phase}  status: ${e.stateStatus}  updated: ${e.updated}${pidStr}`);
    }
  }

  // ---- 완료 (completed) ----
  if (completed.length > 0) {
    lines.push('');
    lines.push(`  [completed] (${completed.length})`);
    for (const e of completed) {
      lines.push(`    ${e.name}`);
      lines.push(`      phase: ${e.phase}  updated: ${e.updated}`);
    }
  }

  // ---- 실패 (failed / unknown) ----
  if (failed.length > 0) {
    lines.push('');
    lines.push(`  [failed/other] (${failed.length})`);
    for (const e of failed) {
      lines.push(`    ${e.name}`);
      lines.push(`      registry: ${e.registryStatus}  phase: ${e.phase}  updated: ${e.updated}`);
    }
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
  const runtimeDir  = path.join(projectRoot, '.built', 'runtime');
  const runsDir     = path.join(runtimeDir, 'runs');

  // .built/runtime 없으면 early exit
  if (!fs.existsSync(runtimeDir)) {
    return { output: 'No runs found.', found: false };
  }

  if (feature) {
    // 특정 feature 상세 조회
    // state.json: .built/runtime/runs/<feature>/ (orchestrator SSOT)
    // progress.json: registry/state pointer의 resultDir 우선, root featureDir 폴백
    const runDir   = path.join(runsDir, feature);
    const state    = readStateFile(runDir);
    const registry = readRegistry(runtimeDir);
    const meta     = registry && registry.features ? registry.features[feature] : null;
    const progress = readProgressFile(resolveFeatureDir(projectRoot, runtimeDir, feature, state, meta));

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
      const runDir   = path.join(runsDir, name);
      const state    = readStateFile(runDir);
      const progress = readProgressFile(resolveFeatureDir(projectRoot, runtimeDir, name, state, null));
      return formatStatus(name, state, progress);
    });

    return { output: blocks.join('\n\n'), found: true };
  }

  // registry 있음 — 각 feature state 요약
  const blocks = Object.keys(registry.features).map((name) => {
    const runDir   = path.join(runsDir, name);
    const state    = readStateFile(runDir);
    const progress = readProgressFile(resolveFeatureDir(projectRoot, runtimeDir, name, state, registry.features[name]));
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
  resolveFeatureDir,
  formatStatus,
  formatList,
  statusCommand,
  listCommand,
};
