#!/usr/bin/env node
/**
 * test/hooks-inspect.test.js
 *
 * scripts/hooks-inspect.js 단위 테스트.
 * Node.js 내장 assert만 사용 (외부 패키지 없음).
 */

'use strict';

const assert = require('assert');

const {
  mergeHooks,
  summarizeHook,
} = require('../scripts/hooks-inspect');

// ---------------------------------------------------------------------------
// 테스트 헬퍼
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

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

// ---------------------------------------------------------------------------
// mergeHooks — 기본 동작
// ---------------------------------------------------------------------------

console.log('\nmergeHooks — basic behavior');

test('team only — no local', () => {
  const team = { pipeline: { after_do: [{ run: 'npm test' }] } };
  const { merged, sources } = mergeHooks(team, null);
  assert.deepStrictEqual(merged.pipeline.after_do, [{ run: 'npm test' }]);
  assert.deepStrictEqual(sources.get('after_do'), ['team']);
});

test('local only — no team hooks', () => {
  const team  = { pipeline: {} };
  const local = { pipeline: { after_do: [{ run: 'echo local' }] } };
  const { merged, sources } = mergeHooks(team, local);
  assert.deepStrictEqual(merged.pipeline.after_do, [{ run: 'echo local' }]);
  assert.deepStrictEqual(sources.get('after_do'), ['local']);
});

test('both team and local — appended in order', () => {
  const team  = { pipeline: { after_do: [{ run: 'npm test' }] } };
  const local = { pipeline: { after_do: [{ run: 'echo local' }] } };
  const { merged, sources } = mergeHooks(team, local);
  assert.strictEqual(merged.pipeline.after_do.length, 2);
  assert.deepStrictEqual(merged.pipeline.after_do[0], { run: 'npm test' });
  assert.deepStrictEqual(merged.pipeline.after_do[1], { run: 'echo local' });
  assert.deepStrictEqual(sources.get('after_do'), ['team', 'local']);
});

test('both null — empty pipeline', () => {
  const { merged, sources } = mergeHooks(null, null);
  assert.deepStrictEqual(merged, { pipeline: {} });
  assert.strictEqual(sources.size, 0);
});

test('team is null, local has hooks', () => {
  const local = { pipeline: { after_report: [{ skill: 'my-skill' }] } };
  const { merged, sources } = mergeHooks(null, local);
  assert.deepStrictEqual(merged.pipeline.after_report, [{ skill: 'my-skill' }]);
  assert.deepStrictEqual(sources.get('after_report'), ['local']);
});

test('multiple events — each merged independently', () => {
  const team = {
    pipeline: {
      after_do:     [{ run: 'npm lint' }],
      after_report: [{ skill: 'pr-draft' }],
    },
  };
  const local = {
    pipeline: {
      after_do:   [{ run: 'echo local-do' }],
      after_check: [{ run: 'echo local-check' }],
    },
  };
  const { merged, sources } = mergeHooks(team, local);

  assert.strictEqual(merged.pipeline.after_do.length, 2);
  assert.deepStrictEqual(sources.get('after_do'), ['team', 'local']);

  assert.strictEqual(merged.pipeline.after_report.length, 1);
  assert.deepStrictEqual(sources.get('after_report'), ['team']);

  assert.strictEqual(merged.pipeline.after_check.length, 1);
  assert.deepStrictEqual(sources.get('after_check'), ['local']);
});

test('team with empty array + local with hooks', () => {
  const team  = { pipeline: { after_do: [] } };
  const local = { pipeline: { after_do: [{ run: 'npm test' }] } };
  const { merged, sources } = mergeHooks(team, local);
  assert.strictEqual(merged.pipeline.after_do.length, 1);
  assert.deepStrictEqual(sources.get('after_do'), ['local']);
});

test('local does not overwrite team — order preserved', () => {
  const hookA = { run: 'npm run a' };
  const hookB = { run: 'npm run b' };
  const hookC = { run: 'npm run c' };
  const team  = { pipeline: { after_do: [hookA, hookB] } };
  const local = { pipeline: { after_do: [hookC] } };
  const { merged } = mergeHooks(team, local);
  assert.deepStrictEqual(merged.pipeline.after_do, [hookA, hookB, hookC]);
});

test('sources count matches hook count', () => {
  const team  = { pipeline: { after_do: [{ run: 'a' }, { run: 'b' }] } };
  const local = { pipeline: { after_do: [{ run: 'c' }] } };
  const { merged, sources } = mergeHooks(team, local);
  const hooks = merged.pipeline.after_do;
  const srcs  = sources.get('after_do');
  assert.strictEqual(hooks.length, srcs.length);
});

