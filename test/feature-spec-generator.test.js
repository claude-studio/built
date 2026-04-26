#!/usr/bin/env node
/**
 * test/feature-spec-generator.test.js
 *
 * test/fixtures/feature-spec-generator.js 단위 테스트.
 *
 * 검증 항목:
 *   1. buildFeatureSpec — frontmatter 필드 존재 및 계약 일치
 *   2. buildDoResultFrontmatter — 필수 필드 및 타입
 *   3. buildCheckResultFrontmatter — 필수 필드 및 타입
 *   4. buildProviderConfig / buildCodexDoConfig — 변형 정확성
 *   5. makeFeatureSpecProject — 임시 디렉토리 생성 및 파일 내용
 *   6. writeRunRequest — 파일 경로 및 JSON 내용
 *   7. assertFeatureSpecFrontmatter — 누락 필드 감지
 *   8. assertDoResultFrontmatter / assertCheckResultFrontmatter — status 검증
 *
 * 외부 npm 패키지 없음 (Node.js 내장 모듈만 사용).
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const {
  DEFAULT_FEATURE_ID,
  DEFAULT_ACCEPTANCE_CRITERIA,
  DEFAULT_EXCLUDES,
  DEFAULT_BUILD_FILES,
  DEFAULT_PROVIDER_CONFIG,
  buildFeatureSpec,
  buildDoResultFrontmatter,
  buildCheckResultFrontmatter,
  buildProviderConfig,
  buildCodexDoConfig,
  makeFeatureSpecProject,
  writeRunRequest,
  assertFeatureSpecFrontmatter,
  assertDoResultFrontmatter,
  assertCheckResultFrontmatter,
} = require('./fixtures/feature-spec-generator');

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
// frontmatter 파서 (src/frontmatter.js 의존 없이 간단히 검증)
// ---------------------------------------------------------------------------

/**
 * YAML frontmatter를 간단히 파싱해 key: value 맵을 반환한다.
 * 중첩 객체/배열은 키 존재 여부만 확인한다.
 */
function parseSimpleFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    if (key && !key.startsWith(' ') && !key.startsWith('-')) {
      fm[key] = val;
    }
  }
  return fm;
}

// ---------------------------------------------------------------------------
// [1] buildFeatureSpec
// ---------------------------------------------------------------------------

console.log('\n[buildFeatureSpec]');

test('기본 옵션으로 생성 — frontmatter에 필수 필드 존재', () => {
  const content = buildFeatureSpec();
  const fm = parseSimpleFrontmatter(content);
  for (const key of ['feature', 'version', 'created_at', 'confirmed_by_user', 'status', 'primary_user_action', 'excludes', 'build_files']) {
    assert.ok(key in fm, `frontmatter 누락: ${key}`);
  }
});

test('featureId 지정 시 frontmatter feature 필드와 제목에 반영', () => {
  const content = buildFeatureSpec({ featureId: 'payment' });
  assert.ok(content.includes('feature: payment'), 'frontmatter feature 필드');
  assert.ok(content.includes('# payment'), '본문 제목');
});

test('acceptanceCriteria 지정 시 본문에 포함', () => {
  const criteria = ['첫 번째 기준', '두 번째 기준'];
  const content  = buildFeatureSpec({ acceptanceCriteria: criteria });
  assert.ok(content.includes('첫 번째 기준'));
  assert.ok(content.includes('두 번째 기준'));
});

test('excludes 지정 시 frontmatter excludes에 반영', () => {
  const content = buildFeatureSpec({ excludes: ['SSO', '2FA'] });
  assert.ok(content.includes('"SSO"'), 'excludes SSO');
  assert.ok(content.includes('"2FA"'), 'excludes 2FA');
});

test('buildFiles 지정 시 frontmatter build_files에 반영', () => {
  const files   = ['src/foo.js', 'src/bar.js'];
  const content = buildFeatureSpec({ buildFiles: files });
  assert.ok(content.includes('"src/foo.js"'), 'build_files foo');
  assert.ok(content.includes('"src/bar.js"'), 'build_files bar');
});

test('status 지정 시 frontmatter status 반영', () => {
  const content = buildFeatureSpec({ status: 'in_progress' });
  assert.ok(content.includes('status: in_progress'));
});

