#!/usr/bin/env node
/**
 * test/providers-failure.test.js
 *
 * src/providers/failure.js 단위 테스트.
 *
 * 검증 항목:
 *   - FAILURE_KINDS enum 존재
 *   - createFailure: 필드 계약, 기본값
 *   - sanitizeDebugDetail: Authorization, Bearer, sk-/pk-/org- 마스킹, 길이 제한
 *   - classifyClaudeFailure: timeout, spawnError(ENOENT/일반), jsonParseError, stderrBuf(auth/unknown), exitCode
 *   - classifyCodexFailure: auth, config, sandbox, timeout, provider_unavailable, model_response, brokerBusy, brokerStartFailed, unknown
 *   - failureToEventFields: message/retryable/failure 필드 계약
 *   - blocked/retryable 매트릭스
 *
 * 외부 npm 패키지 없음. Node.js assert만 사용.
 */

'use strict';

const assert = require('assert');
const {
  FAILURE_KINDS,
  createFailure,
  sanitizeDebugDetail,
  classifyClaudeFailure,
  classifyCodexFailure,
  failureToEventFields,
} = require('../src/providers/failure');

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
    if (e.stack) {
      e.stack.split('\n').slice(1, 3).forEach((l) => console.error(`    ${l}`));
    }
    failed++;
  }
}

// ---------------------------------------------------------------------------
// FAILURE_KINDS
// ---------------------------------------------------------------------------

console.log('\n[FAILURE_KINDS enum]');

test('모든 taxonomy kind가 정의되어 있다', () => {
  const expected = ['auth', 'config', 'sandbox', 'timeout', 'provider_unavailable',
    'model_response', 'runner_normalize', 'runner_io', 'unknown'];
  for (const kind of expected) {
    assert.ok(Object.values(FAILURE_KINDS).includes(kind), `kind 누락: ${kind}`);
  }
});

test('FAILURE_KINDS 객체는 동결(frozen)되어 있다', () => {
  assert.ok(Object.isFrozen(FAILURE_KINDS));
});

// ---------------------------------------------------------------------------
// createFailure
// ---------------------------------------------------------------------------

console.log('\n[createFailure]');

test('필수 필드가 모두 존재한다', () => {
  const f = createFailure({
    kind:         FAILURE_KINDS.AUTH,
    user_message: 'auth error',
    retryable:    false,
    blocked:      true,
  });
  const REQUIRED = ['kind', 'code', 'user_message', 'action', 'retryable', 'blocked', 'debug_detail', 'raw_provider'];
  for (const key of REQUIRED) {
    assert.ok(key in f, `필드 누락: ${key}`);
  }
});

test('kind 기본값은 unknown이다', () => {
  const f = createFailure({ user_message: 'test', retryable: false, blocked: false });
  assert.strictEqual(f.kind, FAILURE_KINDS.UNKNOWN);
});

test('user_message 기본값이 있다', () => {
  const f = createFailure({ kind: FAILURE_KINDS.AUTH, retryable: false, blocked: true });
  assert.ok(typeof f.user_message === 'string' && f.user_message.length > 0);
});

test('retryable과 blocked는 boolean이다', () => {
  const f = createFailure({ kind: FAILURE_KINDS.TIMEOUT, user_message: 'x', retryable: 1, blocked: 0 });
  assert.strictEqual(typeof f.retryable, 'boolean');
  assert.strictEqual(typeof f.blocked, 'boolean');
  assert.strictEqual(f.retryable, true);
  assert.strictEqual(f.blocked, false);
});

// ---------------------------------------------------------------------------
// sanitizeDebugDetail
// ---------------------------------------------------------------------------

console.log('\n[sanitizeDebugDetail]');

test('Authorization Bearer 헤더를 마스킹한다', () => {
  const result = sanitizeDebugDetail('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secretdata.signature');
  assert.ok(!result.includes('eyJhbGciOiJIUzI1NiJ9'));
  assert.ok(result.includes('[REDACTED]'));
});

