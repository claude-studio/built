#!/usr/bin/env node
/**
 * test/usage-telemetry-optional.test.js
 *
 * usage telemetry optional 정책 검증.
 * docs/contracts/usage-telemetry-optional-policy.md 기준.
 *
 * 검증 항목:
 *   1. usage 이벤트 없는 provider — progress.json cost_usd/tokens가 null
 *   2. usage 이벤트 있는 provider — progress.json cost_usd/tokens가 number
 *   3. provider/model/duration_ms는 항상 기록됨
 *   4. formatStatus — cost 없으면 cost 줄 생략, provider/model/duration 표시
 *   5. formatStatus — cost 있으면 cost 줄 포함
 *   6. do-result.md — cost_usd null도 유효 (테스트/report 통과)
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const { createStandardWriter } = require('../src/providers/standard-writer');
const { formatStatus }         = require('../scripts/status');
const { parse }                = require('../src/frontmatter');

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

let tmpDirs = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'built-telemetry-test-'));
  tmpDirs.push(dir);
  return dir;
}

function cleanup() {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  tmpDirs = [];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ---------------------------------------------------------------------------
// 테스트 러너
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// 1. usage 이벤트 없는 provider
// ---------------------------------------------------------------------------

test('usage 없는 provider — progress.json cost_usd/tokens가 null', () => {
  const dir = makeTmpDir();
  const resultPath = path.join(dir, 'do-result.md');

  const writer = createStandardWriter({
    runtimeRoot: dir,
    phase: 'do',
    featureId: 'feat-no-usage',
    resultOutputPath: resultPath,
  });

  writer.handleEvent({ type: 'phase_start', provider: 'fake-no-usage', model: 'no-usage-model', timestamp: new Date().toISOString() });
  writer.handleEvent({ type: 'text_delta',  text: '작업 중', timestamp: new Date().toISOString() });
  writer.handleEvent({ type: 'phase_end',   status: 'completed', duration_ms: 5000, result: '완료', timestamp: new Date().toISOString() });

  const progress = readJson(path.join(dir, 'progress.json'));

  assert.strictEqual(progress.cost_usd,      null, 'cost_usd는 null');
  assert.strictEqual(progress.input_tokens,  null, 'input_tokens는 null');
  assert.strictEqual(progress.output_tokens, null, 'output_tokens는 null');
});

// ---------------------------------------------------------------------------
// 2. usage 이벤트 있는 provider
// ---------------------------------------------------------------------------

test('usage 있는 provider — progress.json cost_usd/tokens가 number', () => {
  const dir = makeTmpDir();

  const writer = createStandardWriter({ runtimeRoot: dir, phase: 'do', featureId: 'feat-with-usage' });

  writer.handleEvent({ type: 'phase_start', provider: 'claude', model: 'claude-opus-4-5', timestamp: new Date().toISOString() });
  writer.handleEvent({ type: 'usage', input_tokens: 100, output_tokens: 50, cost_usd: 0.0042, timestamp: new Date().toISOString() });
  writer.handleEvent({ type: 'phase_end', status: 'completed', duration_ms: 3000, result: '', timestamp: new Date().toISOString() });

  const progress = readJson(path.join(dir, 'progress.json'));

  assert.strictEqual(typeof progress.cost_usd,      'number', 'cost_usd는 number');
  assert.strictEqual(typeof progress.input_tokens,  'number', 'input_tokens는 number');
  assert.strictEqual(typeof progress.output_tokens, 'number', 'output_tokens는 number');
  assert.strictEqual(progress.cost_usd,      0.0042, 'cost_usd 값');
  assert.strictEqual(progress.input_tokens,  100,    'input_tokens 값');
  assert.strictEqual(progress.output_tokens, 50,     'output_tokens 값');
});

// ---------------------------------------------------------------------------
// 3. provider/model/duration_ms 항상 기록
// ---------------------------------------------------------------------------

test('provider/model/duration_ms는 항상 progress.json에 기록됨', () => {
  const dir = makeTmpDir();

  const writer = createStandardWriter({ runtimeRoot: dir, phase: 'do', featureId: 'feat-meta' });
  writer.handleEvent({ type: 'phase_start', provider: 'codex', model: 'gpt-5.5', timestamp: new Date().toISOString() });
  writer.handleEvent({ type: 'phase_end',   status: 'completed', duration_ms: 12000, result: '', timestamp: new Date().toISOString() });

  const progress = readJson(path.join(dir, 'progress.json'));

  assert.strictEqual(progress.provider,    'codex',  'provider 기록');
  assert.strictEqual(progress.model,       'gpt-5.5', 'model 기록');
  assert.strictEqual(progress.duration_ms, 12000,    'duration_ms 기록');
});

// ---------------------------------------------------------------------------
// 4. formatStatus — cost 없으면 cost 줄 생략
// ---------------------------------------------------------------------------

test('formatStatus — cost_usd null이면 cost 줄 생략, provider/model/duration 표시', () => {
  const state = {
    phase:     'do',
    status:    'completed',
    pid:       1234,
    heartbeat: new Date().toISOString(),
    attempt:   1,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const progress = {
    provider:    'codex',
    model:       'gpt-5.5',
    duration_ms: 12000,
    cost_usd:    null,
    input_tokens: null,
    output_tokens: null,
  };

  const output = formatStatus('user-auth', state, progress);

  assert.ok(output.includes('provider:    codex'),  'provider 표시');
  assert.ok(output.includes('model:       gpt-5.5'), 'model 표시');
  assert.ok(output.includes('duration:    12000ms'), 'duration 표시');
  assert.ok(!output.includes('cost:'),               'cost 줄 없음');
});

// ---------------------------------------------------------------------------
// 5. formatStatus — cost 있으면 cost 줄 포함
// ---------------------------------------------------------------------------

test('formatStatus — cost_usd > 0이면 cost 줄 포함', () => {
  const state = {
    phase:     'do',
    status:    'completed',
    pid:       1234,
    heartbeat: new Date().toISOString(),
    attempt:   1,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const progress = {
    provider:     'claude',
    model:        'claude-opus-4-5',
    duration_ms:  5000,
    cost_usd:     0.0042,
    input_tokens: 100,
    output_tokens: 50,
  };

  const output = formatStatus('user-auth', state, progress);

  assert.ok(output.includes('provider:    claude'),        'provider 표시');
  assert.ok(output.includes('model:       claude-opus-4-5'), 'model 표시');
  assert.ok(output.includes('cost:        $0.0042'),       'cost 표시');
});

// ---------------------------------------------------------------------------
// 6. do-result.md — cost_usd null도 유효
// ---------------------------------------------------------------------------

test('do-result.md — usage 없는 provider도 파일 생성 성공, status=completed', () => {
  const dir = makeTmpDir();
  const resultPath = path.join(dir, 'do-result.md');

  const writer = createStandardWriter({
    runtimeRoot: dir,
    phase: 'do',
    featureId: 'feat-no-usage-result',
    resultOutputPath: resultPath,
  });

  writer.handleEvent({ type: 'phase_start', provider: 'fake-no-usage', model: 'no-model', timestamp: new Date().toISOString() });
  writer.handleEvent({ type: 'phase_end',   status: 'completed', duration_ms: 1000, result: '# 완료', timestamp: new Date().toISOString() });

  assert.ok(fs.existsSync(resultPath), 'do-result.md 생성됨');

  const { data } = parse(fs.readFileSync(resultPath, 'utf8'));
  assert.strictEqual(data.status, 'completed', 'status=completed');
  assert.strictEqual(data.model, 'no-model',   'model 기록');
  // cost_usd는 null이어도 frontmatter에 포함됨
  assert.ok('cost_usd' in data, 'cost_usd 필드 존재 (null 포함)');
});

// ---------------------------------------------------------------------------
// 결과
// ---------------------------------------------------------------------------

cleanup();
console.log(`\n총 ${passed + failed}개 중 ${passed}개 통과, ${failed}개 실패\n`);
if (failed > 0) process.exit(1);