test('createdAt 지정 시 frontmatter created_at 반영', () => {
  const content = buildFeatureSpec({ createdAt: '2026-01-01' });
  assert.ok(content.includes('created_at: 2026-01-01'));
});

test('기본값으로 생성한 spec이 assertFeatureSpecFrontmatter 통과', () => {
  const content = buildFeatureSpec();
  const fm = parseSimpleFrontmatter(content);
  // 배열 키를 직접 주입해 assertFeatureSpecFrontmatter 호출
  const fullFm = Object.assign({}, fm, { excludes: [], build_files: [] });
  assert.doesNotThrow(() => assertFeatureSpecFrontmatter(fullFm));
});

// ---------------------------------------------------------------------------
// [2] buildDoResultFrontmatter
// ---------------------------------------------------------------------------

console.log('\n[buildDoResultFrontmatter]');

test('기본 옵션 — 필수 필드 존재', () => {
  const fm = buildDoResultFrontmatter();
  for (const key of ['feature_id', 'status', 'model', 'cost_usd', 'duration_ms', 'created_at']) {
    assert.ok(key in fm, `누락: ${key}`);
  }
});

test('status 기본값은 completed', () => {
  const fm = buildDoResultFrontmatter();
  assert.strictEqual(fm.status, 'completed');
});

test('featureId 반영', () => {
  const fm = buildDoResultFrontmatter({ featureId: 'payment' });
  assert.strictEqual(fm.feature_id, 'payment');
});

test('failed status 지정', () => {
  const fm = buildDoResultFrontmatter({ status: 'failed' });
  assert.strictEqual(fm.status, 'failed');
});

test('assertDoResultFrontmatter 통과', () => {
  const fm = buildDoResultFrontmatter();
  assert.doesNotThrow(() => assertDoResultFrontmatter(fm));
});

test('assertDoResultFrontmatter — 잘못된 status 감지', () => {
  const fm = buildDoResultFrontmatter({ status: 'unknown' });
  assert.throws(() => assertDoResultFrontmatter(fm), /status/);
});

test('assertDoResultFrontmatter — 누락 필드 감지', () => {
  assert.throws(
    () => assertDoResultFrontmatter({ feature_id: 'x', status: 'completed' }),
    /duration_ms/
  );
});

// ---------------------------------------------------------------------------
// [3] buildCheckResultFrontmatter
// ---------------------------------------------------------------------------

console.log('\n[buildCheckResultFrontmatter]');

test('기본 옵션 — 필수 필드 존재', () => {
  const fm = buildCheckResultFrontmatter();
  for (const key of ['feature', 'status', 'checked_at']) {
    assert.ok(key in fm, `누락: ${key}`);
  }
});

test('status 기본값은 approved', () => {
  assert.strictEqual(buildCheckResultFrontmatter().status, 'approved');
});

test('needs_changes status 지정', () => {
  const fm = buildCheckResultFrontmatter({ status: 'needs_changes' });
  assert.strictEqual(fm.status, 'needs_changes');
});

test('assertCheckResultFrontmatter 통과', () => {
  const fm = buildCheckResultFrontmatter();
  assert.doesNotThrow(() => assertCheckResultFrontmatter(fm));
});

test('assertCheckResultFrontmatter — 잘못된 status 감지', () => {
  const fm = buildCheckResultFrontmatter({ status: 'pending' });
  assert.throws(() => assertCheckResultFrontmatter(fm), /status/);
});

// ---------------------------------------------------------------------------
// [4] buildProviderConfig / buildCodexDoConfig
// ---------------------------------------------------------------------------

console.log('\n[buildProviderConfig / buildCodexDoConfig]');

test('buildProviderConfig 기본값 — plan_synthesis, do, check 키 존재', () => {
  const cfg = buildProviderConfig();
  assert.ok('plan_synthesis' in cfg);
  assert.ok('do' in cfg);
  assert.ok('check' in cfg);
});

test('buildProviderConfig — override 반영', () => {
  const cfg = buildProviderConfig({ plan_synthesis: 'codex' });
  assert.strictEqual(cfg.plan_synthesis, 'codex');
  assert.ok('do' in cfg, 'do 유지');
});

test('buildCodexDoConfig 기본값', () => {
  const cfg = buildCodexDoConfig();
  assert.strictEqual(cfg.name, 'codex');
  assert.strictEqual(cfg.model, 'gpt-5.5');
  assert.strictEqual(cfg.effort, 'high');
  assert.strictEqual(cfg.sandbox, 'workspace-write');
  assert.ok('timeout_ms' in cfg);
});

