#!/usr/bin/env node
/**
 * hooks-inspect.js
 *
 * /built:hooks-inspect 스킬 헬퍼 — 현재 활성 훅 설정을 사람이 읽기 쉬운 형태로 출력한다.
 *
 * 사용법:
 *   node scripts/hooks-inspect.js [--json] [--project-root <path>]
 *
 * 동작:
 *   1. .built/hooks.json (팀 공통) 읽기
 *   2. .built/hooks.local.json (개인, optional) 읽기
 *   3. 두 파일을 deep-merge — local이 팀 설정을 덮어쓰지 않고 이벤트 배열에 추가
 *   4. 활성 훅 테이블 출력 (이벤트별 훅 목록)
 *   5. 누락/비활성 이벤트 표시
 *
 * --json 플래그:
 *   - 사람용 텍스트 대신 JSON으로 출력 (파이프 처리용)
 *
 * Exit codes:
 *   0 — 정상 출력
 *   1 — 파일 읽기/파싱 오류
 *
 * 외부 npm 패키지 없음. Node.js 내장 모듈(fs, path)만 사용.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// 인자 파싱
// ---------------------------------------------------------------------------

const args           = process.argv.slice(2);
const jsonOutput     = args.includes('--json');

const projectRootIdx = args.indexOf('--project-root');
const projectRoot    = projectRootIdx !== -1 ? args[projectRootIdx + 1] : process.cwd();

// ---------------------------------------------------------------------------
// 이벤트 정의 (BUILT-DESIGN.md §9)
// ---------------------------------------------------------------------------

const ALL_EVENTS = ['before_do', 'after_do', 'before_check', 'after_check', 'before_report', 'after_report'];

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------

/**
 * JSON 파일을 읽고 파싱한다.
 * 파일이 없으면 null 반환. 읽기/파싱 오류 시 예외 던짐.
 *
 * @param {string} filePath
 * @returns {object|null}
 */
