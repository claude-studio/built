#!/usr/bin/env node
/**
 * test/providers-capabilities.test.js
 *
 * src/providers/capabilities.js 단위 테스트.
 * 외부 npm 패키지 없음. Node.js assert만 사용.
 *
 * 검증 항목:
 *   - Claude/Codex capability 정의 (phase 지원, requiresAppServer, supportsOutputSchema, defaultTimeoutMs, sandbox)
 *   - getCapability: 알려진 provider 반환, 알 수 없는 provider 오류
 *   - isPhaseSupported: 지원/미지원 phase
 *   - requiresWrite: do/iter → true, check/report/plan_synthesis → false
 *   - getDefaultSandbox: provider+phase 조합별 기본값
 *   - validateSandbox: Codex check/report/read-only 허용, Codex do/iter/workspace-write 정책 고정
 */

'use strict';

const assert = require('assert');
const {
  PROVIDER_CAPABILITIES,
  SUPPORTED_PHASES,
  WRITE_REQUIRED_PHASES,
  READ_ONLY_PHASES,
  getCapability,
  isPhaseSupported,
  requiresWrite,
  getDefaultSandbox,
  validateSandbox,
} = require('../src/providers/capabilities');

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
// 테스트
// ---------------------------------------------------------------------------

async function main() {

  // -------------------------------------------------------------------------
  // PROVIDER_CAPABILITIES 구조 검증
  // -------------------------------------------------------------------------

  console.log('\n[PROVIDER_CAPABILITIES — 구조 검증]');

  await test('claude와 codex 두 provider가 등록되어 있음', async () => {
    assert.ok('claude' in PROVIDER_CAPABILITIES, 'claude가 없음');
    assert.ok('codex'  in PROVIDER_CAPABILITIES, 'codex가 없음');
  });

  await test('SUPPORTED_PHASES는 5개 phase를 포함함', async () => {
    const expected = ['plan_synthesis', 'do', 'check', 'iter', 'report'];
    assert.deepStrictEqual(SUPPORTED_PHASES, expected);
  });

  await test('WRITE_REQUIRED_PHASES는 do와 iter를 포함함', async () => {
    assert.ok(WRITE_REQUIRED_PHASES.has('do'),   'do가 없음');
    assert.ok(WRITE_REQUIRED_PHASES.has('iter'),  'iter가 없음');
    assert.strictEqual(WRITE_REQUIRED_PHASES.size, 2);
  });

  await test('READ_ONLY_PHASES는 plan_synthesis/check/report를 포함함', async () => {
    assert.ok(READ_ONLY_PHASES.has('plan_synthesis'), 'plan_synthesis가 없음');
    assert.ok(READ_ONLY_PHASES.has('check'),          'check가 없음');
    assert.ok(READ_ONLY_PHASES.has('report'),         'report가 없음');
    assert.strictEqual(READ_ONLY_PHASES.size, 3);
  });

  // -------------------------------------------------------------------------
  // Claude capability
  // -------------------------------------------------------------------------

  console.log('\n[Claude capability]');

  await test('claude: 모든 5개 phase 지원', async () => {
    const cap = PROVIDER_CAPABILITIES.claude;
    for (const phase of SUPPORTED_PHASES) {
      assert.ok(cap.supportedPhases.has(phase), `claude가 ${phase}를 지원하지 않음`);
    }
  });

  await test('claude: requiresAppServer = false', async () => {
    assert.strictEqual(PROVIDER_CAPABILITIES.claude.requiresAppServer, false);
  });

  await test('claude: supportsOutputSchema = true', async () => {
    assert.strictEqual(PROVIDER_CAPABILITIES.claude.supportsOutputSchema, true);
  });

  await test('claude: defaultTimeoutMs = 30분 (1800000ms)', async () => {
    assert.strictEqual(PROVIDER_CAPABILITIES.claude.defaultTimeoutMs, 30 * 60 * 1000);
  });

  await test('claude: defaultSandbox = null (sandbox 개념 없음)', async () => {
    assert.strictEqual(PROVIDER_CAPABILITIES.claude.defaultSandbox, null);
  });

  await test('claude: writeRequiredSandbox = null', async () => {
    assert.strictEqual(PROVIDER_CAPABILITIES.claude.writeRequiredSandbox, null);
  });

  // -------------------------------------------------------------------------
  // Codex capability
  // -------------------------------------------------------------------------

  console.log('\n[Codex capability]');

  await test('codex: 모든 5개 phase 지원', async () => {
    const cap = PROVIDER_CAPABILITIES.codex;
    for (const phase of SUPPORTED_PHASES) {
      assert.ok(cap.supportedPhases.has(phase), `codex가 ${phase}를 지원하지 않음`);
    }
  });

  await test('codex: requiresAppServer = true', async () => {
    assert.strictEqual(PROVIDER_CAPABILITIES.codex.requiresAppServer, true);
  });

  await test('codex: supportsOutputSchema = true', async () => {
    assert.strictEqual(PROVIDER_CAPABILITIES.codex.supportsOutputSchema, true);
  });

  await test('codex: defaultTimeoutMs = 30분 (1800000ms)', async () => {
    assert.strictEqual(PROVIDER_CAPABILITIES.codex.defaultTimeoutMs, 30 * 60 * 1000);
  });

  await test('codex: defaultSandbox = "read-only"', async () => {
    assert.strictEqual(PROVIDER_CAPABILITIES.codex.defaultSandbox, 'read-only');
  });

  await test('codex: writeRequiredSandbox = "workspace-write"', async () => {
    assert.strictEqual(PROVIDER_CAPABILITIES.codex.writeRequiredSandbox, 'workspace-write');
  });

  // -------------------------------------------------------------------------
  // getCapability
  // -------------------------------------------------------------------------

  console.log('\n[getCapability]');

  await test('getCapability("claude") → claude capability 반환', async () => {
    const cap = getCapability('claude');
    assert.ok(cap.supportedPhases instanceof Set);
    assert.strictEqual(cap.requiresAppServer, false);
  });

  await test('getCapability("codex") → codex capability 반환', async () => {
    const cap = getCapability('codex');
    assert.ok(cap.supportedPhases instanceof Set);
    assert.strictEqual(cap.requiresAppServer, true);
  });

  await test('getCapability("unknown") → 오류 발생', async () => {
    assert.throws(
      () => getCapability('unknown'),
      (e) => e.message.includes('"unknown"') && e.message.includes('capabilities.js')
    );
  });

  await test('getCapability("openai") → 한글 오류 메시지 포함', async () => {
    assert.throws(
      () => getCapability('openai'),
      (e) => e.message.includes('알 수 없는 provider')
    );
  });

  // -------------------------------------------------------------------------
  // isPhaseSupported
  // -------------------------------------------------------------------------

  console.log('\n[isPhaseSupported]');

  await test('claude + do → true', async () => {
    assert.strictEqual(isPhaseSupported('claude', 'do'), true);
  });

  await test('claude + check → true', async () => {
    assert.strictEqual(isPhaseSupported('claude', 'check'), true);
  });

  await test('claude + plan_synthesis → true', async () => {
    assert.strictEqual(isPhaseSupported('claude', 'plan_synthesis'), true);
  });

  await test('codex + iter → true', async () => {
    assert.strictEqual(isPhaseSupported('codex', 'iter'), true);
  });

  await test('codex + report → true', async () => {
    assert.strictEqual(isPhaseSupported('codex', 'report'), true);
  });

  await test('unknown_provider + do → false (오류 없이 false 반환)', async () => {
    assert.strictEqual(isPhaseSupported('unknown_provider', 'do'), false);
  });

  await test('claude + unknown_phase → false', async () => {
    assert.strictEqual(isPhaseSupported('claude', 'unknown_phase'), false);
  });

  // -------------------------------------------------------------------------
  // requiresWrite
  // -------------------------------------------------------------------------

  console.log('\n[requiresWrite — do/iter write 정책 고정]');

  await test('do → write 필요 (true)', async () => {
    assert.strictEqual(requiresWrite('do'), true);
  });

  await test('iter → write 필요 (true)', async () => {
    assert.strictEqual(requiresWrite('iter'), true);
  });

  await test('check → write 불필요 (false)', async () => {
    assert.strictEqual(requiresWrite('check'), false);
  });

  await test('report → write 불필요 (false)', async () => {
    assert.strictEqual(requiresWrite('report'), false);
  });

  await test('plan_synthesis → write 불필요 (false)', async () => {
    assert.strictEqual(requiresWrite('plan_synthesis'), false);
  });

  await test('알 수 없는 phase → write 불필요 (false)', async () => {
    assert.strictEqual(requiresWrite('unknown_phase'), false);
  });

  // -------------------------------------------------------------------------
  // getDefaultSandbox
  // -------------------------------------------------------------------------

  console.log('\n[getDefaultSandbox]');

  await test('claude + do → null (sandbox 개념 없음)', async () => {
    assert.strictEqual(getDefaultSandbox('claude', 'do'), null);
  });

  await test('claude + check → null', async () => {
    assert.strictEqual(getDefaultSandbox('claude', 'check'), null);
  });

  await test('codex + do → "workspace-write" (write 필요 phase)', async () => {
    assert.strictEqual(getDefaultSandbox('codex', 'do'), 'workspace-write');
  });

  await test('codex + iter → "workspace-write"', async () => {
    assert.strictEqual(getDefaultSandbox('codex', 'iter'), 'workspace-write');
  });

  await test('codex + check → "read-only"', async () => {
    assert.strictEqual(getDefaultSandbox('codex', 'check'), 'read-only');
  });

  await test('codex + report → "read-only"', async () => {
    assert.strictEqual(getDefaultSandbox('codex', 'report'), 'read-only');
  });

  await test('codex + plan_synthesis → "read-only"', async () => {
    assert.strictEqual(getDefaultSandbox('codex', 'plan_synthesis'), 'read-only');
  });

  // -------------------------------------------------------------------------
  // validateSandbox — Codex check/report/read-only 허용 정책 고정
  // -------------------------------------------------------------------------

  console.log('\n[validateSandbox — Codex check/report/read-only 정책 고정]');

  await test('codex + check + read-only → null (허용)', async () => {
    assert.strictEqual(validateSandbox('codex', 'check', 'read-only'), null);
  });

  await test('codex + report + read-only → null (허용)', async () => {
    assert.strictEqual(validateSandbox('codex', 'report', 'read-only'), null);
  });

  await test('codex + plan_synthesis + read-only → null (허용)', async () => {
    assert.strictEqual(validateSandbox('codex', 'plan_synthesis', 'read-only'), null);
  });

  await test('codex + check + workspace-write → null (허용)', async () => {
    assert.strictEqual(validateSandbox('codex', 'check', 'workspace-write'), null);
  });

  // -------------------------------------------------------------------------
  // validateSandbox — Codex do/iter/workspace-write 정책 고정
  // -------------------------------------------------------------------------

  console.log('\n[validateSandbox — Codex do/iter/workspace-write 정책 고정]');

  await test('codex + do + workspace-write → null (허용)', async () => {
    assert.strictEqual(validateSandbox('codex', 'do', 'workspace-write'), null);
  });

  await test('codex + iter + workspace-write → null (허용)', async () => {
    assert.strictEqual(validateSandbox('codex', 'iter', 'workspace-write'), null);
  });

  await test('codex + do + read-only → 오류 문자열 반환', async () => {
    const err = validateSandbox('codex', 'do', 'read-only');
    assert.ok(typeof err === 'string', '오류 문자열이 반환되어야 함');
    assert.ok(err.includes('read-only'), `오류 메시지에 "read-only"가 없음: ${err}`);
    assert.ok(err.includes('do'),        `오류 메시지에 "do"가 없음: ${err}`);
    assert.ok(err.includes('workspace-write'), `오류 메시지에 "workspace-write"가 없음: ${err}`);
  });

  await test('codex + iter + read-only → 오류 문자열 반환', async () => {
    const err = validateSandbox('codex', 'iter', 'read-only');
    assert.ok(typeof err === 'string', '오류 문자열이 반환되어야 함');
    assert.ok(err.includes('iter'), `오류 메시지에 "iter"가 없음: ${err}`);
  });

  // -------------------------------------------------------------------------
  // validateSandbox — Claude sandbox 비적용 정책 고정
  // -------------------------------------------------------------------------

  console.log('\n[validateSandbox — Claude sandbox 미적용 정책 고정]');

  await test('claude + do + read-only → null (claude는 sandbox 검증 없음)', async () => {
    assert.strictEqual(validateSandbox('claude', 'do', 'read-only'), null);
  });

  await test('claude + iter + read-only → null', async () => {
    assert.strictEqual(validateSandbox('claude', 'iter', 'read-only'), null);
  });

  await test('claude + do + sandbox 없음 → null', async () => {
    assert.strictEqual(validateSandbox('claude', 'do', undefined), null);
  });

  // -------------------------------------------------------------------------
  // validateSandbox — 알 수 없는 provider
  // -------------------------------------------------------------------------

  console.log('\n[validateSandbox — 알 수 없는 provider]');

  await test('unknown + do + read-only → 오류 문자열 반환', async () => {
    const err = validateSandbox('unknown', 'do', 'read-only');
    assert.ok(typeof err === 'string', '오류 문자열이 반환되어야 함');
    assert.ok(err.includes('"unknown"'), `오류 메시지에 provider 이름이 없음: ${err}`);
  });

  // -------------------------------------------------------------------------
  // config.js와의 일관성 검증
  // -------------------------------------------------------------------------

  console.log('\n[config.js와 capabilities.js 일관성]');

  const { parseProviderConfig, VALID_PROVIDERS } = require('../src/providers/config');

  await test('config.js VALID_PROVIDERS가 PROVIDER_CAPABILITIES 키와 일치', async () => {
    const capKeys = new Set(Object.keys(PROVIDER_CAPABILITIES));
    assert.ok(VALID_PROVIDERS.has('claude'), 'config.js에 claude가 없음');
    assert.ok(VALID_PROVIDERS.has('codex'),  'config.js에 codex가 없음');
    assert.strictEqual(VALID_PROVIDERS.size, capKeys.size, 'provider 수가 다름');
  });

  await test('config.js: codex + do + read-only sandbox → capabilities와 동일한 이유로 오류', async () => {
    assert.throws(
      () => parseProviderConfig({ providers: { do: { name: 'codex', sandbox: 'read-only' } } }),
      (e) => e.message.includes('read-only') && e.message.includes('do')
    );
  });

  await test('config.js: codex + iter + read-only sandbox → 오류', async () => {
    assert.throws(
      () => parseProviderConfig({ providers: { iter: { name: 'codex', sandbox: 'read-only' } } }),
      (e) => e.message.includes('read-only') && e.message.includes('iter')
    );
  });

  await test('config.js: codex + check + read-only → 허용 (check는 write 불필요)', async () => {
    const cfg = parseProviderConfig({ providers: { check: { name: 'codex', sandbox: 'read-only' } } });
    assert.strictEqual(cfg.check.name, 'codex');
    assert.strictEqual(cfg.check.sandbox, 'read-only');
  });

  await test('config.js: codex + do + workspace-write → 허용', async () => {
    const cfg = parseProviderConfig({ providers: { do: { name: 'codex', sandbox: 'workspace-write' } } });
    assert.strictEqual(cfg.do.name, 'codex');
    assert.strictEqual(cfg.do.sandbox, 'workspace-write');
  });

  await test('config.js: claude + do + sandbox 없음 → 허용', async () => {
    const cfg = parseProviderConfig({ providers: { do: { name: 'claude' } } });
    assert.strictEqual(cfg.do.name, 'claude');
    assert.strictEqual(cfg.do.sandbox, undefined);
  });

  // -------------------------------------------------------------------------
  // 결과
  // -------------------------------------------------------------------------

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
