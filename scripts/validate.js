#!/usr/bin/env node
/**
 * validate.js
 *
 * /built:validate 스킬 헬퍼 — .built/config.json 및 .built/hooks.json 유효성 검증.
 *
 * 사용법:
 *   node scripts/validate.js [--config-only] [--hooks-only] [--project-root <path>]
 *
 * 동작:
 *   1. .built/config.json 스키마 검증 (필수 필드, 타입 체크)
 *   2. .built/hooks.json 스키마 검증 (훅 설정 구조 체크)
 *   3. .built/config.local.json, .built/hooks.local.json 존재 시 추가 검증
 *   4. 오류 시 사람이 읽을 수 있는 메시지 출력
 *
 * Exit codes:
 *   0 — 모든 검증 통과
 *   1 — 검증 오류 또는 예상치 못한 오류
 *
 * 외부 npm 패키지 없음. Node.js 내장 모듈(fs, path)만 사용.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { normalizeDefaultRunProfileProviders } = require('../src/providers/config');

// ---------------------------------------------------------------------------
// 인자 파싱
// ---------------------------------------------------------------------------

const args        = process.argv.slice(2);
const configOnly  = args.includes('--config-only');
const hooksOnly   = args.includes('--hooks-only');

const projectRootIdx = args.indexOf('--project-root');
const projectRoot = projectRootIdx !== -1 ? args[projectRootIdx + 1] : process.cwd();

// ---------------------------------------------------------------------------
// config.json 검증
// ---------------------------------------------------------------------------

const VALID_MODELS = new Set([
  'claude-opus-4-5',
  'claude-opus-4-6',
  'claude-sonnet-4-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
  'opus',
  'sonnet',
  'haiku',
]);

/**
 * config.json 스키마 검증.
 * 오류 목록(문자열 배열)을 반환한다. 빈 배열이면 유효.
 *
 * @param {unknown} data
 * @returns {string[]}
 */
