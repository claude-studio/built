#!/usr/bin/env node
/**
 * test/result-to-markdown.test.js
 *
 * result-to-markdown.js 단위 테스트 (Node.js assert + fs만 사용, 외부 패키지 없음)
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { convert } = require('../src/result-to-markdown');
const { parse } = require('../src/frontmatter');

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

/** 임시 파일 경로 생성 */
function tmpFile(name) {
  return path.join(os.tmpdir(), `built-test-${Date.now()}-${name}`);
}

/** 파일 읽고 frontmatter + content 반환 */
function readResult(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return parse(text);
}

// ---------------------------------------------------------------------------
// 기본 동작
// ---------------------------------------------------------------------------

console.log('\n[convert] 기본 동작');

test('파일 생성 확인', () => {
  const out = tmpFile('basic.md');
  convert(
    {
      feature_id: 'user-auth',
      subtype: 'success',
      model: 'claude-opus-4-6',
      total_cost_usd: 0.05,
      duration_ms: 3000,
      created_at: '2026-04-24T05:00:00.000Z',
      result: 'Hello, world!',
    },
    out
  );
  assert.ok(fs.existsSync(out), '파일이 생성되어야 한다');
  fs.unlinkSync(out);
});

test('frontmatter feature_id 저장', () => {
  const out = tmpFile('feature_id.md');
  convert({ feature_id: 'user-auth', subtype: 'success', result: '' }, out);
  const { data } = readResult(out);
  assert.strictEqual(data.feature_id, 'user-auth');
  fs.unlinkSync(out);
});

test('frontmatter status: success → completed', () => {
  const out = tmpFile('status-ok.md');
  convert({ feature_id: 'f1', subtype: 'success', result: '' }, out);
  const { data } = readResult(out);
  assert.strictEqual(data.status, 'completed');
  fs.unlinkSync(out);
});

test('frontmatter status: error → failed', () => {
  const out = tmpFile('status-err.md');
  convert({ feature_id: 'f1', subtype: 'error', result: '' }, out);
  const { data } = readResult(out);
  assert.strictEqual(data.status, 'failed');
  fs.unlinkSync(out);
});

test('frontmatter status: 명시 지정 우선', () => {
  const out = tmpFile('status-explicit.md');
  convert({ feature_id: 'f1', subtype: 'success', status: 'failed', result: '' }, out);
  const { data } = readResult(out);
  assert.strictEqual(data.status, 'failed');
  fs.unlinkSync(out);
});

test('frontmatter model 저장', () => {
  const out = tmpFile('model.md');
  convert({ feature_id: 'f1', subtype: 'success', model: 'claude-opus-4-6', result: '' }, out);
  const { data } = readResult(out);
  assert.strictEqual(data.model, 'claude-opus-4-6');
  fs.unlinkSync(out);
});

test('frontmatter cost_usd: cost_usd 필드 우선', () => {
  const out = tmpFile('cost-usd.md');
  convert({ feature_id: 'f1', subtype: 'success', cost_usd: 0.03, total_cost_usd: 0.05, result: '' }, out);
  const { data } = readResult(out);
  assert.strictEqual(data.cost_usd, 0.03);
  fs.unlinkSync(out);
});

test('frontmatter cost_usd: total_cost_usd fallback', () => {
  const out = tmpFile('cost-total.md');
  convert({ feature_id: 'f1', subtype: 'success', total_cost_usd: 0.05184225, result: '' }, out);
  const { data } = readResult(out);
  assert.strictEqual(data.cost_usd, 0.05184225);
  fs.unlinkSync(out);
});

test('frontmatter duration_ms: 직접 제공', () => {
  const out = tmpFile('duration.md');
  convert({ feature_id: 'f1', subtype: 'success', duration_ms: 3500, result: '' }, out);
  const { data } = readResult(out);
  assert.strictEqual(data.duration_ms, 3500);
  fs.unlinkSync(out);
});

test('frontmatter duration_ms: started_at/updated_at 계산', () => {
  const out = tmpFile('duration-calc.md');
  convert({
    feature_id: 'f1',
    subtype: 'success',
    started_at: '2026-04-24T05:00:00.000Z',
    updated_at: '2026-04-24T05:00:10.000Z',
    result: '',
  }, out);
  const { data } = readResult(out);
  assert.strictEqual(data.duration_ms, 10000);
  fs.unlinkSync(out);
});

test('frontmatter created_at: 직접 제공', () => {
  const out = tmpFile('created-at.md');
  const ts = '2026-04-24T05:00:00.000Z';
  convert({ feature_id: 'f1', subtype: 'success', created_at: ts, result: '' }, out);
  const { data } = readResult(out);
  assert.strictEqual(data.created_at, ts);
  fs.unlinkSync(out);
});

test('frontmatter created_at: updated_at fallback', () => {
  const out = tmpFile('created-at-fallback.md');
  const ts = '2026-04-24T05:00:10.000Z';
  convert({ feature_id: 'f1', subtype: 'success', updated_at: ts, result: '' }, out);
  const { data } = readResult(out);
  assert.strictEqual(data.created_at, ts);
  fs.unlinkSync(out);
});