function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new Error(`cannot read ${filePath}: ${e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`invalid JSON in ${filePath}: ${e.message}`);
  }
}

/**
 * hooks.json + hooks.local.json을 deep-merge한다.
 * local의 각 이벤트 배열을 팀 배열 뒤에 이어 붙인다.
 *
 * @param {object|null} team
 * @param {object|null} local
 * @returns {{ merged: object, sources: Map<string, string[]> }}
 *   sources: event → 각 훅의 출처 ('team' | 'local') 배열
 */
function mergeHooks(team, local) {
  const merged  = { pipeline: {} };
  /** @type {Map<string, string[]>} */
  const sources = new Map();

  // 팀 훅 복사
  if (team && team.pipeline) {
    for (const [event, hooks] of Object.entries(team.pipeline)) {
      if (!Array.isArray(hooks)) continue;
      merged.pipeline[event] = [...hooks];
      sources.set(event, hooks.map(() => 'team'));
    }
  }

  // local 훅 병합 (이어 붙이기)
  if (local && local.pipeline) {
    for (const [event, hooks] of Object.entries(local.pipeline)) {
      if (!Array.isArray(hooks)) continue;
      if (!merged.pipeline[event]) {
        merged.pipeline[event] = [];
        sources.set(event, []);
      }
      merged.pipeline[event].push(...hooks);
      const arr = sources.get(event) || [];
      arr.push(...hooks.map(() => 'local'));
      sources.set(event, arr);
    }
  }

  return { merged, sources };
}

// ---------------------------------------------------------------------------
// 훅 요약 문자열
// ---------------------------------------------------------------------------

/**
 * 훅 항목을 한 줄 요약으로 변환한다.
 *
 * @param {object} hook
 * @returns {string}
 */
function summarizeHook(hook) {
  if ('run' in hook) {
    const parts = [`run: ${hook.run}`];
    if (hook.halt_on_fail)   parts.push('halt_on_fail');
    if (hook.condition)      parts.push(`if: ${hook.condition}`);
    if (hook.timeout)        parts.push(`timeout: ${hook.timeout}ms`);
    if (hook.capture_output) parts.push('capture_output');
    return parts.join('  |  ');
  }
  if ('skill' in hook) {
    const parts = [`skill: ${hook.skill}`];
    if (hook.halt_on_fail) parts.push('halt_on_fail');
    if (hook.model)        parts.push(`model: ${hook.model}`);
    if (hook.effort)       parts.push(`effort: ${hook.effort}`);
    if (hook.condition)    parts.push(`if: ${hook.condition}`);
    return parts.join('  |  ');
  }
  return JSON.stringify(hook);
}

// ---------------------------------------------------------------------------
// 텍스트 출력
// ---------------------------------------------------------------------------

/**
 * 사람이 읽기 쉬운 텍스트로 훅 설정을 출력한다.
 *
 * @param {object} merged
 * @param {Map<string, string[]>} sources
 * @param {{ teamPath: string, localPath: string|null }} meta
 */
function printText(merged, sources, meta) {
  console.log('\n=== built hooks-inspect ===\n');

  // 파일 출처 표시
  console.log(`Team  : ${meta.teamPath}`);
  if (meta.localPath) {
    console.log(`Local : ${meta.localPath}`);
  } else {
    console.log('Local : (not found — optional)');
  }
  console.log('');

  let hasAnyHook = false;

  for (const event of ALL_EVENTS) {
    const hooks       = (merged.pipeline && merged.pipeline[event]) || [];
    const eventSrcs   = sources.get(event) || [];
    const hasHooks    = hooks.length > 0;

    if (hasHooks) {
      hasAnyHook = true;
      console.log(`[${event}]  (${hooks.length} hook${hooks.length > 1 ? 's' : ''})`);
      hooks.forEach((hook, idx) => {
        const src = eventSrcs[idx] || '?';
        const tag = src === 'local' ? ' [local]' : '';
        console.log(`  ${idx + 1}. ${summarizeHook(hook)}${tag}`);
      });
    } else {
      console.log(`[${event}]  (no hooks)`);
    }
    console.log('');
  }

  if (!hasAnyHook) {
    console.log('No hooks configured.\n');
    console.log('Tip: Edit .built/hooks.json to add team hooks,');
    console.log('     or .built/hooks.local.json for personal hooks.');
  }

  console.log('Provider-aware context (env vars available in all hooks):');
  console.log('  BUILT_HOOK_POINT       — current hook point (e.g. after_do)');
  console.log('  BUILT_FEATURE          — feature name');
  console.log('  BUILT_PROJECT_ROOT     — project root path');
  console.log('  BUILT_WORKTREE         — execution worktree path (if set)');
  console.log('  BUILT_PREVIOUS_RESULT  — previous result file path (if set)');
  console.log('  BUILT_PROVIDER         — provider name (e.g. claude, codex)');
  console.log('  BUILT_PHASE            — provider phase (e.g. do, check, report)');
  console.log('  BUILT_PROVIDER_STATUS  — phase completion status (completed/failed/interrupted)');
  console.log('  BUILT_FAILURE_SUMMARY  — brief failure description (only on failure)');
  console.log('  BUILT_MODEL            — model identifier (e.g. claude-sonnet-4-5)');
  console.log('');
  console.log('Sensitive env vars (_KEY, _SECRET, _TOKEN, _PASSWORD, etc.) are NOT forwarded to hooks.');
}

// ---------------------------------------------------------------------------
// JSON 출력
// ---------------------------------------------------------------------------

/**
 * JSON 형식으로 훅 설정을 출력한다.
 *
 * @param {object} merged
 * @param {Map<string, string[]>} sources
 * @param {{ teamPath: string, localPath: string|null }} meta
 */
function printJson(merged, sources, meta) {
  const result = {
    team_path:  meta.teamPath,
    local_path: meta.localPath,
    events: {},
  };

  for (const event of ALL_EVENTS) {
    const hooks     = (merged.pipeline && merged.pipeline[event]) || [];
    const eventSrcs = sources.get(event) || [];
    result.events[event] = hooks.map((hook, idx) => ({
      source:  eventSrcs[idx] || 'unknown',
      type:    'run' in hook ? 'command' : 'skill',
      ...hook,
    }));
  }

  console.log(JSON.stringify(result, null, 2));
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------

function main() {
  const builtDir  = path.join(projectRoot, '.built');
  const teamPath  = path.join(builtDir, 'hooks.json');
  const localPath = path.join(builtDir, 'hooks.local.json');

  let teamData, localData;

  // 팀 hooks.json 읽기 (필수)
  if (!fs.existsSync(teamPath)) {
    console.error(`[hooks-inspect] .built/hooks.json not found.`);
    console.error(`Run /built:init to create it.`);
    process.exit(1);
  }

  try {
    teamData  = readJsonFile(teamPath);
    localData = readJsonFile(localPath);  // 없으면 null
  } catch (e) {
    console.error(`[hooks-inspect] ${e.message}`);
    process.exit(1);
  }

  if (!teamData || typeof teamData !== 'object') {
    console.error('[hooks-inspect] hooks.json must be a JSON object');
    process.exit(1);
  }

  const { merged, sources } = mergeHooks(teamData, localData);
  const meta = {
    teamPath:  path.relative(projectRoot, teamPath),
    localPath: localData !== null ? path.relative(projectRoot, localPath) : null,
  };

  if (jsonOutput) {
    printJson(merged, sources, meta);
  } else {
    printText(merged, sources, meta);
  }

  process.exit(0);
}

if (require.main === module) {
  main();
}

// ---------------------------------------------------------------------------
// 내보내기 (테스트용)
// ---------------------------------------------------------------------------

module.exports = {
  mergeHooks,
  summarizeHook,
};