function validateConfig(data) {
  const errors = [];

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return ['root must be a JSON object'];
  }

  // version
  if (!('version' in data)) {
    errors.push("'version' is required");
  } else if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) {
    errors.push("'version' must be a positive integer");
  }

  // max_parallel
  if (!('max_parallel' in data)) {
    errors.push("'max_parallel' is required");
  } else if (typeof data.max_parallel !== 'number' || !Number.isInteger(data.max_parallel) || data.max_parallel < 1) {
    errors.push("'max_parallel' must be a positive integer");
  }

  // default_model
  if (!('default_model' in data)) {
    errors.push("'default_model' is required");
  } else if (typeof data.default_model !== 'string' || data.default_model.length === 0) {
    errors.push("'default_model' must be a non-empty string");
  } else if (!VALID_MODELS.has(data.default_model)) {
    errors.push(`'default_model' unknown value: '${data.default_model}' (known: ${[...VALID_MODELS].join(', ')})`);
  }

  // max_iterations
  if (!('max_iterations' in data)) {
    errors.push("'max_iterations' is required");
  } else if (typeof data.max_iterations !== 'number' || !Number.isInteger(data.max_iterations) || data.max_iterations < 1) {
    errors.push("'max_iterations' must be a positive integer");
  }

  // cost_warn_usd
  if (!('cost_warn_usd' in data)) {
    errors.push("'cost_warn_usd' is required");
  } else if (typeof data.cost_warn_usd !== 'number' || data.cost_warn_usd <= 0) {
    errors.push("'cost_warn_usd' must be a positive number");
  }

  // worktree_location (선택)
  if ('worktree_location' in data) {
    if (data.worktree_location !== 'default' && data.worktree_location !== 'sibling') {
      errors.push(`'worktree_location' must be 'default' or 'sibling' (got: '${data.worktree_location}')`);
    }
  }

  // default_max_cost_usd (선택) — 피처별 비용 상한 글로벌 기본값
  if ('default_max_cost_usd' in data) {
    if (typeof data.default_max_cost_usd !== 'number' || data.default_max_cost_usd <= 0) {
      errors.push("'default_max_cost_usd' must be a positive number");
    }
  }

  // default_run_profile (선택) — 사람 수정용 기본 실행 구성. ProviderSpec detail은 허용하지 않는다.
  if ('default_run_profile' in data) {
    try {
      normalizeDefaultRunProfileProviders(data.default_run_profile);
    } catch (err) {
      errors.push(err.message);
    }
  }

  // 허용되지 않는 키 경고 (오류가 아닌 경고)
  const KNOWN_KEYS = new Set([
    'version',
    'max_parallel',
    'default_model',
    'max_iterations',
    'cost_warn_usd',
    'worktree_location',
    'default_max_cost_usd',
    'default_run_profile',
  ]);
  const unknownKeys = Object.keys(data).filter((k) => !KNOWN_KEYS.has(k));
  if (unknownKeys.length > 0) {
    errors.push(`unknown key(s): ${unknownKeys.map((k) => `'${k}'`).join(', ')}`);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// hooks.json 검증
// ---------------------------------------------------------------------------

const MODEL_VALUES  = new Set(['opus', 'sonnet', 'haiku']);
const EFFORT_VALUES = new Set(['low', 'medium', 'high']);
const VALID_EVENTS  = new Set(['before_do', 'after_do', 'before_check', 'after_check', 'before_report', 'after_report']);

/**
 * command 훅 유효성 검증.
 * 오류 메시지 목록을 반환한다.
 *
 * @param {object} h
 * @param {string} location
 * @returns {string[]}
 */
function validateCommandHook(h, location) {
  const errors = [];
  if (typeof h.run !== 'string' || h.run.length === 0)
    errors.push(`${location}: 'run' must be a non-empty string`);
  if ('halt_on_fail' in h && typeof h.halt_on_fail !== 'boolean')
    errors.push(`${location}: 'halt_on_fail' must be boolean`);
  if ('condition' in h && typeof h.condition !== 'string')
    errors.push(`${location}: 'condition' must be string`);
  if ('timeout' in h && (typeof h.timeout !== 'number' || h.timeout <= 0))
    errors.push(`${location}: 'timeout' must be a positive number`);
  if ('capture_output' in h && typeof h.capture_output !== 'boolean')
    errors.push(`${location}: 'capture_output' must be boolean`);
  if ('expect_exit_code' in h && !Number.isInteger(h.expect_exit_code))
    errors.push(`${location}: 'expect_exit_code' must be an integer`);
  return errors;
}

/**
 * skill 훅 유효성 검증.
 * 오류 메시지 목록을 반환한다.
 *
 * @param {object} h
 * @param {string} location
 * @returns {string[]}
 */
function validateSkillHook(h, location) {
  const errors = [];
  if (typeof h.skill !== 'string' || h.skill.length === 0)
    errors.push(`${location}: 'skill' must be a non-empty string`);
  if ('halt_on_fail' in h && typeof h.halt_on_fail !== 'boolean')
    errors.push(`${location}: 'halt_on_fail' must be boolean`);
  if ('model' in h && !MODEL_VALUES.has(h.model))
    errors.push(`${location}: 'model' must be one of ${[...MODEL_VALUES].join(', ')}`);
  if ('effort' in h && !EFFORT_VALUES.has(h.effort))
    errors.push(`${location}: 'effort' must be one of ${[...EFFORT_VALUES].join(', ')}`);
  if ('condition' in h && typeof h.condition !== 'string')
    errors.push(`${location}: 'condition' must be string`);
  return errors;
}

/**
 * 훅 항목 유효성 검증.
 *
 * @param {unknown} h
 * @param {string} location
 * @returns {string[]}
 */
function validateHookEntry(h, location) {
  if (h === null || typeof h !== 'object' || Array.isArray(h))
    return [`${location}: hook entry must be an object`];

  const hasRun   = 'run' in h;
  const hasSkill = 'skill' in h;

  if (hasRun && hasSkill)
    return [`${location}: cannot have both 'run' and 'skill'`];
  if (!hasRun && !hasSkill)
    return [`${location}: must have either 'run' or 'skill'`];

  return hasRun
    ? validateCommandHook(h, location)
    : validateSkillHook(h, location);
}

/**
 * hooks.json 스키마 검증.
 * 오류 목록(문자열 배열)을 반환한다. 빈 배열이면 유효.
 *
 * @param {unknown} data
 * @returns {string[]}
 */
function validateHooks(data) {
  const errors = [];

  if (data === null || typeof data !== 'object' || Array.isArray(data))
    return ['root must be a JSON object'];

  if (!('pipeline' in data))
    return ["'pipeline' is required"];

  const pipeline = data.pipeline;
  if (pipeline === null || typeof pipeline !== 'object' || Array.isArray(pipeline))
    return ["'pipeline' must be an object"];

  for (const [event, hooks] of Object.entries(pipeline)) {
    if (!VALID_EVENTS.has(event)) {
      errors.push(`pipeline: unknown event '${event}' (valid: ${[...VALID_EVENTS].join(', ')})`);
      continue;
    }
    if (!Array.isArray(hooks)) {
      errors.push(`pipeline.${event}: must be an array`);
      continue;
    }
    hooks.forEach((hook, idx) => {
      const errs = validateHookEntry(hook, `pipeline.${event}[${idx}]`);
      errors.push(...errs);
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// 파일 읽기 + 파싱
// ---------------------------------------------------------------------------

/**
 * JSON 파일을 읽고 파싱한다.
 * 반환: { data, error }
 *
 * @param {string} filePath
 * @returns {{ data: unknown, error: string|null }}
 */
function readJson(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { data: null, error: `cannot read file: ${e.message}` };
  }
  try {
    return { data: JSON.parse(raw), error: null };
  } catch (e) {
    return { data: null, error: `invalid JSON: ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
// 검증 실행 + 결과 출력
// ---------------------------------------------------------------------------

/**
 * 단일 파일을 검증하고 결과를 출력한다.
 *
 * @param {string} filePath
 * @param {'config'|'hooks'} type
 * @param {boolean} optional  파일이 없어도 괜찮으면 true
 * @returns {{ ok: boolean, skipped: boolean }}
 */
function checkFile(filePath, type, optional = false) {
  const rel = path.relative(projectRoot, filePath);

  if (!fs.existsSync(filePath)) {
    if (optional) {
      console.log(`  [skip] ${rel} — not found (optional)`);
      return { ok: true, skipped: true };
    }
    console.error(`  [fail] ${rel} — file not found`);
    return { ok: false, skipped: false };
  }

  const { data, error: parseError } = readJson(filePath);
  if (parseError) {
    console.error(`  [fail] ${rel} — ${parseError}`);
    return { ok: false, skipped: false };
  }

  const errors = type === 'config' ? validateConfig(data) : validateHooks(data);
  if (errors.length === 0) {
    console.log(`  [ ok ] ${rel}`);
    return { ok: true, skipped: false };
  }

  console.error(`  [fail] ${rel}`);
  for (const e of errors) {
    console.error(`         • ${e}`);
  }
  return { ok: false, skipped: false };
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------

function main() {
  const builtDir   = path.join(projectRoot, '.built');
  let   allOk      = true;

  // .built/ 디렉토리 미존재 시 init 안내
  if (!fs.existsSync(builtDir)) {
    console.error('.built/ 디렉토리가 없습니다. 먼저 /built:init 을 실행하세요.');
    process.exit(1);
  }

  if (!configOnly) {
    // hooks 검증
    console.log('\nValidating hooks:');
    const hooksResults = [
      checkFile(path.join(builtDir, 'hooks.json'),        'hooks', false),
      checkFile(path.join(builtDir, 'hooks.local.json'),  'hooks', true),
    ];
    if (hooksResults.some((r) => !r.ok)) allOk = false;
  }

  if (!hooksOnly) {
    // config 검증
    console.log('\nValidating config:');
    const configResults = [
      checkFile(path.join(builtDir, 'config.json'),       'config', false),
      checkFile(path.join(builtDir, 'config.local.json'), 'config', true),
    ];
    if (configResults.some((r) => !r.ok)) allOk = false;
  }

  console.log('');
  if (allOk) {
    console.log('Validation passed.');
    process.exit(0);
  } else {
    console.error('Validation failed. Fix the errors above and re-run.');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

// ---------------------------------------------------------------------------
// 내보내기 (테스트용)
// ---------------------------------------------------------------------------

module.exports = {
  validateConfig,
  validateHooks,
  validateHookEntry,
  validateCommandHook,
  validateSkillHook,
  readJson,
};
