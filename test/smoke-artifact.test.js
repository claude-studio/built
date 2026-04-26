#!/usr/bin/env node
/**
 * test/smoke-artifact.test.js
 *
 * scripts/smoke-artifact.js 단위 테스트.
 * secret redaction, artifact 생성/저장, failure taxonomy 검증.
 * Node.js 내장 assert + fs + os만 사용 (외부 패키지 없음).
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const {
  FAILURE_KINDS,
  createSummary,
  saveSummary,
  formatFailureSummary,
  formatTimestamp,
} = require('../scripts/smoke-artifact');

// ---------------------------------------------------------------------------
// 테스트 헬퍼
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
let tmpDirs = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'built-smoke-artifact-test-'));
  tmpDirs.push(dir);
  return dir;
}

function cleanup() {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  tmpDirs = [];
}

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// FAILURE_KINDS
// ---------------------------------------------------------------------------

console.log('\nFAILURE_KINDS');

test('표준 failure kind 목록이 존재', () => {
  assert.ok(Array.isArray(FAILURE_KINDS));
  assert.ok(FAILURE_KINDS.includes('provider_unavailable'));
  assert.ok(FAILURE_KINDS.includes('auth'));
  assert.ok(FAILURE_KINDS.includes('timeout'));
  assert.ok(FAILURE_KINDS.includes('model_response'));
  assert.ok(FAILURE_KINDS.includes('sandbox'));
  assert.ok(FAILURE_KINDS.includes('app_server'));
  assert.ok(FAILURE_KINDS.includes('unknown'));
});

// ---------------------------------------------------------------------------
// formatTimestamp
// ---------------------------------------------------------------------------

console.log('\nformatTimestamp');

test('ISO 날짜를 compact ���식으로 변환', () => {
  const date = new Date('2026-04-26T09:30:45.000Z');
  const result = formatTimestamp(date);
  assert.ok(/^\d{8}T\d{6}$/.test(result), `포맷 불일치: ${result}`);
});

// ---------------------------------------------------------------------------
// createSummary — 기본 구조
// ---------------------------------------------------------------------------

console.log('\ncreateSummary');

test('성공 artifact 필수 필드 존재', () => {
  const summary = createSummary({
    provider: 'codex', phase: 'plan_synthesis',
    duration_ms: 5000, skipped: false, success: true,
  });
  assert.strictEqual(summary.schema_version, '1.0.0');
  assert.strictEqual(summary.provider, 'codex');
  assert.strictEqual(summary.phase, 'plan_synthesis');
  assert.strictEqual(summary.duration_ms, 5000);
  assert.strictEqual(summary.skipped, false);
  assert.strictEqual(summary.success, true);
  assert.strictEqual(summary.failure, null);
  assert.ok(summary.id);
  assert.ok(summary.created_at);
});

test('실패 artifact에 failure 객체 포함', () => {
  const summary = createSummary({
    provider: 'codex', phase: 'do',
    duration_ms: 0, skipped: false, success: false,
    failure_kind: 'auth', failure_message: '인증 실패',
  });
  assert.strictEqual(summary.success, false);
  assert.ok(summary.failure);
  assert.strictEqual(summary.failure.kind, 'auth');
  assert.strictEqual(summary.failure.message, '인증 실패');
});

test('skip artifact는 success=true, skipped=true, failure=null', () => {
  const summary = createSummary({
    provider: 'codex', phase: 'do',
    duration_ms: 0, skipped: true, success: true,
  });
  assert.strictEqual(summary.skipped, true);
  assert.strictEqual(summary.success, true);
  assert.strictEqual(summary.failure, null);
});

test('verification 필드 전달', () => {
  const summary = createSummary({
    provider: 'codex', phase: 'plan_synthesis',
    duration_ms: 3000, skipped: false, success: true,
    verification: { plan_steps: 5 },
  });
  assert.deepStrictEqual(summary.verification, { plan_steps: 5 });
});

test('model 필드 전달', () => {
  const summary = createSummary({
    provider: 'codex', phase: 'do',
    duration_ms: 1000, skipped: false, success: true,
    model: 'gpt-5.5',
  });
  assert.strictEqual(summary.model, 'gpt-5.5');
});

test('model 미지정 시 null', () => {
  const summary = createSummary({
    provider: 'codex', phase: 'do',
    duration_ms: 1000, skipped: false, success: true,
  });
  assert.strictEqual(summary.model, null);
});

// ---------------------------------------------------------------------------
// createSummary — secret redaction
// ---------------------------------------------------------------------------

console.log('\ncreateSummary — secret redaction');

test('failure_message에 포함된 API 키가 redact됨', () => {
  const apiKey = 'sk-ant-api03-' + 'x'.repeat(20);
  const summary = createSummary({
    provider: 'codex', phase: 'do',
    duration_ms: 0, skipped: false, success: false,
    failure_kind: 'auth',
    failure_message: `인증 실패: key=${apiKey}`,
  });
  assert.ok(!summary.failure.message.includes(apiKey), `API 키가 redact되지 않음: ${summary.failure.message}`);
  assert.ok(summary.failure.message.includes('[REDACTED]'));
});

test('failure_message에 포함된 홈 경로가 redact됨', () => {
  const homeDir = os.homedir();
  const summary = createSummary({
    provider: 'codex', phase: 'do',
    duration_ms: 0, skipped: false, success: false,
    failure_kind: 'unknown',
    failure_message: `경로: ${homeDir}/project/secret`,
  });
  assert.ok(!summary.failure.message.includes(homeDir), `홈 경로가 redact되지 않음: ${summary.failure.message}`);
});

test('verification 값에 포함된 API 키가 redact���', () => {
  const apiKey = 'sk-proj-' + 'y'.repeat(30);
  const summary = createSummary({
    provider: 'codex', phase: 'plan_synthesis',
    duration_ms: 5000, skipped: false, success: true,
    verification: { output: `result with ${apiKey}` },
  });
  assert.ok(!JSON.stringify(summary.verification).includes(apiKey), 'verification의 API ��가 redact되지 않음');
});

test('verification 값에 포���된 홈 경로가 redact됨', () => {
  const homeDir = os.homedir();
  const summary = createSummary({
    provider: 'codex', phase: 'plan_synthesis',
    duration_ms: 5000, skipped: false, success: true,
    verification: { path: `${homeDir}/project/test` },
  });
  assert.ok(!JSON.stringify(summary.verification).includes(homeDir), 'verification의 홈 경로��� redact되지 않음');
});

test('session_id 값이 redact됨', () => {
  const summary = createSummary({
    provider: 'codex', phase: 'do',
    duration_ms: 0, skipped: false, success: false,
    failure_kind: 'unknown',
    failure_message: 'session_id: my-secret-session-123',
  });
  assert.ok(!summary.failure.message.includes('my-secret-session-123'), 'session_id가 redact되지 않음');
});

test('ghp_ 토큰이 redact됨', () => {
  const token = 'ghp_' + 'a'.repeat(36);
  const summary = createSummary({
    provider: 'codex', phase: 'do',
    duration_ms: 0, skipped: false, success: false,
    failure_kind: 'auth',
    failure_message: `token: ${token}`,
  });
  assert.ok(!summary.failure.message.includes(token), 'ghp_ 토큰이 redact되지 않음');
});

test('일반 텍스트는 변경되지 않음', () => {
  const summary = createSummary({
    provider: 'codex', phase: 'do',
    duration_ms: 100, skipped: false, success: false,
    failure_kind: 'timeout',
    failure_message: '실행 시간 초과',
  });
  assert.strictEqual(summary.failure.message, '실행 시간 초과');
});

// ---------------------------------------------------------------------------
// saveSummary
// ---------------------------------------------------------------------------

console.log('\nsaveSummary');

test('summary.json 파일이 올바른 경로에 저장됨', () => {
  const root = makeTmpDir();
  const summary = createSummary({
    provider: 'codex', phase: 'plan_synthesis',
    duration_ms: 100, skipped: false, success: true,
  });
  const filePath = saveSummary(root, summary);

  assert.ok(fs.existsSync(filePath), `파일 미생성: ${filePath}`);
  assert.ok(filePath.includes('.built/runtime/smoke/'), `경로 불���치: ${filePath}`);
  assert.ok(filePath.endsWith('/summary.json'), `파일명 불일치: ${filePath}`);

  const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.strictEqual(saved.provider, 'codex');
  assert.strictEqual(saved.phase, 'plan_synthesis');
  assert.strictEqual(saved.success, true);
});

test('skip artifact도 저장됨', () => {
  const root = makeTmpDir();
  const summary = createSummary({
    provider: 'codex', phase: 'do',
    duration_ms: 0, skipped: true, success: true,
  });
  const filePath = saveSummary(root, summary);
  assert.ok(fs.existsSync(filePath));

  const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.strictEqual(saved.skipped, true);
});

test('실패 artifact가 저장되고 failure 필드 포함', () => {
  const root = makeTmpDir();
  const summary = createSummary({
    provider: 'codex', phase: 'do',
    duration_ms: 0, skipped: false, success: false,
    failure_kind: 'auth', failure_message: '인증 실패',
  });
  const filePath = saveSummary(root, summary);

  const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.strictEqual(saved.success, false);
  assert.strictEqual(saved.failure.kind, 'auth');
});

test('저장된 파일에 secret이 없음 (API 키 redaction 확인)', () => {
  const root = makeTmpDir();
  const apiKey = 'sk-ant-api03-' + 'z'.repeat(20);
  const summary = createSummary({
    provider: 'codex', phase: 'do',
    duration_ms: 0, skipped: false, success: false,
    failure_kind: 'auth',
    failure_message: `키: ${apiKey}`,
  });
  const filePath = saveSummary(root, summary);
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(!content.includes(apiKey), `저장된 파일에 API 키가 남아있음`);
});

// ---------------------------------------------------------------------------
// formatFailureSummary
// ---------------------------------------------------------------------------

console.log('\nformatFailureSummary');

test('각 failure kind에 대해 한글 요약 반환', () => {
  for (const kind of FAILURE_KINDS) {
    const msg = formatFailureSummary(kind, 'do');
    assert.ok(msg.includes('[smoke:do]'), `prefix 누락: ${msg}`);
    assert.ok(msg.length > 10, `메시지가 너무 짧음: ${msg}`);
  }
});

test('plan_synthesis phase는 [smoke:plan]으로 표시', () => {
  const msg = formatFailureSummary('auth', 'plan_synthesis');
  assert.ok(msg.includes('[smoke:plan]'), `prefix 불일치: ${msg}`);
});

test('detail 파라미터가 메시지에 포함됨', () => {
  const msg = formatFailureSummary('timeout', 'do', '20분 초과');
  assert.ok(msg.includes('20분 초과'), `detail 누락: ${msg}`);
});

// ---------------------------------------------------------------------------
// 결과 출력
// ---------------------------------------------------------------------------

cleanup();

console.log('');
console.log(`총 ${passed + failed}개 중 ${passed}개 통과, ${failed}개 실패`);
if (failed > 0) {
  process.exit(1);
}
