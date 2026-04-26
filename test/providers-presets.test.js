#!/usr/bin/env node
/**
 * test/providers-presets.test.js
 *
 * src/providers/presets.js 단위 테스트.
 * 외부 npm 패키지 없음. Node.js assert만 사용.
 *
 * 검증 항목:
 *   - listPresets: preset 목록 반환
 *   - getPreset: 유효/잘못된 preset, 반환값 불변성
 *   - buildRunRequest: preset/providers/model, 검증 실패, 동시 사용 불가
 *   - writeRunRequest: 파일 생성, 디렉토리 재귀 생성
 *   - preset 정의가 config parser를 통과하는지 (fixture 테스트)
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  PRESETS,
  listPresets,
  getPreset,
  buildRunRequest,
  writeRunRequest,
} = require('../src/providers/presets');
const { parseProviderConfig } = require('../src/providers/config');

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
// 임시 디렉토리 helper
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'built-preset-test-'));
}

function cleanupDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n[listPresets]');

  await test('preset 목록은 배열이고 5개 이상이다', async () => {
    const list = listPresets();
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 5, `expected >= 5, got ${list.length}`);
  });

  await test('claude-default, codex-do, codex-run, codex-plan, codex-all 포함', async () => {
    const list = listPresets();
    for (const name of ['claude-default', 'codex-do', 'codex-run', 'codex-plan', 'codex-all']) {
      assert.ok(list.includes(name), `missing ${name}`);
    }
  });

  // -------------------------------------------------------------------------
  console.log('\n[getPreset]');

  await test('claude-default → 빈 객체', async () => {
    const preset = getPreset('claude-default');
    assert.deepStrictEqual(preset, {});
  });

  await test('codex-do → do/iter가 codex, check/report가 claude', async () => {
    const preset = getPreset('codex-do');
    assert.strictEqual(typeof preset.do === 'object' ? preset.do.name : preset.do, 'codex');
    assert.strictEqual(typeof preset.check === 'string' ? preset.check : preset.check.name, 'claude');
    assert.strictEqual(typeof preset.iter === 'object' ? preset.iter.name : preset.iter, 'codex');
  });

  await test('codex-run → 일반 run 4단계가 codex이고 plan_synthesis는 없음', async () => {
    const preset = getPreset('codex-run');
    for (const phase of ['do', 'check', 'iter', 'report']) {
      const v = preset[phase];
      const name = typeof v === 'string' ? v : v.name;
      assert.strictEqual(name, 'codex', `${phase} should be codex`);
    }
    assert.strictEqual(preset.do.sandbox, 'workspace-write');
    assert.strictEqual(preset.check.sandbox, 'read-only');
    assert.strictEqual(preset.iter.sandbox, 'workspace-write');
    assert.strictEqual(preset.report.sandbox, 'read-only');
    assert.ok(!Object.prototype.hasOwnProperty.call(preset, 'plan_synthesis'));
  });

  await test('codex-all → 모든 phase가 codex', async () => {
    const preset = getPreset('codex-all');
    for (const phase of ['plan_synthesis', 'do', 'check', 'iter', 'report']) {
      const v = preset[phase];
      const name = typeof v === 'string' ? v : v.name;
      assert.strictEqual(name, 'codex', `${phase} should be codex`);
    }
  });

  await test('알 수 없는 preset → 오류', async () => {
    assert.throws(
      () => getPreset('nonexistent'),
      (err) => err.message.includes('nonexistent') && err.message.includes('preset')
    );
  });

  await test('getPreset 반환값 수정해도 원본 불변', async () => {
    const a = getPreset('codex-do');
    a.do = 'modified';
    const b = getPreset('codex-do');
    assert.notStrictEqual(b.do, 'modified');
  });

  // -------------------------------------------------------------------------
  console.log('\n[getPreset — fixture: 모든 preset이 config parser를 통과]');

  for (const name of listPresets()) {
    await test(`preset "${name}" → parseProviderConfig 통과`, async () => {
      const providers = getPreset(name);
      // 오류 없이 파싱되어야 한다
      const parsed = parseProviderConfig({ providers });
      assert.ok(typeof parsed === 'object');
    });
  }

  // -------------------------------------------------------------------------
  console.log('\n[buildRunRequest]');

  await test('featureId 필수 — 없으면 오류', async () => {
    assert.throws(
      () => buildRunRequest({}),
      (err) => err.message.includes('featureId')
    );
    assert.throws(
      () => buildRunRequest(null),
      (err) => err.message.includes('featureId')
    );
  });

  await test('preset 지정 → providers 포함', async () => {
    const req = buildRunRequest({ featureId: 'test-feat', preset: 'codex-do' });
    assert.strictEqual(req.featureId, 'test-feat');
    assert.ok(req.providers);
    assert.ok(req.providers.do);
    assert.ok(req.createdAt);
    assert.strictEqual(req.planPath, '.built/features/test-feat.md');
  });

  await test('codex-do preset → Do/Iter sandbox는 workspace-write kebab-case', async () => {
    const req = buildRunRequest({ featureId: 'test-feat', preset: 'codex-do' });
    assert.strictEqual(req.providers.do.sandbox, 'workspace-write');
    assert.strictEqual(req.providers.iter.sandbox, 'workspace-write');
    assert.ok(!JSON.stringify(req.providers).includes('workspaceWrite'));
  });

  await test('codex-run preset → Do/Check/Iter/Report Codex, plan_synthesis 없음', async () => {
    const req = buildRunRequest({ featureId: 'test-feat', preset: 'codex-run' });
    assert.strictEqual(req.providers.do.name, 'codex');
    assert.strictEqual(req.providers.do.sandbox, 'workspace-write');
    assert.strictEqual(req.providers.check.name, 'codex');
    assert.strictEqual(req.providers.check.sandbox, 'read-only');
    assert.strictEqual(req.providers.iter.name, 'codex');
    assert.strictEqual(req.providers.iter.sandbox, 'workspace-write');
    assert.strictEqual(req.providers.report.name, 'codex');
    assert.strictEqual(req.providers.report.sandbox, 'read-only');
    assert.ok(!Object.prototype.hasOwnProperty.call(req.providers, 'plan_synthesis'));
  });

  await test('claude-default preset → providers 필드 없음', async () => {
    const req = buildRunRequest({ featureId: 'test-feat', preset: 'claude-default' });
    assert.strictEqual(req.providers, undefined);
  });

  await test('model 지정 → req.model 포함', async () => {
    const req = buildRunRequest({ featureId: 'test-feat', preset: 'claude-default', model: 'claude-opus-4-5' });
    assert.strictEqual(req.model, 'claude-opus-4-5');
  });

  await test('preset과 providers 동시 지정 → 오류', async () => {
    assert.throws(
      () => buildRunRequest({ featureId: 'test-feat', preset: 'codex-do', providers: { do: 'claude' } }),
      (err) => err.message.includes('동시')
    );
  });

  await test('직접 providers 지정 → 검증 통과', async () => {
    const req = buildRunRequest({
      featureId: 'test-feat',
      providers: { do: 'codex', check: 'claude' },
    });
    assert.ok(req.providers);
    assert.strictEqual(typeof req.providers.do, 'string');
  });

  await test('잘못된 providers → 검증 실패', async () => {
    assert.throws(
      () => buildRunRequest({ featureId: 'test-feat', providers: { do: 'openai' } }),
      (err) => err.message.includes('openai')
    );
  });

  await test('잘못된 preset 이름 → 오류', async () => {
    assert.throws(
      () => buildRunRequest({ featureId: 'test-feat', preset: 'nonexistent' }),
      (err) => err.message.includes('nonexistent')
    );
  });

  await test('planPath 커스텀 지정', async () => {
    const req = buildRunRequest({ featureId: 'test-feat', planPath: 'custom/plan.md' });
    assert.strictEqual(req.planPath, 'custom/plan.md');
  });

  // -------------------------------------------------------------------------
  console.log('\n[writeRunRequest]');

  await test('파일 생성 및 내용 검증', async () => {
    const tmpDir = makeTmpDir();
    try {
      const dir = path.join(tmpDir, 'nested', 'dir');
      const req = buildRunRequest({ featureId: 'write-test', preset: 'codex-do' });
      const filePath = writeRunRequest(dir, req);

      assert.ok(fs.existsSync(filePath));
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      assert.strictEqual(content.featureId, 'write-test');
      assert.ok(content.providers);
      assert.ok(content.providers.do);
    } finally {
      cleanupDir(tmpDir);
    }
  });

  await test('.built/config.json에 쓰지 않는다 (경로 확인)', async () => {
    const tmpDir = makeTmpDir();
    try {
      const dir = path.join(tmpDir, '.built', 'runtime', 'runs', 'test');
      const req = buildRunRequest({ featureId: 'test', preset: 'codex-do' });
      writeRunRequest(dir, req);

      // config.json은 존재하지 않아야 한다
      assert.ok(!fs.existsSync(path.join(tmpDir, '.built', 'config.json')));
    } finally {
      cleanupDir(tmpDir);
    }
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
