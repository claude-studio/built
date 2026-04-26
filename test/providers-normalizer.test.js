#!/usr/bin/env node
/**
 * test/providers-normalizer.test.js
 *
 * event-normalizer.js 단위 테스트.
 * normalizeClaude, normalizeCodex, 순서 규칙, tool_call/tool_result 짝 검증.
 *
 * 외부 npm 패키지 없음. Node.js assert만 사용.
 */

'use strict';

const assert = require('assert');

const {
  normalizeClaude,
  normalizeCodex,
  checkOrderingRules,
  checkToolPairing,
  STANDARD_EVENT_TYPES,
  TERMINAL_EVENT_TYPES,
} = require('../src/providers/event-normalizer');

// ---------------------------------------------------------------------------
// 테스트 러너
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// normalizeClaude — system/init → phase_start
// ---------------------------------------------------------------------------

console.log('\n[normalizeClaude — phase_start]');

test('system/init → phase_start 이벤트 생성', () => {
  const events = normalizeClaude({ type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus-4-5' });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'phase_start');
  assert.strictEqual(events[0].provider, 'claude');
  assert.strictEqual(events[0].session_id, 'sess-1');
  assert.strictEqual(events[0].model, 'claude-opus-4-5');
});

test('system/init — session_id 누락 시 null', () => {
  const events = normalizeClaude({ type: 'system', subtype: 'init' });
  assert.strictEqual(events[0].session_id, null);
});

test('system(init 아닌 subtype) → 빈 배열', () => {
  const events = normalizeClaude({ type: 'system', subtype: 'other' });
  assert.strictEqual(events.length, 0);
});

test('phase_start — timestamp 존재', () => {
  const events = normalizeClaude({ type: 'system', subtype: 'init' });
  assert.ok(events[0].timestamp, 'timestamp 존재');
  assert.ok(!isNaN(Date.parse(events[0].timestamp)), 'timestamp가 유효한 ISO');
});

// ---------------------------------------------------------------------------
// normalizeClaude — assistant → text_delta, tool_call
// ---------------------------------------------------------------------------

console.log('\n[normalizeClaude — assistant]');

test('assistant + text → text_delta', () => {
  const events = normalizeClaude({
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: '구현 시작합니다.' }],
      usage:   {},
    },
  });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'text_delta');
  assert.strictEqual(events[0].text, '구현 시작합니다.');
});

test('assistant + tool_use → tool_call', () => {
  const events = normalizeClaude({
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id: 'tu_1', name: 'Write', input: {} }],
      usage:   {},
    },
  });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'tool_call');
  assert.strictEqual(events[0].id, 'tu_1');
  assert.strictEqual(events[0].name, 'Write');
});

test('assistant + text + tool_use → text_delta + tool_call (순서 유지)', () => {
  const events = normalizeClaude({
    type: 'assistant',
    message: {
      content: [
        { type: 'text',     text: '파일 작성합니다.' },
        { type: 'tool_use', id: 'tu_2', name: 'Edit', input: {} },
      ],
      usage: {},
    },
  });
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].type, 'text_delta');
  assert.strictEqual(events[1].type, 'tool_call');
});

test('assistant + usage → usage 이벤트 추가 emit', () => {
  const events = normalizeClaude({
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: '안녕' }],
      usage:   { input_tokens: 100, output_tokens: 50 },
    },
  });
  // text_delta + usage
  assert.strictEqual(events.length, 2);
  const usageEvent = events.find((e) => e.type === 'usage');
  assert.ok(usageEvent, 'usage 이벤트 존재');
  assert.strictEqual(usageEvent.input_tokens, 100);
  assert.strictEqual(usageEvent.output_tokens, 50);
});

test('assistant content 없음 → 빈 배열', () => {
  const events = normalizeClaude({ type: 'assistant', message: { content: [], usage: {} } });
  assert.strictEqual(events.length, 0);
});

// ---------------------------------------------------------------------------
// normalizeClaude — tool_result → tool_result
// ---------------------------------------------------------------------------

console.log('\n[normalizeClaude — tool_result]');

test('tool_result → tool_result 이벤트', () => {
  const events = normalizeClaude({ type: 'tool_result', tool_use_id: 'tu_1' });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'tool_result');
  assert.strictEqual(events[0].id, 'tu_1');
  assert.strictEqual(events[0].status, 'completed');
});

test('tool_result — tool_use_id 누락 시 id=null', () => {
  const events = normalizeClaude({ type: 'tool_result' });
  assert.strictEqual(events[0].id, null);
});

// ---------------------------------------------------------------------------
// normalizeClaude — result → phase_end / error
// ---------------------------------------------------------------------------

console.log('\n[normalizeClaude — result]');

