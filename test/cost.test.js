#!/usr/bin/env node
/**
 * test/cost.test.js
 *
 * scripts/cost.js 단위 테스트.
 * Node.js 내장 assert + fs + os만 사용 (외부 패키지 없음).
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const {
  readFeatureCost,
  collectAllFeatureCosts,
  formatTable,
  formatSingle,
  costCommand,
} = require('../scripts/cost');

// ---------------------------------------------------------------------------
// 테스트 헬퍼
// ---------------------------------------------------------------------------

let tmpDirs = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'built-cost-test-'));
  tmpDirs.push(dir);
  return dir;
}

function cleanup() {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  tmpDirs = [];
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function makeProgressFile(root, feature, progressData) {
  const featureDir = path.join(root, '.built', 'features', feature);
  fs.mkdirSync(featureDir, { recursive: true });
  if (progressData) {
    writeJson(path.join(featureDir, 'progress.json'), progressData);
  }
  return featureDir;
}

function makeRegistry(root, features) {
  const runtimeDir = path.join(root, '.built', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  writeJson(path.join(runtimeDir, 'registry.json'), { version: 1, features });
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
// readFeatureCost 테스트
// ---------------------------------------------------------------------------

test('readFeatureCost: progress.json 정상 읽기', () => {
  const root = makeTmpDir();
  makeProgressFile(root, 'auth', {
    feature: 'auth',
    cost_usd: 0.1234,
    phase: 'report',
    input_tokens: 10000,
    output_tokens: 2000,
    updated_at: '2026-04-25T10:00:00.000Z',
  });

  const result = readFeatureCost(root, 'auth');
  assert.ok(result !== null, 'result should not be null');
  assert.strictEqual(result.feature, 'auth');
  assert.strictEqual(result.cost_usd, 0.1234);
  assert.strictEqual(result.phase, 'report');
  assert.strictEqual(result.input_tokens, 10000);
  assert.strictEqual(result.output_tokens, 2000);
  assert.strictEqual(result.updated_at, '2026-04-25T10:00:00.000Z');
});

test('readFeatureCost: progress.json 없으면 null 반환', () => {
  const root = makeTmpDir();
  const result = readFeatureCost(root, 'nonexistent');
  assert.strictEqual(result, null);
});

test('readFeatureCost: cost_usd 없으면 0으로 기본값', () => {
  const root = makeTmpDir();
  makeProgressFile(root, 'feat', { phase: 'do', input_tokens: 500 });

  const result = readFeatureCost(root, 'feat');
  assert.ok(result !== null);
  assert.strictEqual(result.cost_usd, 0);
  assert.strictEqual(result.input_tokens, 500);
  assert.strictEqual(result.output_tokens, 0);
});

test('readFeatureCost: 깨진 JSON이면 null 반환', () => {
  const root = makeTmpDir();
  const featureDir = path.join(root, '.built', 'features', 'broken');
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(path.join(featureDir, 'progress.json'), '{ invalid json', 'utf8');

  const result = readFeatureCost(root, 'broken');
  assert.strictEqual(result, null);
});

test('readFeatureCost: phase가 없으면 null로 반환', () => {
  const root = makeTmpDir();
  makeProgressFile(root, 'nophase', { cost_usd: 0.05 });
  const result = readFeatureCost(root, 'nophase');
  assert.ok(result !== null);
  assert.strictEqual(result.phase, null);
});

// ---------------------------------------------------------------------------
// collectAllFeatureCosts 테스트
// ---------------------------------------------------------------------------

test('collectAllFeatureCosts: registry 기반 수집', () => {
  const root = makeTmpDir();
  makeProgressFile(root, 'feat-a', { cost_usd: 0.1, phase: 'do', input_tokens: 100, output_tokens: 20 });
  makeProgressFile(root, 'feat-b', { cost_usd: 0.2, phase: 'check', input_tokens: 200, output_tokens: 40 });
  makeRegistry(root, { 'feat-a': {}, 'feat-b': {} });

  const costs = collectAllFeatureCosts(root);
  assert.strictEqual(costs.length, 2);
  const names = costs.map((c) => c.feature).sort();
  assert.deepStrictEqual(names, ['feat-a', 'feat-b']);
});

test('collectAllFeatureCosts: registry 없으면 디렉토리 탐색 폴백', () => {
  const root = makeTmpDir();
  makeProgressFile(root, 'feat-x', { cost_usd: 0.3, phase: 'iter', input_tokens: 300, output_tokens: 60 });
  // registry 없음

  const costs = collectAllFeatureCosts(root);
  assert.strictEqual(costs.length, 1);
  assert.strictEqual(costs[0].feature, 'feat-x');
});

test('collectAllFeatureCosts: .built/features 없으면 빈 배열', () => {
  const root = makeTmpDir();
  const costs = collectAllFeatureCosts(root);
  assert.deepStrictEqual(costs, []);
});

test('collectAllFeatureCosts: progress.json 없는 feature는 제외', () => {
  const root = makeTmpDir();
  makeProgressFile(root, 'with-progress', { cost_usd: 0.5, phase: 'report', input_tokens: 500, output_tokens: 100 });
  // without-progress: 디렉토리만 생성, progress.json 없음
  fs.mkdirSync(path.join(root, '.built', 'features', 'without-progress'), { recursive: true });

  const costs = collectAllFeatureCosts(root);
  assert.strictEqual(costs.length, 1);
  assert.strictEqual(costs[0].feature, 'with-progress');
});

// ---------------------------------------------------------------------------
// formatTable 테스트
// ---------------------------------------------------------------------------

test('formatTable: 빈 배열이면 no data 메시지', () => {
  const result = formatTable([]);
  assert.ok(result.includes('No feature cost data found'));
});

test('formatTable: 헤더 및 feature 행 포함', () => {
  const costs = [
    { feature: 'auth', cost_usd: 0.1234, phase: 'do', input_tokens: 1000, output_tokens: 200 },
    { feature: 'payment', cost_usd: 0.5678, phase: 'check', input_tokens: 2000, output_tokens: 400 },
  ];
  const result = formatTable(costs);
  assert.ok(result.includes('auth'),    'auth 행 포함');
  assert.ok(result.includes('payment'), 'payment 행 포함');
  assert.ok(result.includes('TOTAL'),   'TOTAL 행 포함');
  assert.ok(result.includes('$0.1234'), 'auth 비용 포함');
  assert.ok(result.includes('$0.5678'), 'payment 비용 포함');
});

test('formatTable: TOTAL 합계가 정확', () => {
  const costs = [
    { feature: 'a', cost_usd: 0.1, phase: 'do', input_tokens: 100, output_tokens: 10 },
    { feature: 'b', cost_usd: 0.2, phase: 'do', input_tokens: 200, output_tokens: 20 },
  ];
  const result = formatTable(costs);
  // 0.1 + 0.2 = 0.3000
  assert.ok(result.includes('$0.3000'), `TOTAL이 $0.3000이어야 함, 실제: ${result}`);
});

// ---------------------------------------------------------------------------
// formatSingle 테스트
// ---------------------------------------------------------------------------

test('formatSingle: 모든 필드 포함', () => {
  const costInfo = {
    feature: 'user-auth',
    cost_usd: 0.2341,
    phase: 'report',
    input_tokens: 45230,
    output_tokens: 8120,
    updated_at: '2026-04-25T10:00:00.000Z',
  };
  const result = formatSingle(costInfo);
  assert.ok(result.includes('user-auth'));
  assert.ok(result.includes('$0.2341'));
  assert.ok(result.includes('report'));
  assert.ok(result.includes('45230'));
  assert.ok(result.includes('8120'));
  assert.ok(result.includes('53350')); // total_tokens
  assert.ok(result.includes('2026-04-25T10:00:00.000Z'));
});

test('formatSingle: updated_at 없으면 - 출력', () => {
  const costInfo = {
    feature: 'feat',
    cost_usd: 0,
    phase: null,
    input_tokens: 0,
    output_tokens: 0,
    updated_at: null,
  };
  const result = formatSingle(costInfo);
  assert.ok(result.includes('updated_at:    -'));
});

// ---------------------------------------------------------------------------
// costCommand 테스트
// ---------------------------------------------------------------------------

test('costCommand: --feature 지정, 텍스트 출력', () => {
  const root = makeTmpDir();
  makeProgressFile(root, 'myfeature', {
    cost_usd: 0.42,
    phase: 'iter',
    input_tokens: 5000,
    output_tokens: 1000,
    updated_at: '2026-04-25T00:00:00.000Z',
  });

  const { output, ok, data } = costCommand(root, { feature: 'myfeature' });
  assert.strictEqual(ok, true);
  assert.ok(output.includes('myfeature'));
  assert.ok(output.includes('$0.4200'));
  assert.ok(output.includes('iter'));
  assert.strictEqual(data.cost_usd, 0.42);
});

test('costCommand: --feature 지정, --format json 출력', () => {
  const root = makeTmpDir();
  makeProgressFile(root, 'jsonfeature', {
    cost_usd: 0.1,
    phase: 'do',
    input_tokens: 100,
    output_tokens: 20,
    updated_at: null,
  });

  const { output, ok } = costCommand(root, { feature: 'jsonfeature', format: 'json' });
  assert.strictEqual(ok, true);
  const parsed = JSON.parse(output);
  assert.strictEqual(parsed.feature, 'jsonfeature');
  assert.strictEqual(parsed.cost_usd, 0.1);
});

test('costCommand: --feature 없는 feature — ok: false', () => {
  const root = makeTmpDir();
  const { output, ok } = costCommand(root, { feature: 'ghost' });
  assert.strictEqual(ok, false);
  assert.ok(output.includes('No cost data found'));
});

test('costCommand: --feature 없는 feature, --format json — error JSON', () => {
  const root = makeTmpDir();
  const { output, ok } = costCommand(root, { feature: 'ghost', format: 'json' });
  assert.strictEqual(ok, false);
  const parsed = JSON.parse(output);
  assert.ok(typeof parsed.error === 'string');
});

test('costCommand: --all, 텍스트 테이블 출력', () => {
  const root = makeTmpDir();
  makeProgressFile(root, 'feat1', { cost_usd: 0.1, phase: 'do', input_tokens: 100, output_tokens: 20 });
  makeProgressFile(root, 'feat2', { cost_usd: 0.2, phase: 'check', input_tokens: 200, output_tokens: 40 });

  const { output, ok, data } = costCommand(root, { all: true });
  assert.strictEqual(ok, true);
  assert.ok(output.includes('TOTAL'));
  assert.ok(output.includes('$0.3000'));
  assert.strictEqual(data.features.length, 2);
  assert.ok(Math.abs(data.total_cost_usd - 0.3) < 0.0001);
});

test('costCommand: --all --format json', () => {
  const root = makeTmpDir();
  makeProgressFile(root, 'alpha', { cost_usd: 0.5, phase: 'report', input_tokens: 500, output_tokens: 100 });

  const { output, ok } = costCommand(root, { all: true, format: 'json' });
  assert.strictEqual(ok, true);
  const parsed = JSON.parse(output);
  assert.ok(Array.isArray(parsed.features));
  assert.strictEqual(parsed.features.length, 1);
  assert.strictEqual(parsed.features[0].feature, 'alpha');
  assert.ok(typeof parsed.total_cost_usd === 'number');
  assert.ok(typeof parsed.total_tokens === 'number');
});

test('costCommand: --all, feature 없으면 ok: true + 빈 데이터', () => {
  const root = makeTmpDir();
  const { output, ok, data } = costCommand(root, { all: true });
  assert.strictEqual(ok, true);
  assert.ok(output.includes('No feature cost data found') || data.features.length === 0);
});

test('costCommand: 인자 없으면 ok: false + usage 출력', () => {
  const root = makeTmpDir();
  const { output, ok } = costCommand(root, {});
  assert.strictEqual(ok, false);
  assert.ok(output.includes('Usage'));
});

test('costCommand: --all과 registry 기반 수집 통합', () => {
  const root = makeTmpDir();
  makeProgressFile(root, 'reg-a', { cost_usd: 0.11, phase: 'do', input_tokens: 110, output_tokens: 22 });
  makeProgressFile(root, 'reg-b', { cost_usd: 0.22, phase: 'iter', input_tokens: 220, output_tokens: 44 });
  makeRegistry(root, { 'reg-a': {}, 'reg-b': {} });

  const { ok, data } = costCommand(root, { all: true });
  assert.strictEqual(ok, true);
  assert.strictEqual(data.features.length, 2);
  assert.ok(Math.abs(data.total_cost_usd - 0.33) < 0.0001);
});

// ---------------------------------------------------------------------------
// 결과
// ---------------------------------------------------------------------------

cleanup();
console.log(`\n총 ${passed + failed}개 중 ${passed}개 통과, ${failed}개 실패\n`);
if (failed > 0) process.exit(1);