test('buildCodexDoConfig — model 지정', () => {
  const cfg = buildCodexDoConfig({ model: 'gpt-4o' });
  assert.strictEqual(cfg.model, 'gpt-4o');
});

// ---------------------------------------------------------------------------
// [5] makeFeatureSpecProject
// ---------------------------------------------------------------------------

console.log('\n[makeFeatureSpecProject]');

test('기본 옵션 — projectRoot 디렉토리 생성', () => {
  const { projectRoot, cleanup } = makeFeatureSpecProject();
  try {
    assert.ok(fs.existsSync(projectRoot), 'projectRoot 존재');
  } finally {
    cleanup();
  }
});

test('specPath 파일 존재 및 내용에 feature 포함', () => {
  const { specPath, featureId, cleanup } = makeFeatureSpecProject();
  try {
    assert.ok(fs.existsSync(specPath), 'specPath 존재');
    const content = fs.readFileSync(specPath, 'utf8');
    assert.ok(content.includes(`feature: ${featureId}`));
  } finally {
    cleanup();
  }
});

test('featureId 지정 시 specPath 경로에 반영', () => {
  const { specPath, cleanup } = makeFeatureSpecProject({ featureId: 'payment' });
  try {
    assert.ok(specPath.endsWith('payment.md'), `specPath=${specPath}`);
  } finally {
    cleanup();
  }
});

test('specContent 주입 시 그대로 작성', () => {
  const custom = '# custom spec\n\ntest only.\n';
  const { specPath, cleanup } = makeFeatureSpecProject({ specContent: custom });
  try {
    const content = fs.readFileSync(specPath, 'utf8');
    assert.strictEqual(content, custom);
  } finally {
    cleanup();
  }
});

test('cleanup 후 projectRoot 제거', () => {
  const { projectRoot, cleanup } = makeFeatureSpecProject();
  cleanup();
  assert.ok(!fs.existsSync(projectRoot), '정리 후 삭제');
});

// ---------------------------------------------------------------------------
// [6] writeRunRequest
// ---------------------------------------------------------------------------

console.log('\n[writeRunRequest]');

test('run-request.json 파일 생성 및 featureId 반영', () => {
  const { projectRoot, cleanup } = makeFeatureSpecProject({ featureId: 'order' });
  try {
    const filePath = writeRunRequest(projectRoot, 'order');
    assert.ok(fs.existsSync(filePath), '파일 존재');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.strictEqual(data.featureId, 'order');
    assert.ok('planPath' in data, 'planPath 필드');
    assert.ok('createdAt' in data, 'createdAt 필드');
    assert.ok('providers' in data, 'providers 필드');
  } finally {
    cleanup();
  }
});

test('providers 커스텀 지정 반영', () => {
  const { projectRoot, cleanup } = makeFeatureSpecProject();
  try {
    const customProviders = buildProviderConfig({ plan_synthesis: 'codex' });
    const filePath = writeRunRequest(projectRoot, DEFAULT_FEATURE_ID, customProviders);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.strictEqual(data.providers.plan_synthesis, 'codex');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// [7] assertFeatureSpecFrontmatter
// ---------------------------------------------------------------------------

console.log('\n[assertFeatureSpecFrontmatter]');

test('필수 필드 누락 시 오류 발생', () => {
  assert.throws(
    () => assertFeatureSpecFrontmatter({ feature: 'x' }),
    /version/
  );
});

test('feature 빈 문자열 — 오류 발생', () => {
  assert.throws(
    () => assertFeatureSpecFrontmatter({ feature: '', version: 1, created_at: '2026-01-01', confirmed_by_user: true, status: 'planned', primary_user_action: 'a', excludes: [], build_files: [] }),
    /feature/
  );
});

test('excludes 배열 아님 — 오류 발생', () => {
  assert.throws(
    () => assertFeatureSpecFrontmatter({ feature: 'x', version: 1, created_at: '2026-01-01', confirmed_by_user: true, status: 'planned', primary_user_action: 'a', excludes: 'not-array', build_files: [] }),
    /excludes/
  );
});

// ---------------------------------------------------------------------------
// 결과
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed}개 테스트 완료: ${passed}개 통과, ${failed}개 실패`);
if (failed > 0) process.exit(1);