test('Bearer 토큰 단독을 마스킹한다', () => {
  const result = sanitizeDebugDetail('Error: Bearer sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  assert.ok(!result.includes('sk-xxx'));
});

test('sk- 형식 키를 마스킹한다', () => {
  const result = sanitizeDebugDetail('API key sk-abcdefghijklmnopqrstuvwxyz1234567890 is invalid');
  assert.ok(!result.includes('sk-abcdef'), `마스킹 실패: ${result}`);
  assert.ok(result.includes('[REDACTED_KEY]'));
});

test('org- 형식 키를 마스킹한다', () => {
  const result = sanitizeDebugDetail('org-abcdefghijklmnopqrstuvwx');
  assert.ok(result.includes('[REDACTED_KEY]'));
});

test('무해한 텍스트는 그대로 유지한다', () => {
  const input = 'process exited with code 1';
  const result = sanitizeDebugDetail(input);
  assert.strictEqual(result, input);
});

test('2000자 이후를 잘라낸다', () => {
  const result = sanitizeDebugDetail('a'.repeat(3000));
  assert.strictEqual(result.length, 2000);
});

test('null/undefined 입력은 빈 문자열을 반환한다', () => {
  assert.strictEqual(sanitizeDebugDetail(null), '');
  assert.strictEqual(sanitizeDebugDetail(undefined), '');
  assert.strictEqual(sanitizeDebugDetail(''), '');
});

// ---------------------------------------------------------------------------
// classifyClaudeFailure
// ---------------------------------------------------------------------------

console.log('\n[classifyClaudeFailure]');

test('timedOut=true → kind=timeout, retryable=true, blocked=false', () => {
  const f = classifyClaudeFailure({ timedOut: true, timeoutMs: 60000 });
  assert.strictEqual(f.kind, FAILURE_KINDS.TIMEOUT);
  assert.strictEqual(f.retryable, true);
  assert.strictEqual(f.blocked, false);
  assert.ok(f.user_message.includes('60000'));
});

test('spawnError ENOENT → kind=provider_unavailable, blocked=true', () => {
  const err = new Error('spawn claude ENOENT');
  err.code = 'ENOENT';
  const f = classifyClaudeFailure({ spawnError: err });
  assert.strictEqual(f.kind, FAILURE_KINDS.PROVIDER_UNAVAILABLE);
  assert.strictEqual(f.blocked, true);
  assert.strictEqual(f.retryable, false);
});

test('spawnError 일반 → kind=provider_unavailable, blocked=true', () => {
  const err = new Error('spawn failed: permission denied');
  const f = classifyClaudeFailure({ spawnError: err });
  assert.strictEqual(f.kind, FAILURE_KINDS.PROVIDER_UNAVAILABLE);
  assert.strictEqual(f.blocked, true);
});

test('jsonParseError → kind=model_response, retryable=true', () => {
  const f = classifyClaudeFailure({ jsonParseError: 'Unexpected token < in JSON' });
  assert.strictEqual(f.kind, FAILURE_KINDS.MODEL_RESPONSE);
  assert.strictEqual(f.retryable, true);
  assert.strictEqual(f.blocked, false);
});

test('stderrBuf에 auth 키워드 → kind=auth, blocked=true', () => {
  const f = classifyClaudeFailure({ stderrBuf: 'Error: 401 Unauthorized', exitCode: 1 });
  assert.strictEqual(f.kind, FAILURE_KINDS.AUTH);
  assert.strictEqual(f.blocked, true);
  assert.strictEqual(f.retryable, false);
});

test('stderrBuf 일반 → kind=unknown', () => {
  const f = classifyClaudeFailure({ stderrBuf: 'some random error', exitCode: 2 });
  assert.strictEqual(f.kind, FAILURE_KINDS.UNKNOWN);
});

test('exitCode만 있음 → kind=unknown', () => {
  const f = classifyClaudeFailure({ exitCode: 1 });
  assert.strictEqual(f.kind, FAILURE_KINDS.UNKNOWN);
});

test('debug_detail은 sanitize된다 (raw secret 포함 시)', () => {
  const f = classifyClaudeFailure({ stderrBuf: 'sk-abcdefghijklmnopqrstuvwxyz1234567890 error', exitCode: 1 });
  assert.ok(!f.debug_detail.includes('sk-abcdef'));
});

// ---------------------------------------------------------------------------
// classifyCodexFailure
// ---------------------------------------------------------------------------

console.log('\n[classifyCodexFailure]');

test('kind=auth → kind=auth, blocked=true, retryable=false', () => {
  const f = classifyCodexFailure({ kind: FAILURE_KINDS.AUTH, message: 'auth required' });
  assert.strictEqual(f.kind, FAILURE_KINDS.AUTH);
  assert.strictEqual(f.blocked, true);
  assert.strictEqual(f.retryable, false);
  assert.ok(f.action && f.action.length > 0);
});

test('kind=config → kind=config, blocked=true', () => {
  const f = classifyCodexFailure({ kind: FAILURE_KINDS.CONFIG, message: 'bad config' });
  assert.strictEqual(f.kind, FAILURE_KINDS.CONFIG);
  assert.strictEqual(f.blocked, true);
});

test('kind=sandbox → kind=sandbox, blocked=true', () => {
  const f = classifyCodexFailure({ kind: FAILURE_KINDS.SANDBOX, message: 'read-only conflict' });
  assert.strictEqual(f.kind, FAILURE_KINDS.SANDBOX);
  assert.strictEqual(f.blocked, true);
  assert.strictEqual(f.retryable, false);
});

test('kind=timeout → kind=timeout, retryable=true, blocked=false', () => {
  const f = classifyCodexFailure({ kind: FAILURE_KINDS.TIMEOUT, message: 'timed out after 1800000ms' });
  assert.strictEqual(f.kind, FAILURE_KINDS.TIMEOUT);
  assert.strictEqual(f.retryable, true);
  assert.strictEqual(f.blocked, false);
});

test('kind=provider_unavailable → kind=provider_unavailable', () => {
  const f = classifyCodexFailure({ kind: FAILURE_KINDS.PROVIDER_UNAVAILABLE, message: 'CLI not found' });
  assert.strictEqual(f.kind, FAILURE_KINDS.PROVIDER_UNAVAILABLE);
});

test('brokerBusy=true → kind=provider_unavailable, retryable=true', () => {
  const f = classifyCodexFailure({ brokerBusy: true });
  assert.strictEqual(f.kind, FAILURE_KINDS.PROVIDER_UNAVAILABLE);
  assert.strictEqual(f.retryable, true);
  assert.strictEqual(f.blocked, false);
});

test('brokerStartFailed=true → kind=provider_unavailable, blocked=true', () => {
  const f = classifyCodexFailure({ brokerStartFailed: true });
  assert.strictEqual(f.kind, FAILURE_KINDS.PROVIDER_UNAVAILABLE);
  assert.strictEqual(f.blocked, true);
  assert.strictEqual(f.retryable, false);
});

test('kind=model_response → retryable=true, blocked=false', () => {
  const f = classifyCodexFailure({ kind: FAILURE_KINDS.MODEL_RESPONSE, message: 'model returned error' });
  assert.strictEqual(f.kind, FAILURE_KINDS.MODEL_RESPONSE);
  assert.strictEqual(f.retryable, true);
  assert.strictEqual(f.blocked, false);
});

test('kind 미지정 → kind=unknown', () => {
  const f = classifyCodexFailure({ message: 'unexpected error' });
  assert.strictEqual(f.kind, FAILURE_KINDS.UNKNOWN);
});

test('raw_provider는 codex다', () => {
  const f = classifyCodexFailure({ kind: FAILURE_KINDS.AUTH });
  assert.strictEqual(f.raw_provider, 'codex');
});

// ---------------------------------------------------------------------------
// failureToEventFields
// ---------------------------------------------------------------------------

console.log('\n[failureToEventFields]');

test('message는 failure.user_message이다', () => {
  const f = createFailure({ kind: FAILURE_KINDS.AUTH, user_message: '인증 필요', retryable: false, blocked: true });
  const fields = failureToEventFields(f);
  assert.strictEqual(fields.message, '인증 필요');
});

test('retryable은 failure.retryable이다', () => {
  const f = createFailure({ kind: FAILURE_KINDS.TIMEOUT, user_message: '타임아웃', retryable: true, blocked: false });
  const fields = failureToEventFields(f);
  assert.strictEqual(fields.retryable, true);
});

test('failure 필드가 포함된다', () => {
  const f = createFailure({ kind: FAILURE_KINDS.CONFIG, user_message: '설정 오류', retryable: false, blocked: true });
  const fields = failureToEventFields(f);
  assert.ok(fields.failure === f);
});

// ---------------------------------------------------------------------------
// blocked/retryable 매트릭스 검증
// ---------------------------------------------------------------------------

console.log('\n[blocked/retryable 매트릭스]');

const MATRIX = [
  { kind: FAILURE_KINDS.AUTH,               blocked: true,  retryable: false },
  { kind: FAILURE_KINDS.CONFIG,             blocked: true,  retryable: false },
  { kind: FAILURE_KINDS.SANDBOX,            blocked: true,  retryable: false },
  { kind: FAILURE_KINDS.TIMEOUT,            blocked: false, retryable: true  },
  { kind: FAILURE_KINDS.MODEL_RESPONSE,     blocked: false, retryable: true  },
];

for (const { kind, blocked, retryable } of MATRIX) {
  test(`classifyCodexFailure(${kind}): blocked=${blocked}, retryable=${retryable}`, () => {
    const f = classifyCodexFailure({ kind, message: 'test' });
    assert.strictEqual(f.blocked, blocked, `blocked 불일치: kind=${kind}`);
    assert.strictEqual(f.retryable, retryable, `retryable 불일치: kind=${kind}`);
  });
}

// ---------------------------------------------------------------------------
// 결과 출력
// ---------------------------------------------------------------------------

console.log(`\n결과: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