test('result(success) → phase_end', () => {
  const events = normalizeClaude({
    type:    'result',
    subtype: 'success',
    result:  '완료',
  });
  const phaseEnd = events.find((e) => e.type === 'phase_end');
  assert.ok(phaseEnd, 'phase_end 존재');
  assert.strictEqual(phaseEnd.status, 'completed');
});

test('result(success) + total_cost_usd → usage + phase_end', () => {
  const events = normalizeClaude({
    type:           'result',
    subtype:        'success',
    result:         '완료',
    total_cost_usd: 0.05,
  });
  assert.ok(events.length >= 2, 'usage + phase_end');
  const usageEvent = events.find((e) => e.type === 'usage');
  assert.ok(usageEvent, 'usage 이벤트 존재');
  assert.strictEqual(usageEvent.cost_usd, 0.05);
});

test('result(error) → error 이벤트 (phase_end 없음)', () => {
  const events = normalizeClaude({
    type:     'result',
    subtype:  'error',
    is_error: true,
    result:   '오류 발생',
  });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'error');
  assert.ok(events[0].message.includes('Claude 응답이 오류로 종료'));
  assert.ok(!events[0].message.includes('오류 발생'));
  assert.ok(events[0].failure.debug_detail.includes('오류 발생'));
});

test('result(is_error=true) → error', () => {
  const events = normalizeClaude({ type: 'result', is_error: true, result: 'fail' });
  assert.strictEqual(events[0].type, 'error');
});

test('result(success) + permission approval 문구 → error', () => {
  const events = normalizeClaude({
    type:    'result',
    subtype: 'success',
    result:  '파일 생성 권한 승인이 필요합니다.',
  });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'error');
  assert.strictEqual(events[0].failure.code, 'claude_permission_request');
  assert.strictEqual(events[0].failure.blocked, true);
});

test('알 수 없는 이벤트 타입 → 빈 배열', () => {
  const events = normalizeClaude({ type: 'unknown_event', data: 123 });
  assert.strictEqual(events.length, 0);
});

test('null/undefined → 빈 배열', () => {
  assert.strictEqual(normalizeClaude(null).length, 0);
  assert.strictEqual(normalizeClaude(undefined).length, 0);
  assert.strictEqual(normalizeClaude('string').length, 0);
});

// ---------------------------------------------------------------------------
// normalizeCodex — 표준 이벤트 passthrough
// ---------------------------------------------------------------------------

console.log('\n[normalizeCodex — passthrough]');

test('phase_start → 그대로 반환', () => {
  const raw = { type: 'phase_start', provider: 'codex', model: 'gpt-5.5', timestamp: '2026-04-26T00:00:00.000Z' };
  const events = normalizeCodex(raw);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'phase_start');
  assert.strictEqual(events[0].provider, 'codex');
});

test('text_delta → 그대로 반환', () => {
  const raw = { type: 'text_delta', text: '작업 중', timestamp: '2026-04-26T00:00:01.000Z' };
  const events = normalizeCodex(raw);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].text, '작업 중');
});

test('tool_call → 그대로 반환', () => {
  const raw = { type: 'tool_call', id: 'c1', name: 'commandExecution', timestamp: '2026-04-26T00:00:02.000Z' };
  const events = normalizeCodex(raw);
  assert.strictEqual(events[0].type, 'tool_call');
  assert.strictEqual(events[0].id, 'c1');
});

test('tool_result → 그대로 반환', () => {
  const raw = { type: 'tool_result', id: 'c1', status: 'completed', timestamp: '2026-04-26T00:00:05.000Z' };
  const events = normalizeCodex(raw);
  assert.strictEqual(events[0].type, 'tool_result');
});

test('phase_end → 그대로 반환', () => {
  const raw = { type: 'phase_end', status: 'completed', duration_ms: 5000, timestamp: '2026-04-26T00:01:00.000Z' };
  const events = normalizeCodex(raw);
  assert.strictEqual(events[0].type, 'phase_end');
});

test('error → 그대로 반환', () => {
  const raw = { type: 'error', message: '연결 오류', retryable: true, timestamp: '2026-04-26T00:00:10.000Z' };
  const events = normalizeCodex(raw);
  assert.strictEqual(events[0].type, 'error');
});

test('timestamp 누락 시 자동 보완', () => {
  const events = normalizeCodex({ type: 'text_delta', text: 'hi' });
  assert.ok(events[0].timestamp, 'timestamp 존재');
  assert.ok(!isNaN(Date.parse(events[0].timestamp)), 'timestamp가 유효한 ISO');
});

test('알 수 없는 이벤트 타입 → 빈 배열', () => {
  const events = normalizeCodex({ type: 'agentMessage', data: 'raw' });
  assert.strictEqual(events.length, 0);
});

// ---------------------------------------------------------------------------
// checkOrderingRules — 순서 규칙
// ---------------------------------------------------------------------------

console.log('\n[checkOrderingRules — 순서 규칙]');