// ---------------------------------------------------------------------------
// mergeHooks — 엣지 케이스
// ---------------------------------------------------------------------------

console.log('\nmergeHooks — edge cases');

test('team.pipeline is undefined', () => {
  const { merged } = mergeHooks({}, null);
  assert.deepStrictEqual(merged, { pipeline: {} });
});

test('non-array event value in team is skipped', () => {
  const team = { pipeline: { after_do: 'invalid' } };
  const { merged } = mergeHooks(team, null);
  assert.strictEqual(merged.pipeline.after_do, undefined);
});

test('non-array event value in local is skipped', () => {
  const team  = { pipeline: { after_do: [{ run: 'npm test' }] } };
  const local = { pipeline: { after_do: 42 } };
  const { merged } = mergeHooks(team, local);
  assert.strictEqual(merged.pipeline.after_do.length, 1);
});

// ---------------------------------------------------------------------------
// summarizeHook — command 훅
// ---------------------------------------------------------------------------

console.log('\nsummarizeHook — command hooks');

test('minimal command hook', () => {
  const result = summarizeHook({ run: 'npm test' });
  assert.ok(result.includes('run: npm test'));
});

test('command hook with halt_on_fail', () => {
  const result = summarizeHook({ run: 'npm test', halt_on_fail: true });
  assert.ok(result.includes('halt_on_fail'));
});

test('command hook without halt_on_fail false — not shown', () => {
  const result = summarizeHook({ run: 'npm test', halt_on_fail: false });
  assert.ok(!result.includes('halt_on_fail'));
});

test('command hook with condition', () => {
  const result = summarizeHook({ run: 'npm test', condition: 'check.status == "approved"' });
  assert.ok(result.includes('if: check.status'));
});

test('command hook with timeout', () => {
  const result = summarizeHook({ run: 'npm test', timeout: 60000 });
  assert.ok(result.includes('timeout: 60000ms'));
});

test('command hook with capture_output', () => {
  const result = summarizeHook({ run: 'npm test', capture_output: true });
  assert.ok(result.includes('capture_output'));
});

test('command hook — all optional fields', () => {
  const result = summarizeHook({
    run: 'npm test',
    halt_on_fail: true,
    condition: 'check.ok',
    timeout: 30000,
    capture_output: true,
  });
  assert.ok(result.includes('run: npm test'));
  assert.ok(result.includes('halt_on_fail'));
  assert.ok(result.includes('if: check.ok'));
  assert.ok(result.includes('timeout: 30000ms'));
  assert.ok(result.includes('capture_output'));
});

// ---------------------------------------------------------------------------
// summarizeHook — skill 훅
// ---------------------------------------------------------------------------

console.log('\nsummarizeHook — skill hooks');

test('minimal skill hook', () => {
  const result = summarizeHook({ skill: 'built-pr-draft' });
  assert.ok(result.includes('skill: built-pr-draft'));
});

test('skill hook with halt_on_fail', () => {
  const result = summarizeHook({ skill: 'my-skill', halt_on_fail: true });
  assert.ok(result.includes('halt_on_fail'));
});

test('skill hook with model', () => {
  const result = summarizeHook({ skill: 'my-skill', model: 'sonnet' });
  assert.ok(result.includes('model: sonnet'));
});

test('skill hook with effort', () => {
  const result = summarizeHook({ skill: 'my-skill', effort: 'high' });
  assert.ok(result.includes('effort: high'));
});

test('skill hook with condition', () => {
  const result = summarizeHook({ skill: 'my-skill', condition: 'feature.touches_auth == true' });
  assert.ok(result.includes('if: feature.touches_auth'));
});

test('skill hook — all optional fields', () => {
  const result = summarizeHook({
    skill: 'built-security-audit',
    halt_on_fail: true,
    model: 'opus',
    effort: 'high',
    condition: 'feature.touches_auth == true',
  });
  assert.ok(result.includes('skill: built-security-audit'));
  assert.ok(result.includes('halt_on_fail'));
  assert.ok(result.includes('model: opus'));
  assert.ok(result.includes('effort: high'));
  assert.ok(result.includes('if: feature.touches_auth'));
});

// ---------------------------------------------------------------------------
// summarizeHook — 알 수 없는 형태
// ---------------------------------------------------------------------------

console.log('\nsummarizeHook — unknown hook');

test('unknown hook falls back to JSON.stringify', () => {
  const hook   = { unknown: 'field' };
  const result = summarizeHook(hook);
  assert.ok(result.includes('"unknown"'));
});

// ---------------------------------------------------------------------------
// 완료
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} test(s): ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
