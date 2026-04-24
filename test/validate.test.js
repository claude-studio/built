#!/usr/bin/env node
/**
 * test/validate.test.js
 *
 * scripts/validate.js 단위 테스트.
 * Node.js 내장 assert + fs + os만 사용 (외부 패키지 없음).
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const {
  validateConfig,
  validateHooks,
  validateHookEntry,
  validateCommandHook,
  validateSkillHook,
  readJson,
} = require('../scripts/validate');

// ---------------------------------------------------------------------------
// 테스트 헬퍼
// ---------------------------------------------------------------------------

let passed  = 0;
let failed  = 0;
let tmpDirs = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'built-validate-test-'));
  tmpDirs.push(dir);
  return dir;
}

function cleanup() {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  tmpDirs = [];
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function test(name, fn) {
  try {
    fn();
    console.log(`  pass  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

function assertNoErrors(errors) {
  assert.deepStrictEqual(errors, [], `Expected no errors but got: ${JSON.stringify(errors)}`);
}

function assertHasError(errors, substring) {
  const found = errors.some((e) => e.includes(substring));
  assert.ok(found, `Expected error containing '${substring}' but got: ${JSON.stringify(errors)}`);
}

// ---------------------------------------------------------------------------
// validateConfig — 유효한 케이스
// ---------------------------------------------------------------------------

console.log('\nvalidateConfig — valid cases');

test('valid minimal config', () => {
  const errors = validateConfig({
    version: 1,
    max_parallel: 1,
    default_model: 'claude-opus-4-5',
    max_iterations: 3,
    cost_warn_usd: 1.0,
  });
  assertNoErrors(errors);
});

test('valid config with larger values', () => {
  const errors = validateConfig({
    version: 2,
    max_parallel: 4,
    default_model: 'claude-sonnet-4-6',
    max_iterations: 10,
    cost_warn_usd: 5.5,
  });
  assertNoErrors(errors);
});

test('valid config with haiku model', () => {
  const errors = validateConfig({
    version: 1,
    max_parallel: 1,
    default_model: 'claude-haiku-4-5',
    max_iterations: 3,
    cost_warn_usd: 0.5,
  });
  assertNoErrors(errors);
});

test('valid config with short model alias', () => {
  const errors = validateConfig({
    version: 1,
    max_parallel: 1,
    default_model: 'sonnet',
    max_iterations: 3,
    cost_warn_usd: 1.0,
  });
  assertNoErrors(errors);
});

// ---------------------------------------------------------------------------
// validateConfig — 필수 필드 누락
// ---------------------------------------------------------------------------

console.log('\nvalidateConfig — missing required fields');

test('missing version', () => {
  const errors = validateConfig({
    max_parallel: 1, default_model: 'claude-opus-4-5', max_iterations: 3, cost_warn_usd: 1.0,
  });
  assertHasError(errors, "'version' is required");
});

test('missing max_parallel', () => {
  const errors = validateConfig({
    version: 1, default_model: 'claude-opus-4-5', max_iterations: 3, cost_warn_usd: 1.0,
  });
  assertHasError(errors, "'max_parallel' is required");
});

test('missing default_model', () => {
  const errors = validateConfig({
    version: 1, max_parallel: 1, max_iterations: 3, cost_warn_usd: 1.0,
  });
  assertHasError(errors, "'default_model' is required");
});

test('missing max_iterations', () => {
  const errors = validateConfig({
    version: 1, max_parallel: 1, default_model: 'claude-opus-4-5', cost_warn_usd: 1.0,
  });
  assertHasError(errors, "'max_iterations' is required");
});

test('missing cost_warn_usd', () => {
  const errors = validateConfig({
    version: 1, max_parallel: 1, default_model: 'claude-opus-4-5', max_iterations: 3,
  });
  assertHasError(errors, "'cost_warn_usd' is required");
});

// ---------------------------------------------------------------------------
// validateConfig — 타입 오류
// ---------------------------------------------------------------------------

console.log('\nvalidateConfig — type errors');

test('version is string', () => {
  const errors = validateConfig({
    version: '1', max_parallel: 1, default_model: 'claude-opus-4-5', max_iterations: 3, cost_warn_usd: 1.0,
  });
  assertHasError(errors, "'version'");
});

test('version is 0', () => {
  const errors = validateConfig({
    version: 0, max_parallel: 1, default_model: 'claude-opus-4-5', max_iterations: 3, cost_warn_usd: 1.0,
  });
  assertHasError(errors, "'version'");
});

test('version is float', () => {
  const errors = validateConfig({
    version: 1.5, max_parallel: 1, default_model: 'claude-opus-4-5', max_iterations: 3, cost_warn_usd: 1.0,
  });
  assertHasError(errors, "'version'");
});

test('max_parallel is 0', () => {
  const errors = validateConfig({
    version: 1, max_parallel: 0, default_model: 'claude-opus-4-5', max_iterations: 3, cost_warn_usd: 1.0,
  });
  assertHasError(errors, "'max_parallel'");
});

test('default_model is unknown', () => {
  const errors = validateConfig({
    version: 1, max_parallel: 1, default_model: 'gpt-4', max_iterations: 3, cost_warn_usd: 1.0,
  });
  assertHasError(errors, "'default_model' unknown value");
});

test('default_model is empty string', () => {
  const errors = validateConfig({
    version: 1, max_parallel: 1, default_model: '', max_iterations: 3, cost_warn_usd: 1.0,
  });
  assertHasError(errors, "'default_model'");
});

test('max_iterations is 0', () => {
  const errors = validateConfig({
    version: 1, max_parallel: 1, default_model: 'claude-opus-4-5', max_iterations: 0, cost_warn_usd: 1.0,
  });
  assertHasError(errors, "'max_iterations'");
});

test('cost_warn_usd is 0', () => {
  const errors = validateConfig({
    version: 1, max_parallel: 1, default_model: 'claude-opus-4-5', max_iterations: 3, cost_warn_usd: 0,
  });
  assertHasError(errors, "'cost_warn_usd'");
});

test('cost_warn_usd is negative', () => {
  const errors = validateConfig({
    version: 1, max_parallel: 1, default_model: 'claude-opus-4-5', max_iterations: 3, cost_warn_usd: -1,
  });
  assertHasError(errors, "'cost_warn_usd'");
});

// ---------------------------------------------------------------------------
// validateConfig — 루트 타입 오류
// ---------------------------------------------------------------------------

console.log('\nvalidateConfig — root type errors');

test('root is array', () => {
  const errors = validateConfig([]);
  assertHasError(errors, 'root must be a JSON object');
});

test('root is null', () => {
  const errors = validateConfig(null);
  assertHasError(errors, 'root must be a JSON object');
});

test('root is string', () => {
  const errors = validateConfig('hello');
  assertHasError(errors, 'root must be a JSON object');
});

// ---------------------------------------------------------------------------
// validateConfig — 알 수 없는 키
// ---------------------------------------------------------------------------

console.log('\nvalidateConfig — unknown keys');

test('unknown key is flagged', () => {
  const errors = validateConfig({
    version: 1, max_parallel: 1, default_model: 'claude-opus-4-5', max_iterations: 3,
    cost_warn_usd: 1.0, unknown_field: true,
  });
  assertHasError(errors, "unknown key(s)");
  assertHasError(errors, "'unknown_field'");
});

// ---------------------------------------------------------------------------
// validateHooks — 유효한 케이스
// ---------------------------------------------------------------------------

console.log('\nvalidateHooks — valid cases');

test('valid empty pipeline', () => {
  const errors = validateHooks({ pipeline: {} });
  assertNoErrors(errors);
});

test('valid pipeline with empty arrays', () => {
  const errors = validateHooks({ pipeline: { after_do: [], after_check: [] } });
  assertNoErrors(errors);
});

test('valid command hook', () => {
  const errors = validateHooks({
    pipeline: {
      after_do: [{ run: 'npm run lint', halt_on_fail: false }],
    },
  });
  assertNoErrors(errors);
});

test('valid command hook with all optional fields', () => {
  const errors = validateHooks({
    pipeline: {
      after_do: [{
        run: 'npm test',
        halt_on_fail: true,
        condition: 'check.status == "approved"',
        timeout: 60000,
        capture_output: true,
        expect_exit_code: 0,
      }],
    },
  });
  assertNoErrors(errors);
});

test('valid skill hook', () => {
  const errors = validateHooks({
    pipeline: {
      after_report: [{ skill: 'built-pr-draft', halt_on_fail: false }],
    },
  });
  assertNoErrors(errors);
});

test('valid skill hook with all optional fields', () => {
  const errors = validateHooks({
    pipeline: {
      after_report: [{
        skill: 'built-security-audit',
        halt_on_fail: true,
        model: 'sonnet',
        effort: 'high',
        condition: 'feature.touches_auth == true',
      }],
    },
  });
  assertNoErrors(errors);
});

test('valid multiple events with multiple hooks', () => {
  const errors = validateHooks({
    pipeline: {
      before_do: [{ run: './scripts/validate-spec.sh', halt_on_fail: true, timeout: 10000 }],
      after_do: [
        { run: 'npm run lint', halt_on_fail: false },
        { skill: 'built-security-audit', condition: 'feature.touches_auth == true', halt_on_fail: true, model: 'sonnet' },
      ],
      after_check: [{ run: 'npm test', halt_on_fail: true }],
      after_report: [{ skill: 'built-pr-draft', halt_on_fail: false }],
    },
  });
  assertNoErrors(errors);
});

// ---------------------------------------------------------------------------
// validateHooks — 필수 필드 누락
// ---------------------------------------------------------------------------

console.log('\nvalidateHooks — missing required fields');

test('missing pipeline', () => {
  const errors = validateHooks({});
  assertHasError(errors, "'pipeline' is required");
});

test('pipeline is not object', () => {
  const errors = validateHooks({ pipeline: 'invalid' });
  assertHasError(errors, "'pipeline' must be an object");
});

test('pipeline is array', () => {
  const errors = validateHooks({ pipeline: [] });
  assertHasError(errors, "'pipeline' must be an object");
});

// ---------------------------------------------------------------------------
// validateHooks — 훅 항목 오류
// ---------------------------------------------------------------------------

console.log('\nvalidateHooks — hook entry errors');

test('hook entry is null', () => {
  const errors = validateHooks({ pipeline: { after_do: [null] } });
  assertHasError(errors, 'hook entry must be an object');
});

test('hook entry has both run and skill', () => {
  const errors = validateHooks({ pipeline: { after_do: [{ run: 'npm test', skill: 'my-skill' }] } });
  assertHasError(errors, "cannot have both 'run' and 'skill'");
});

test('hook entry has neither run nor skill', () => {
  const errors = validateHooks({ pipeline: { after_do: [{ halt_on_fail: true }] } });
  assertHasError(errors, "must have either 'run' or 'skill'");
});

test('run is empty string', () => {
  const errors = validateHooks({ pipeline: { after_do: [{ run: '' }] } });
  assertHasError(errors, "'run' must be a non-empty string");
});

test('halt_on_fail is string', () => {
  const errors = validateHooks({ pipeline: { after_do: [{ run: 'npm test', halt_on_fail: 'yes' }] } });
  assertHasError(errors, "'halt_on_fail' must be boolean");
});

test('timeout is string', () => {
  const errors = validateHooks({ pipeline: { after_do: [{ run: 'npm test', timeout: '60000' }] } });
  assertHasError(errors, "'timeout' must be a positive number");
});

test('timeout is 0', () => {
  const errors = validateHooks({ pipeline: { after_do: [{ run: 'npm test', timeout: 0 }] } });
  assertHasError(errors, "'timeout' must be a positive number");
});

test('capture_output is number', () => {
  const errors = validateHooks({ pipeline: { after_do: [{ run: 'npm test', capture_output: 1 }] } });
  assertHasError(errors, "'capture_output' must be boolean");
});

test('expect_exit_code is float', () => {
  const errors = validateHooks({ pipeline: { after_do: [{ run: 'npm test', expect_exit_code: 1.5 }] } });
  assertHasError(errors, "'expect_exit_code' must be an integer");
});

test('skill is empty string', () => {
  const errors = validateHooks({ pipeline: { after_report: [{ skill: '' }] } });
  assertHasError(errors, "'skill' must be a non-empty string");
});

test('skill model is invalid', () => {
  const errors = validateHooks({ pipeline: { after_report: [{ skill: 'my-skill', model: 'gpt-4' }] } });
  assertHasError(errors, "'model' must be one of");
});

test('skill effort is invalid', () => {
  const errors = validateHooks({ pipeline: { after_report: [{ skill: 'my-skill', effort: 'maximum' }] } });
  assertHasError(errors, "'effort' must be one of");
});

// ---------------------------------------------------------------------------
// validateHooks — 알 수 없는 이벤트
// ---------------------------------------------------------------------------

console.log('\nvalidateHooks — unknown events');

test('unknown event name', () => {
  const errors = validateHooks({ pipeline: { on_start: [{ run: 'npm test' }] } });
  assertHasError(errors, "unknown event 'on_start'");
});

// ---------------------------------------------------------------------------
// validateHooks — 빈 파일 케이스
// ---------------------------------------------------------------------------

console.log('\nvalidateHooks — edge cases');

test('root is null', () => {
  const errors = validateHooks(null);
  assertHasError(errors, 'root must be a JSON object');
});

test('root is array', () => {
  const errors = validateHooks([]);
  assertHasError(errors, 'root must be a JSON object');
});

// ---------------------------------------------------------------------------
// readJson
// ---------------------------------------------------------------------------

console.log('\nreadJson');

test('reads valid JSON file', () => {
  const dir  = makeTmpDir();
  const file = path.join(dir, 'test.json');
  writeFile(file, '{"key": "value"}');
  const { data, error } = readJson(file);
  assert.strictEqual(error, null);
  assert.deepStrictEqual(data, { key: 'value' });
});

test('returns error for invalid JSON', () => {
  const dir  = makeTmpDir();
  const file = path.join(dir, 'bad.json');
  writeFile(file, '{invalid json}');
  const { data, error } = readJson(file);
  assert.ok(error !== null);
  assert.ok(error.includes('invalid JSON'));
  assert.strictEqual(data, null);
});

test('returns error for missing file', () => {
  const { data, error } = readJson('/nonexistent/path/file.json');
  assert.ok(error !== null);
  assert.ok(error.includes('cannot read file'));
  assert.strictEqual(data, null);
});

test('reads empty object', () => {
  const dir  = makeTmpDir();
  const file = path.join(dir, 'empty.json');
  writeFile(file, '{}');
  const { data, error } = readJson(file);
  assert.strictEqual(error, null);
  assert.deepStrictEqual(data, {});
});

// ---------------------------------------------------------------------------
// validateConfig — worktree_location
// ---------------------------------------------------------------------------

console.log('\nvalidateConfig — worktree_location');

test('worktree_location default is valid', () => {
  const errors = validateConfig({
    version: 1, max_parallel: 1, default_model: 'claude-opus-4-5', max_iterations: 3,
    cost_warn_usd: 1.0, worktree_location: 'default',
  });
  assertNoErrors(errors);
});

test('worktree_location sibling is valid', () => {
  const errors = validateConfig({
    version: 1, max_parallel: 1, default_model: 'claude-opus-4-5', max_iterations: 3,
    cost_warn_usd: 1.0, worktree_location: 'sibling',
  });
  assertNoErrors(errors);
});

test('worktree_location absent is valid (optional field)', () => {
  const errors = validateConfig({
    version: 1, max_parallel: 1, default_model: 'claude-opus-4-5', max_iterations: 3,
    cost_warn_usd: 1.0,
  });
  assertNoErrors(errors);
});

test('worktree_location invalid value is rejected', () => {
  const errors = validateConfig({
    version: 1, max_parallel: 1, default_model: 'claude-opus-4-5', max_iterations: 3,
    cost_warn_usd: 1.0, worktree_location: 'absolute',
  });
  assertHasError(errors, "'worktree_location'");
});

test('worktree_location is not flagged as unknown key', () => {
  const errors = validateConfig({
    version: 1, max_parallel: 1, default_model: 'claude-opus-4-5', max_iterations: 3,
    cost_warn_usd: 1.0, worktree_location: 'sibling',
  });
  const hasUnknownError = errors.some((e) => e.includes('unknown key') && e.includes('worktree_location'));
  assert.ok(!hasUnknownError, `worktree_location should not be flagged as unknown: ${JSON.stringify(errors)}`);
});

// ---------------------------------------------------------------------------
// 완료
// ---------------------------------------------------------------------------

cleanup();

console.log(`\n${passed + failed} test(s): ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
