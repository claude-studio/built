#!/usr/bin/env node
/**
 * test/providers-config.test.js
 *
 * src/providers/config.js 단위 테스트.
 * 외부 npm 패키지 없음. Node.js assert만 사용.
 *
 * 검증 항목:
 *   - parseProviderConfig: null/undefined, 빈 설정, 단축형, 상세형, 잘못된 provider,
 *     잘못된 sandbox, do/iter + read-only sandbox 오류, fallback
 *   - getProviderForPhase: 설정 있음, 설정 없음(기본값), 알 수 없는 phase
 */

'use strict';

const assert = require('assert');
const { parseProviderConfig, getProviderForPhase } = require('../src/providers/config');

// ---------------------------------------------------------------------------
// 테스트 러너
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// parseProviderConfig
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n[parseProviderConfig — 기본값 / 빈 설정]');

  await test('null → 빈 맵 반환', async () => {
    const result = parseProviderConfig(null);
    assert.deepStrictEqual(result, {});
  });

  await test('undefined → 빈 맵 반환', async () => {
    const result = parseProviderConfig(undefined);
    assert.deepStrictEqual(result, {});
  });

  await test('providers 필드 없음 → 빈 맵 반환', async () => {
    const result = parseProviderConfig({ model: 'claude-opus-4-5' });
    assert.deepStrictEqual(result, {});
  });

  await test('providers 빈 객체 → 빈 맵 반환', async () => {
    const result = parseProviderConfig({ providers: {} });
    assert.deepStrictEqual(result, {});
  });

  // -------------------------------------------------------------------------
  console.log('\n[parseProviderConfig — 단축형]');

  await test('단축형 "claude" → { name: "claude" }', async () => {
    const result = parseProviderConfig({ providers: { do: 'claude' } });
    assert.deepStrictEqual(result.do, { name: 'claude' });
  });

  await test('단축형 "codex" → { name: "codex" }', async () => {
    const result = parseProviderConfig({ providers: { check: 'codex' } });
    assert.deepStrictEqual(result.check, { name: 'codex' });
  });

  await test('여러 phase 단축형 — do/check/iter/report 각각 설정', async () => {
    const result = parseProviderConfig({
      providers: {
        do:     'codex',
        check:  'claude',
        iter:   'codex',
        report: 'claude',
      },
    });
    assert.strictEqual(result.do.name,     'codex');
    assert.strictEqual(result.check.name,  'claude');
    assert.strictEqual(result.iter.name,   'codex');
    assert.strictEqual(result.report.name, 'claude');
  });

  // -------------------------------------------------------------------------
  console.log('\n[parseProviderConfig — 상세형]');

  await test('상세형 — name 필드만', async () => {
    const result = parseProviderConfig({ providers: { do: { name: 'claude' } } });
    assert.deepStrictEqual(result.do, { name: 'claude' });
  });

  await test('상세형 — name + model + timeout_ms + retry fields', async () => {
    const result = parseProviderConfig({
      providers: {
        do: {
          name: 'codex',
          model: 'gpt-5.5',
          timeout_ms: 1800000,
          max_retries: 1,
          retry_delay_ms: 25,
          sandbox: 'workspace-write',
        },
      },
    });
    assert.deepStrictEqual(result.do, {
      name: 'codex',
      model: 'gpt-5.5',
      timeout_ms: 1800000,
      max_retries: 1,
      retry_delay_ms: 25,
      sandbox: 'workspace-write',
    });
  });

  await test('상세형 — effort 필드 포함', async () => {
    const result = parseProviderConfig({
      providers: { do: { name: 'codex', sandbox: 'workspace-write', effort: 'high' } },
    });
    assert.strictEqual(result.do.effort, 'high');
  });

  await test('상세형 — output_mode 필드 포함', async () => {
    const result = parseProviderConfig({
      providers: { check: { name: 'claude', output_mode: 'json' } },
    });
    assert.strictEqual(result.check.output_mode, 'json');
  });

  await test('상세형 — plan_synthesis phase', async () => {
    const result = parseProviderConfig({
      providers: {
        plan_synthesis: { name: 'codex', model: 'gpt-5.5', effort: 'high', sandbox: 'read-only', timeout_ms: 900000 },
      },
    });
    assert.deepStrictEqual(result.plan_synthesis, {
      name: 'codex',
      model: 'gpt-5.5',
      effort: 'high',
      sandbox: 'read-only',
      timeout_ms: 900000,
    });
  });

  // -------------------------------------------------------------------------
  console.log('\n[parseProviderConfig — fallback / 기존 동작 유지]');

  await test('providers 없는 기존 요청 파일 — 빈 맵 반환 (기존 동작 유지)', async () => {
    const legacyConfig = { prompt: 'some prompt', model: 'claude-opus-4-5' };
    const result = parseProviderConfig(legacyConfig);
    assert.deepStrictEqual(result, {});
  });

  // -------------------------------------------------------------------------
  console.log('\n[parseProviderConfig — 잘못된 provider 이름]');

  await test('잘못된 provider 이름 — 오류 발생', async () => {
    assert.throws(
      () => parseProviderConfig({ providers: { do: 'gpt-4' } }),
      (err) => err.message.includes('"gpt-4"') && err.message.includes('providers.do')
    );
  });

  await test('상세형 잘못된 provider 이름 — 오류 발생', async () => {
    assert.throws(
      () => parseProviderConfig({ providers: { check: { name: 'openai' } } }),
      (err) => err.message.includes('"openai"')
    );
  });

  await test('상세형 name 없음 — 오류 발생', async () => {
    assert.throws(
      () => parseProviderConfig({ providers: { do: { model: 'gpt-5.5' } } }),
      (err) => err.message.includes('"name"')
    );
  });

  await test('배열 형식 provider 설정 — 오류 발생', async () => {
    assert.throws(
      () => parseProviderConfig({ providers: { do: ['claude'] } }),
      (err) => err.message.includes('형식')
    );
  });

  await test('숫자 형식 provider 설정 — 오류 발생', async () => {
    assert.throws(
      () => parseProviderConfig({ providers: { do: 42 } }),
      (err) => err.message.includes('형식')
    );
  });

  // -------------------------------------------------------------------------
  console.log('\n[parseProviderConfig — sandbox 정책]');

  await test('잘못된 sandbox 값 — 오류 발생', async () => {
    assert.throws(
      () => parseProviderConfig({ providers: { do: { name: 'codex', sandbox: 'full-access' } } }),
      (err) => err.message.includes('"full-access"') && err.message.includes('sandbox')
    );
  });

  await test('잘못된 timeout_ms 값 — 오류 발생', async () => {
    assert.throws(
      () => parseProviderConfig({ providers: { check: { name: 'codex', timeout_ms: 0 } } }),
      (err) => err.message.includes('timeout_ms')
    );
  });

  await test('잘못된 max_retries 값 — 오류 발생', async () => {
    assert.throws(
      () => parseProviderConfig({ providers: { check: { name: 'codex', max_retries: -1 } } }),
      (err) => err.message.includes('max_retries')
    );
  });

  await test('do + codex + read-only sandbox — 명확한 실패', async () => {
    assert.throws(
      () => parseProviderConfig({ providers: { do: { name: 'codex', sandbox: 'read-only' } } }),
      (err) =>
        err.message.includes('read-only') &&
        err.message.includes('do') &&
        err.message.includes('workspace-write')
    );
  });

  await test('iter + codex + read-only sandbox — 명확한 실패', async () => {
    assert.throws(
      () => parseProviderConfig({ providers: { iter: { name: 'codex', sandbox: 'read-only' } } }),
      (err) => err.message.includes('read-only') && err.message.includes('iter')
    );
  });

  await test('do + claude + sandbox 없음 — 허용 (claude는 sandbox 개념 없음)', async () => {
    const result = parseProviderConfig({ providers: { do: { name: 'claude' } } });
    assert.strictEqual(result.do.name, 'claude');
    assert.strictEqual(result.do.sandbox, undefined);
  });

  await test('check + codex + read-only sandbox — 허용 (check는 파일 변경 불필요)', async () => {
    const result = parseProviderConfig({
      providers: { check: { name: 'codex', sandbox: 'read-only' } },
    });
    assert.strictEqual(result.check.name, 'codex');
    assert.strictEqual(result.check.sandbox, 'read-only');
  });

  await test('report + codex + read-only sandbox — 허용', async () => {
    const result = parseProviderConfig({
      providers: { report: { name: 'codex', sandbox: 'read-only' } },
    });
    assert.strictEqual(result.report.sandbox, 'read-only');
  });

  await test('do + codex + workspace-write sandbox — 허용', async () => {
    const result = parseProviderConfig({
      providers: { do: { name: 'codex', sandbox: 'workspace-write' } },
    });
    assert.strictEqual(result.do.name, 'codex');
    assert.strictEqual(result.do.sandbox, 'workspace-write');
  });

  // -------------------------------------------------------------------------
  console.log('\n[parseProviderConfig — providers 필드 형식 오류]');

  await test('providers가 배열 — 오류 발생', async () => {
    assert.throws(
      () => parseProviderConfig({ providers: ['claude'] }),
      (err) => err.message.includes('"providers"')
    );
  });

  await test('providers가 문자열 — 오류 발생', async () => {
    assert.throws(
      () => parseProviderConfig({ providers: 'claude' }),
      (err) => err.message.includes('"providers"')
    );
  });

  // -------------------------------------------------------------------------
  console.log('\n[getProviderForPhase — 기본값 / fallback]');

  await test('설정 없는 phase → { name: "claude" } 반환', async () => {
    const config = parseProviderConfig({ providers: { check: 'codex' } });
    const spec = getProviderForPhase(config, 'do');
    assert.deepStrictEqual(spec, { name: 'claude' });
  });

  await test('빈 config → 모든 phase에서 claude 반환', async () => {
    const config = parseProviderConfig(null);
    for (const phase of ['do', 'check', 'iter', 'report', 'plan_synthesis']) {
      const spec = getProviderForPhase(config, phase);
      assert.strictEqual(spec.name, 'claude', `${phase} should default to claude`);
    }
  });

  await test('설정된 phase → 해당 spec 반환', async () => {
    const config = parseProviderConfig({
      providers: { do: { name: 'codex', model: 'gpt-5.5', sandbox: 'workspace-write' } },
    });
    const spec = getProviderForPhase(config, 'do');
    assert.strictEqual(spec.name, 'codex');
    assert.strictEqual(spec.model, 'gpt-5.5');
  });

  await test('알 수 없는 phase → { name: "claude" } 반환', async () => {
    const config = parseProviderConfig({ providers: { do: 'codex' } });
    const spec = getProviderForPhase(config, 'unknown_phase');
    assert.deepStrictEqual(spec, { name: 'claude' });
  });

  await test('null config → { name: "claude" } 반환', async () => {
    const spec = getProviderForPhase(null, 'do');
    assert.deepStrictEqual(spec, { name: 'claude' });
  });

  // -------------------------------------------------------------------------
  // 결과 출력
  // -------------------------------------------------------------------------

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