test('올바른 순서: phase_start → text_delta → phase_end → 위반 없음', () => {
  const events = [
    { type: 'phase_start' },
    { type: 'text_delta', text: 'hi' },
    { type: 'phase_end', status: 'completed' },
  ];
  const violations = checkOrderingRules(events);
  assert.strictEqual(violations.length, 0, `위반 없어야 함: ${violations}`);
});

test('phase_end 이후 추가 이벤트 → 위반 감지', () => {
  const events = [
    { type: 'phase_start' },
    { type: 'phase_end', status: 'completed' },
    { type: 'text_delta', text: '이미 종료 후' },  // 위반
  ];
  const violations = checkOrderingRules(events);
  assert.ok(violations.length > 0, '위반 감지해야 함');
  assert.ok(violations[0].includes('text_delta'), `위반 내용: ${violations[0]}`);
});

test('error 이후 추가 이벤트 → 위반 감지', () => {
  const events = [
    { type: 'phase_start' },
    { type: 'error', message: '오류' },
    { type: 'phase_end', status: 'completed' },  // 위반: error 후 phase_end 금지
  ];
  const violations = checkOrderingRules(events);
  assert.ok(violations.length > 0);
});

test('error 후 phase_end 없음 → 위반 없음', () => {
  const events = [
    { type: 'phase_start' },
    { type: 'text_delta', text: 'hello' },
    { type: 'error', message: '실패' },
  ];
  const violations = checkOrderingRules(events);
  assert.strictEqual(violations.length, 0);
});

test('빈 이벤트 배열 → 위반 없음', () => {
  assert.strictEqual(checkOrderingRules([]).length, 0);
});

// ---------------------------------------------------------------------------
// checkToolPairing — tool_call/tool_result 짝
// ---------------------------------------------------------------------------

console.log('\n[checkToolPairing — tool_call/tool_result]');

test('짝이 맞는 tool_call + tool_result → 미짝 없음', () => {
  const events = [
    { type: 'tool_call',   id: 't1', name: 'Write' },
    { type: 'tool_result', id: 't1', status: 'completed' },
  ];
  const { unpaired_calls, unpaired_results } = checkToolPairing(events);
  assert.strictEqual(unpaired_calls.length, 0);
  assert.strictEqual(unpaired_results.length, 0);
});

test('tool_call만 있고 tool_result 없음 → unpaired_calls에 포함', () => {
  const events = [
    { type: 'tool_call', id: 't1', name: 'Write' },
  ];
  const { unpaired_calls } = checkToolPairing(events);
  assert.ok(unpaired_calls.includes('t1'));
});

test('tool_result만 있고 tool_call 없음 → unpaired_results에 포함', () => {
  const events = [
    { type: 'tool_result', id: 't2', status: 'completed' },
  ];
  const { unpaired_results } = checkToolPairing(events);
  assert.ok(unpaired_results.includes('t2'));
});

test('여러 tool_call/tool_result 모두 짝 맞음', () => {
  const events = [
    { type: 'tool_call',   id: 'a', name: 'Read' },
    { type: 'tool_result', id: 'a', status: 'completed' },
    { type: 'tool_call',   id: 'b', name: 'Write' },
    { type: 'tool_result', id: 'b', status: 'completed' },
  ];
  const { unpaired_calls, unpaired_results } = checkToolPairing(events);
  assert.strictEqual(unpaired_calls.length, 0);
  assert.strictEqual(unpaired_results.length, 0);
});

test('id 없는 tool_call → 짝 추적 대상 아님', () => {
  const events = [
    { type: 'tool_call' },          // id 없음
    { type: 'tool_result' },        // id 없음
  ];
  const { unpaired_calls, unpaired_results } = checkToolPairing(events);
  assert.strictEqual(unpaired_calls.length, 0);
  assert.strictEqual(unpaired_results.length, 0);
});

// ---------------------------------------------------------------------------
// 상수 확인
// ---------------------------------------------------------------------------

console.log('\n[상수 확인]');

test('STANDARD_EVENT_TYPES에 7개 표준 이벤트 타입 포함', () => {
  const expected = ['phase_start', 'text_delta', 'tool_call', 'tool_result', 'usage', 'phase_end', 'error'];
  for (const t of expected) {
    assert.ok(STANDARD_EVENT_TYPES.has(t), `${t} 누락`);
  }
});

test('TERMINAL_EVENT_TYPES에 phase_end, error 포함', () => {
  assert.ok(TERMINAL_EVENT_TYPES.has('phase_end'));
  assert.ok(TERMINAL_EVENT_TYPES.has('error'));
  assert.ok(!TERMINAL_EVENT_TYPES.has('text_delta'));
});

// ---------------------------------------------------------------------------
// 결과
// ---------------------------------------------------------------------------

console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
if (failed > 0) process.exit(1);