// ---------------------------------------------------------------------------
// 본문 (body)
// ---------------------------------------------------------------------------

console.log('\n[convert] 본문 저장');

test('Claude 응답 전문이 본문에 저장', () => {
  const out = tmpFile('body.md');
  const responseText = '## 구현 결과\n\nauth 모듈 완료.';
  convert({ feature_id: 'f1', subtype: 'success', result: responseText }, out);
  const { content } = readResult(out);
  assert.strictEqual(content, responseText);
  fs.unlinkSync(out);
});

test('result 없으면 본문 빈 문자열', () => {
  const out = tmpFile('empty-body.md');
  convert({ feature_id: 'f1', subtype: 'success' }, out);
  const { content } = readResult(out);
  assert.strictEqual(content, '');
  fs.unlinkSync(out);
});

// ---------------------------------------------------------------------------
// 파일 형식
// ---------------------------------------------------------------------------

console.log('\n[convert] 파일 형식');

test('파일이 --- 로 시작', () => {
  const out = tmpFile('format.md');
  convert({ feature_id: 'f1', subtype: 'success', result: 'ok' }, out);
  const text = fs.readFileSync(out, 'utf8');
  assert.ok(text.startsWith('---\n'), '파일은 ---\\n 으로 시작해야 한다');
  fs.unlinkSync(out);
});

test('frontmatter 필수 6개 필드 모두 존재', () => {
  const out = tmpFile('fields.md');
  convert({
    feature_id: 'f1',
    subtype: 'success',
    model: 'claude-opus-4-6',
    total_cost_usd: 0.01,
    duration_ms: 1000,
    created_at: '2026-04-24T00:00:00.000Z',
    result: '',
  }, out);
  const { data } = readResult(out);
  assert.ok('feature_id' in data, 'feature_id 누락');
  assert.ok('status' in data, 'status 누락');
  assert.ok('model' in data, 'model 누락');
  assert.ok('cost_usd' in data, 'cost_usd 누락');
  assert.ok('duration_ms' in data, 'duration_ms 누락');
  assert.ok('created_at' in data, 'created_at 누락');
  fs.unlinkSync(out);
});

// ---------------------------------------------------------------------------
// 디렉토리 자동 생성
// ---------------------------------------------------------------------------

console.log('\n[convert] 디렉토리 자동 생성');

test('존재하지 않는 중간 디렉토리 자동 생성', () => {
  const dir = path.join(os.tmpdir(), `built-test-${Date.now()}`, 'runs', 'user-auth');
  const out = path.join(dir, 'do-result.md');
  convert({ feature_id: 'user-auth', subtype: 'success', result: 'done' }, out);
  assert.ok(fs.existsSync(out), '파일이 생성되어야 한다');
  fs.rmSync(path.dirname(path.dirname(dir)), { recursive: true });
});

// ---------------------------------------------------------------------------
// 에러 처리
// ---------------------------------------------------------------------------

console.log('\n[convert] 에러 처리');

test('result가 null이면 TypeError', () => {
  assert.throws(() => convert(null, path.join(os.tmpdir(), 'x.md')), TypeError);
});

test('result가 문자열이면 TypeError', () => {
  assert.throws(() => convert('not-object', path.join(os.tmpdir(), 'x.md')), TypeError);
});

test('outputPath가 빈 문자열이면 TypeError', () => {
  assert.throws(() => convert({ feature_id: 'f1', subtype: 'success' }, ''), TypeError);
});

test('outputPath가 숫자면 TypeError', () => {
  assert.throws(() => convert({ feature_id: 'f1', subtype: 'success' }, 42), TypeError);
});

// ---------------------------------------------------------------------------
// 실제 stream-json result 이벤트 객체 시뮬레이션
// ---------------------------------------------------------------------------

console.log('\n[convert] stream-json result 이벤트 시뮬레이션');

test('PoC-2 실측 result 이벤트 객체로 변환', () => {
  const out = tmpFile('poc2-result.md');
  // PoC-2에서 실측한 progress.json 기반 result 객체
  const resultEvent = {
    feature_id: 'poc-2-test',
    subtype: 'success',
    model: null,
    total_cost_usd: 0.05184225,
    started_at: '2026-04-24T04:45:03.015Z',
    updated_at: '2026-04-24T04:45:13.920Z',
    result: '안녕!',
  };
  convert(resultEvent, out);
  const { data, content } = readResult(out);
  assert.strictEqual(data.feature_id, 'poc-2-test');
  assert.strictEqual(data.status, 'completed');
  assert.strictEqual(data.cost_usd, 0.05184225);
  assert.strictEqual(data.duration_ms, 10905);
  assert.strictEqual(data.created_at, '2026-04-24T04:45:13.920Z');
  assert.strictEqual(content, '안녕!');
  fs.unlinkSync(out);
});

// ---------------------------------------------------------------------------
// 결과
// ---------------------------------------------------------------------------

console.log(`\n결과: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
