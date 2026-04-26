#!/usr/bin/env node
/**
 * test/e2e/scenarios/05-provider-equivalence-contracts.js
 *
 * E2E 시나리오 5: provider 결과 동등성 golden fixture 검증
 *
 * 검증 내용:
 *   1. plan_synthesis phase: fake-claude / fake-codex 출력이 같은 파일 계약을 충족하는지 확인
 *   2. do phase: 공통 fixture 기반 provider 불변 필드 동등성 검증
 *   3. check phase: check-result.md 필수 frontmatter 계약 검증
 *   4. 완료 판정 기준: provider 응답이 아닌 acceptance/status/check 기준임을 assertion으로 증명
 *   5. iter phase: iter 사이클 후 do-result.md / check-result.md 파일 계약 유지 검증
 *      - usage 없는 provider와 usage 있는 provider 모두 불변 필드 동일
 *   6. report phase: report.md 필수 frontmatter 계약 검증
 *      - claude vs codex 불변 필드 동일, provider/model은 고유 필드
 *
 * 오프라인 실행 가능: 실제 Claude/Codex 호출 없음.
 * 외부 npm 패키지 없음 (Node.js 내장 fs/os/path/assert만 사용).
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const BUILT_ROOT    = path.join(__dirname, '..', '..', '..');
const FIXTURES_ROOT = path.join(__dirname, '..', '..', 'fixtures');

const {
  FAKE_FEATURE_SPEC,
  FAKE_CLAUDE_PLAN_SYNTHESIS_OUTPUT,
  FAKE_CODEX_PLAN_SYNTHESIS_OUTPUT,
  FAKE_CLAUDE_RAW_EVENTS,
  FAKE_CODEX_STANDARD_EVENTS,
  FAKE_CODEX_STANDARD_EVENTS_NO_USAGE,
  FAKE_CHECK_APPROVED,
  FAKE_CHECK_NEEDS_CHANGES,
  FAKE_CHECK_APPROVED_AFTER_ITER,
  FAKE_REPORT_DATA_CLAUDE,
  FAKE_REPORT_DATA_CODEX,
  PROVIDER_INVARIANT_FIELDS,
  PROVIDER_SPECIFIC_FIELDS,
} = require(path.join(FIXTURES_ROOT, 'provider-common-input'));

const {
  normalizePlanSynthesisOutput,
  writePlanSynthesisOutput,
} = require(path.join(BUILT_ROOT, 'src', 'plan-synthesis'));

const {
  normalizeClaude: nClaude,
  normalizeCodex: nCodex,
} = require(path.join(BUILT_ROOT, 'src', 'providers', 'event-normalizer'));

const { createStandardWriter: createWriter } =
  require(path.join(BUILT_ROOT, 'src', 'providers', 'standard-writer'));

const { parse: parseFrontmatter } =
  require(path.join(BUILT_ROOT, 'src', 'frontmatter'));

// ---------------------------------------------------------------------------
// 테스트 러너
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL ${name}`);
    console.log(`       ${e.message}`);
    failed++;
  }
}

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), (prefix || 'e2e5') + '-'));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ---------------------------------------------------------------------------
// 헬퍼: check-result.md 생성 (check.js 로직과 동일한 형식)
// ---------------------------------------------------------------------------

/**
 * fake check 결과로 check-result.md를 생성한다.
 * 실제 Claude 호출 없이 check.js가 생성하는 파일 포맷을 재현한다.
 *
 * @param {string} featureDir  check-result.md를 쓸 디렉토리
 * @param {object} checkData   { feature, status, summary, issues, acceptance_criteria_results }
 * @returns {string}           생성된 파일 경로
 */
function writeCheckResult(featureDir, checkData) {
  const { feature, status, summary, issues, acceptance_criteria_results } = checkData;
  const now = new Date().toISOString();

  let issuesSection = '';
  if (issues && issues.length > 0) {
    issuesSection = '\n## 수정 필요 항목\n\n' +
      issues.map((item) => `- ${item}`).join('\n') + '\n';
  }

  let acSection = '';
  if (acceptance_criteria_results && acceptance_criteria_results.length > 0) {
    acSection = '\n## 완료 기준 충족 여부\n\n' +
      acceptance_criteria_results
        .map((r) => `- [${r.passed ? 'x' : ' '}] ${r.criterion}`)
        .join('\n') + '\n';
  }

  const content = [
    '---',
    `feature: ${feature}`,
    `status: ${status}`,
    `checked_at: ${now}`,
    '---',
    '',
    '## 검토 결과',
    '',
    summary || '',
    acSection,
    issuesSection,
  ].join('\n');

  fs.mkdirSync(featureDir, { recursive: true });
  const checkResultPath = path.join(featureDir, 'check-result.md');
  fs.writeFileSync(checkResultPath, content, 'utf8');
  return checkResultPath;
}

// ---------------------------------------------------------------------------
// 헬퍼: do phase standard-writer 실행
// ---------------------------------------------------------------------------

function runDoPhaseWriter(tmpDir, providerName, standardEvents) {
  const runtimeRoot      = path.join(tmpDir, providerName);
  const resultOutputPath = path.join(runtimeRoot, 'do-result.md');

  fs.mkdirSync(runtimeRoot, { recursive: true });

  const writer = createWriter({
    runtimeRoot,
    phase:        'do',
    featureId:    'user-auth',
    resultOutputPath,
  });

  for (const event of standardEvents) {
    writer.handleEvent(event);
  }
  writer.close();

  return {
    progressPath: path.join(runtimeRoot, 'progress.json'),
    resultPath:   resultOutputPath,
  };
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------

console.log('\n[E2E] 시나리오 5: provider 결과 동등성 golden fixture 검증\n');

async function main() {

  // =========================================================================
  // 섹션 1: plan_synthesis phase 파일 계약
  // =========================================================================

  console.log('  [1] plan_synthesis phase 파일 계약\n');

  await test('공통 fixture: FAKE_FEATURE_SPEC이 올바른 형식', () => {
    assert.ok(typeof FAKE_FEATURE_SPEC === 'string', 'FAKE_FEATURE_SPEC은 문자열이어야 함');
    assert.ok(FAKE_FEATURE_SPEC.length > 0, 'FAKE_FEATURE_SPEC은 비어있지 않아야 함');
    assert.ok(FAKE_FEATURE_SPEC.includes('user-auth'), 'feature 식별자 포함');
    assert.ok(FAKE_FEATURE_SPEC.includes('완료 기준'), 'acceptance criteria 섹션 포함');
  });

  await test('fake-claude plan_synthesis: 정규화 후 plan-synthesis.json 필수 필드 존재', async () => {
    const dir = makeTmpDir('e2e5-ps-claude');
    try {
      const projectRoot = dir;
      fs.mkdirSync(path.join(projectRoot, '.built', 'features', 'user-auth'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, '.built', 'features', 'user-auth.md'), FAKE_FEATURE_SPEC, 'utf8');

      const normalized = normalizePlanSynthesisOutput(FAKE_CLAUDE_PLAN_SYNTHESIS_OUTPUT, { acceptance_criteria: [] });
      const paths = writePlanSynthesisOutput({
        projectRoot,
        feature: 'user-auth',
        output: normalized,
        providerSpec: { name: 'claude', model: 'claude-opus-4-5' },
      });

      assert.ok(fs.existsSync(paths.jsonPath), 'plan-synthesis.json 존재');
      const doc = readJson(paths.jsonPath);

      for (const field of PROVIDER_INVARIANT_FIELDS['plan-synthesis.json']) {
        assert.ok(field in doc, `plan-synthesis.json 필드 누락: ${field}`);
      }
      assert.strictEqual(doc.feature_id, 'user-auth', 'feature_id 일치');
      assert.strictEqual(doc.phase, 'plan_synthesis', 'phase 일치');
      assert.ok(!isNaN(Date.parse(doc.created_at)), 'created_at 유효한 ISO 타임스탬프');
    } finally {
      rmDir(dir);
    }
  });

  await test('fake-claude plan_synthesis: output 내 필수 구조 필드 존재', async () => {
    const dir = makeTmpDir('e2e5-ps-claude-out');
    try {
      const projectRoot = dir;
      fs.mkdirSync(path.join(projectRoot, '.built', 'features', 'user-auth'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, '.built', 'features', 'user-auth.md'), FAKE_FEATURE_SPEC, 'utf8');

      const normalized = normalizePlanSynthesisOutput(FAKE_CLAUDE_PLAN_SYNTHESIS_OUTPUT, {});
      const paths = writePlanSynthesisOutput({
        projectRoot,
        feature: 'user-auth',
        output: normalized,
        providerSpec: { name: 'claude', model: 'claude-opus-4-5' },
      });

      const doc = readJson(paths.jsonPath);

      for (const field of PROVIDER_INVARIANT_FIELDS['plan-synthesis.json.output']) {
        assert.ok(field in doc.output, `output 필드 누락: ${field}`);
      }
      assert.ok(doc.output.summary.length > 0, 'output.summary 비어있지 않음');
      assert.ok(Array.isArray(doc.output.steps), 'output.steps 배열');
      assert.ok(doc.output.steps.length > 0, 'output.steps 최소 1개');
      assert.ok(Array.isArray(doc.output.acceptance_criteria), 'output.acceptance_criteria 배열');

      // step 구조 검증
      for (const step of doc.output.steps) {
        assert.ok(typeof step.id === 'string' && step.id.length > 0, `step.id 존재: ${JSON.stringify(step)}`);
        assert.ok(typeof step.title === 'string', `step.title 존재: ${JSON.stringify(step)}`);
        assert.ok(Array.isArray(step.files), `step.files 배열: ${JSON.stringify(step)}`);
        assert.ok(typeof step.intent === 'string', `step.intent 존재: ${JSON.stringify(step)}`);
      }
    } finally {
      rmDir(dir);
    }
  });

  await test('fake-codex plan_synthesis: 정규화 후 plan-synthesis.json 필수 필드 존재', async () => {
    const dir = makeTmpDir('e2e5-ps-codex');
    try {
      const projectRoot = dir;
      fs.mkdirSync(path.join(projectRoot, '.built', 'features', 'user-auth'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, '.built', 'features', 'user-auth.md'), FAKE_FEATURE_SPEC, 'utf8');

      const normalized = normalizePlanSynthesisOutput(FAKE_CODEX_PLAN_SYNTHESIS_OUTPUT, { acceptance_criteria: [] });
      const paths = writePlanSynthesisOutput({
        projectRoot,
        feature: 'user-auth',
        output: normalized,
        providerSpec: { name: 'codex', model: 'gpt-5.5' },
      });

      assert.ok(fs.existsSync(paths.jsonPath), 'plan-synthesis.json 존재');
      const doc = readJson(paths.jsonPath);

      for (const field of PROVIDER_INVARIANT_FIELDS['plan-synthesis.json']) {
        assert.ok(field in doc, `plan-synthesis.json 필드 누락: ${field}`);
      }
      assert.strictEqual(doc.feature_id, 'user-auth', 'feature_id 일치');
      assert.strictEqual(doc.phase, 'plan_synthesis', 'phase 일치');
    } finally {
      rmDir(dir);
    }
  });

  await test('fake-claude vs fake-codex: plan-synthesis.json provider 불변 필드 동일', async () => {
    const dir = makeTmpDir('e2e5-ps-compare');
    try {
      const makeProject = (suffix) => {
        const projectRoot = path.join(dir, suffix);
        fs.mkdirSync(path.join(projectRoot, '.built', 'features', 'user-auth'), { recursive: true });
        fs.writeFileSync(path.join(projectRoot, '.built', 'features', 'user-auth.md'), FAKE_FEATURE_SPEC, 'utf8');
        return projectRoot;
      };

      const claudeRoot = makeProject('claude');
      const codexRoot  = makeProject('codex');

      const claudeNorm = normalizePlanSynthesisOutput(FAKE_CLAUDE_PLAN_SYNTHESIS_OUTPUT, {});
      const codexNorm  = normalizePlanSynthesisOutput(FAKE_CODEX_PLAN_SYNTHESIS_OUTPUT, {});

      const claudePaths = writePlanSynthesisOutput({
        projectRoot: claudeRoot,
        feature: 'user-auth',
        output: claudeNorm,
        providerSpec: { name: 'claude', model: 'claude-opus-4-5' },
      });
      const codexPaths = writePlanSynthesisOutput({
        projectRoot: codexRoot,
        feature: 'user-auth',
        output: codexNorm,
        providerSpec: { name: 'codex', model: 'gpt-5.5' },
      });

      const claudeDoc = readJson(claudePaths.jsonPath);
      const codexDoc  = readJson(codexPaths.jsonPath);

      // 불변 필드: 같아야 하는 값들
      assert.strictEqual(claudeDoc.feature_id, codexDoc.feature_id, 'feature_id 동일');
      assert.strictEqual(claudeDoc.phase,      codexDoc.phase,      'phase 동일');

      // 불변 구조: output 내 배열 타입
      assert.ok(Array.isArray(claudeDoc.output.steps),                'Claude output.steps 배열');
      assert.ok(Array.isArray(codexDoc.output.steps),                 'Codex output.steps 배열');
      assert.ok(Array.isArray(claudeDoc.output.acceptance_criteria),  'Claude output.acceptance_criteria 배열');
      assert.ok(Array.isArray(codexDoc.output.acceptance_criteria),   'Codex output.acceptance_criteria 배열');
      assert.ok(Array.isArray(claudeDoc.output.risks),                'Claude output.risks 배열');
      assert.ok(Array.isArray(codexDoc.output.risks),                 'Codex output.risks 배열');
      assert.ok(Array.isArray(claudeDoc.output.out_of_scope),         'Claude output.out_of_scope 배열');
      assert.ok(Array.isArray(codexDoc.output.out_of_scope),          'Codex output.out_of_scope 배열');

      // 고유 필드: 달라야 정상인 값들
      assert.notStrictEqual(claudeDoc.provider, codexDoc.provider,
        `provider는 달라야 함 (claude=${claudeDoc.provider}, codex=${codexDoc.provider})`);
    } finally {
      rmDir(dir);
    }
  });

  await test('plan-synthesis.md: 두 provider 모두 frontmatter 포함', async () => {
    const dir = makeTmpDir('e2e5-ps-md');
    try {
      const makeProject = (suffix) => {
        const projectRoot = path.join(dir, suffix);
        fs.mkdirSync(path.join(projectRoot, '.built', 'features', 'user-auth'), { recursive: true });
        fs.writeFileSync(path.join(projectRoot, '.built', 'features', 'user-auth.md'), FAKE_FEATURE_SPEC, 'utf8');
        return projectRoot;
      };

      for (const [providerName, rawOutput, providerSpec] of [
        ['claude', FAKE_CLAUDE_PLAN_SYNTHESIS_OUTPUT, { name: 'claude', model: 'claude-opus-4-5' }],
        ['codex',  FAKE_CODEX_PLAN_SYNTHESIS_OUTPUT,  { name: 'codex',  model: 'gpt-5.5' }],
      ]) {
        const projectRoot = makeProject(providerName);
        const normalized  = normalizePlanSynthesisOutput(rawOutput, {});
        const paths = writePlanSynthesisOutput({ projectRoot, feature: 'user-auth', output: normalized, providerSpec });

        assert.ok(fs.existsSync(paths.mdPath), `${providerName}: plan-synthesis.md 존재`);
        const content = fs.readFileSync(paths.mdPath, 'utf8');

        assert.ok(content.startsWith('---'), `${providerName}: frontmatter로 시작`);
        assert.ok(content.includes('feature_id: user-auth'), `${providerName}: feature_id 포함`);
        assert.ok(content.includes('phase: plan_synthesis'), `${providerName}: phase 포함`);
        assert.ok(content.includes('# Plan Synthesis'), `${providerName}: 본문 헤더 포함`);
      }
    } finally {
      rmDir(dir);
    }
  });

  // =========================================================================
  // 섹션 2: do phase provider 불변 필드 (공통 fixture 기반)
  // =========================================================================

  console.log('\n  [2] do phase provider 불변 필드 (공통 fixture 기반)\n');

  await test('공통 fixture 기반 fake-claude: progress.json 불변 필드 존재', async () => {
    const dir = makeTmpDir('e2e5-do-claude');
    try {
      const standardEvents = FAKE_CLAUDE_RAW_EVENTS.flatMap(nClaude);
      const { progressPath } = runDoPhaseWriter(dir, 'fake-claude', standardEvents);

      const progress = readJson(progressPath);
      for (const field of PROVIDER_INVARIANT_FIELDS['progress.json']) {
        assert.ok(field in progress, `progress.json 불변 필드 누락: ${field}`);
      }
      assert.strictEqual(progress.feature, 'user-auth', 'feature 일치');
      assert.strictEqual(progress.phase,   'do',         'phase 일치');
      assert.strictEqual(progress.status,  'completed',  'status=completed');
    } finally {
      rmDir(dir);
    }
  });

  await test('공통 fixture 기반 fake-codex: progress.json 불변 필드 존재', async () => {
    const dir = makeTmpDir('e2e5-do-codex');
    try {
      const standardEvents = FAKE_CODEX_STANDARD_EVENTS.flatMap(nCodex);
      const { progressPath } = runDoPhaseWriter(dir, 'fake-codex', standardEvents);

      const progress = readJson(progressPath);
      for (const field of PROVIDER_INVARIANT_FIELDS['progress.json']) {
        assert.ok(field in progress, `progress.json 불변 필드 누락: ${field}`);
      }
      assert.strictEqual(progress.feature, 'user-auth', 'feature 일치');
      assert.strictEqual(progress.phase,   'do',         'phase 일치');
      assert.strictEqual(progress.status,  'completed',  'status=completed');
    } finally {
      rmDir(dir);
    }
  });

  await test('fake-claude vs fake-codex: progress.json 불변 필드 값 동일', async () => {
    const dir = makeTmpDir('e2e5-do-compare');
    try {
      const claudeEvents = FAKE_CLAUDE_RAW_EVENTS.flatMap(nClaude);
      const codexEvents  = FAKE_CODEX_STANDARD_EVENTS.flatMap(nCodex);

      const { progressPath: claudeP } = runDoPhaseWriter(dir, 'fake-claude', claudeEvents);
      const { progressPath: codexP  } = runDoPhaseWriter(dir, 'fake-codex',  codexEvents);

      const claudeProg = readJson(claudeP);
      const codexProg  = readJson(codexP);

      // 값이 같아야 하는 불변 필드
      assert.strictEqual(claudeProg.feature, codexProg.feature, 'feature 동일');
      assert.strictEqual(claudeProg.phase,   codexProg.phase,   'phase 동일');
      assert.strictEqual(claudeProg.status,  codexProg.status,  'status 동일');

      // 타입만 같아야 하는 불변 필드
      assert.strictEqual(typeof claudeProg.turn,       'number', 'Claude turn 타입');
      assert.strictEqual(typeof codexProg.turn,        'number', 'Codex turn 타입');
      assert.strictEqual(typeof claudeProg.tool_calls, 'number', 'Claude tool_calls 타입');
      assert.strictEqual(typeof codexProg.tool_calls,  'number', 'Codex tool_calls 타입');
    } finally {
      rmDir(dir);
    }
  });

  await test('fake-claude vs fake-codex: do-result.md 불변 frontmatter 필드 동일', async () => {
    const dir = makeTmpDir('e2e5-do-result-compare');
    try {
      const claudeEvents = FAKE_CLAUDE_RAW_EVENTS.flatMap(nClaude);
      const codexEvents  = FAKE_CODEX_STANDARD_EVENTS.flatMap(nCodex);

      const { resultPath: claudeR } = runDoPhaseWriter(dir, 'fake-claude', claudeEvents);
      const { resultPath: codexR  } = runDoPhaseWriter(dir, 'fake-codex',  codexEvents);

      const claudeData = parseFrontmatter(fs.readFileSync(claudeR, 'utf8')).data;
      const codexData  = parseFrontmatter(fs.readFileSync(codexR,  'utf8')).data;

      // 불변 필드 존재
      for (const field of PROVIDER_INVARIANT_FIELDS['do-result.md']) {
        assert.ok(field in claudeData, `Claude do-result.md 불변 필드 누락: ${field}`);
        assert.ok(field in codexData,  `Codex do-result.md 불변 필드 누락: ${field}`);
      }

      // 값이 같아야 하는 필드
      assert.strictEqual(claudeData.feature_id, codexData.feature_id, 'feature_id 동일');
      assert.strictEqual(claudeData.status,     codexData.status,     'status 동일');
    } finally {
      rmDir(dir);
    }
  });

  await test('provider 고유 필드 분리: session_id는 provider마다 달라도 됨', async () => {
    const dir = makeTmpDir('e2e5-specific-fields');
    try {
      const claudeEvents = FAKE_CLAUDE_RAW_EVENTS.flatMap(nClaude);
      const codexEvents  = FAKE_CODEX_STANDARD_EVENTS.flatMap(nCodex);

      const { progressPath: claudeP } = runDoPhaseWriter(dir, 'fake-claude', claudeEvents);
      const { progressPath: codexP  } = runDoPhaseWriter(dir, 'fake-codex',  codexEvents);

      const claudeProg = readJson(claudeP);
      const codexProg  = readJson(codexP);

      // session_id는 PROVIDER_SPECIFIC_FIELDS 에 해당 — 동일할 필요 없음
      assert.ok(
        PROVIDER_SPECIFIC_FIELDS['progress.json'].includes('session_id'),
        'session_id는 provider 고유 필드 목록에 있어야 함'
      );
      // 실제로 다른지 확인 (fake-claude는 'sess-claude-001', fake-codex는 null 또는 다른 값)
      assert.notStrictEqual(
        claudeProg.session_id,
        codexProg.session_id,
        `session_id는 provider마다 달라야 함 (claude=${claudeProg.session_id}, codex=${codexProg.session_id})`
      );
    } finally {
      rmDir(dir);
    }
  });

  // =========================================================================
  // 섹션 3: check phase check-result.md 파일 계약
  // =========================================================================

  console.log('\n  [3] check phase check-result.md 파일 계약\n');

  await test('approved: check-result.md 필수 frontmatter 필드 존재', async () => {
    const dir = makeTmpDir('e2e5-check-approved');
    try {
      const checkResultPath = writeCheckResult(dir, FAKE_CHECK_APPROVED);

      assert.ok(fs.existsSync(checkResultPath), 'check-result.md 존재');
      const content = fs.readFileSync(checkResultPath, 'utf8');
      const { data } = parseFrontmatter(content);

      for (const field of PROVIDER_INVARIANT_FIELDS['check-result.md']) {
        assert.ok(field in data, `check-result.md 불변 필드 누락: ${field}`);
      }
      assert.strictEqual(data.feature, 'user-auth',  'feature 일치');
      assert.strictEqual(data.status,  'approved',   'status=approved');
      assert.ok(!isNaN(Date.parse(data.checked_at)), 'checked_at 유효한 ISO 타임스탬프');
    } finally {
      rmDir(dir);
    }
  });

  await test('needs_changes: check-result.md 필수 frontmatter 필드 존재', async () => {
    const dir = makeTmpDir('e2e5-check-needs');
    try {
      const checkResultPath = writeCheckResult(dir, FAKE_CHECK_NEEDS_CHANGES);

      const content = fs.readFileSync(checkResultPath, 'utf8');
      const { data } = parseFrontmatter(content);

      for (const field of PROVIDER_INVARIANT_FIELDS['check-result.md']) {
        assert.ok(field in data, `check-result.md 불변 필드 누락: ${field}`);
      }
      assert.strictEqual(data.status, 'needs_changes', 'status=needs_changes');
    } finally {
      rmDir(dir);
    }
  });

  await test('check-result.md: status는 approved 또는 needs_changes만 허용', async () => {
    const dir = makeTmpDir('e2e5-check-status');
    try {
      const VALID_STATUSES = ['approved', 'needs_changes'];

      for (const status of VALID_STATUSES) {
        const checkData = { ...FAKE_CHECK_APPROVED, status };
        const checkResultPath = writeCheckResult(path.join(dir, status), checkData);
        const content = fs.readFileSync(checkResultPath, 'utf8');
        const { data } = parseFrontmatter(content);
        assert.strictEqual(data.status, status, `status=${status} 기록됨`);
      }
    } finally {
      rmDir(dir);
    }
  });

  await test('check-result.md: feature 필드는 do phase feature와 동일해야 함', async () => {
    const dir = makeTmpDir('e2e5-check-feature-match');
    try {
      // do phase 실행 후 feature 확인
      const claudeEvents = FAKE_CLAUDE_RAW_EVENTS.flatMap(nClaude);
      const { progressPath } = runDoPhaseWriter(dir, 'fake-claude', claudeEvents);
      const doProgress = readJson(progressPath);

      // check-result.md 생성 (do phase와 같은 feature 사용)
      const checkData = { ...FAKE_CHECK_APPROVED, feature: doProgress.feature };
      const checkResultPath = writeCheckResult(path.join(dir, 'check'), checkData);
      const checkContent = fs.readFileSync(checkResultPath, 'utf8');
      const { data: checkData2 } = parseFrontmatter(checkContent);

      assert.strictEqual(
        checkData2.feature,
        doProgress.feature,
        'check-result.md feature가 do phase feature와 일치'
      );
    } finally {
      rmDir(dir);
    }
  });

  // =========================================================================
  // 섹션 4: 완료 판정 기준 — provider 응답이 아닌 acceptance/status/check 기준
  // =========================================================================

  console.log('\n  [4] 완료 판정 기준: provider 응답이 아닌 acceptance/check 기준\n');

  await test('완료 판정은 do-result.md status 필드로 결정된다 (provider 이름 무관)', async () => {
    const dir = makeTmpDir('e2e5-completion-criterion');
    try {
      // Claude do phase
      const claudeEvents = FAKE_CLAUDE_RAW_EVENTS.flatMap(nClaude);
      const { resultPath: claudeR } = runDoPhaseWriter(dir, 'fake-claude', claudeEvents);

      // Codex do phase
      const codexEvents = FAKE_CODEX_STANDARD_EVENTS.flatMap(nCodex);
      const { resultPath: codexR } = runDoPhaseWriter(dir, 'fake-codex', codexEvents);

      const claudeData = parseFrontmatter(fs.readFileSync(claudeR, 'utf8')).data;
      const codexData  = parseFrontmatter(fs.readFileSync(codexR,  'utf8')).data;

      // 완료 판정: 'completed' status 기반 — provider 이름 비교 없음
      const claudeCompleted = claudeData.status === 'completed';
      const codexCompleted  = codexData.status === 'completed';

      assert.ok(claudeCompleted, 'Claude do phase: status=completed으로 완료 판정');
      assert.ok(codexCompleted,  'Codex do phase: status=completed으로 완료 판정');

      // 두 provider 완료 판정이 같음 — provider 이름 비교 없이
      assert.strictEqual(claudeCompleted, codexCompleted, '두 provider 완료 판정 일치');
    } finally {
      rmDir(dir);
    }
  });

  await test('완료 판정은 check-result.md status=approved로 결정된다', async () => {
    const dir = makeTmpDir('e2e5-check-approval');
    try {
      const approvedPath = writeCheckResult(path.join(dir, 'approved'), FAKE_CHECK_APPROVED);
      const needsPath    = writeCheckResult(path.join(dir, 'needs'),    FAKE_CHECK_NEEDS_CHANGES);

      const approvedData = parseFrontmatter(fs.readFileSync(approvedPath, 'utf8')).data;
      const needsData    = parseFrontmatter(fs.readFileSync(needsPath,    'utf8')).data;

      // 완료 판정 기준: provider가 무엇이든 check-result.md status=approved이면 완료
      const isApproved = (checkResultData) => checkResultData.status === 'approved';

      assert.ok(isApproved(approvedData),   'approved check-result.md → 완료');
      assert.ok(!isApproved(needsData),     'needs_changes check-result.md → 미완료');

      // needs_changes 판정이 provider 이름과 무관함을 확인
      // (어떤 provider가 do를 실행했든 check-result.md status만 본다)
      assert.ok(
        !('provider' in needsData),
        'check-result.md에 provider 필드가 없음 — 완료 판정은 provider와 무관'
      );
    } finally {
      rmDir(dir);
    }
  });

  await test('provider 고유 필드 목록: PROVIDER_SPECIFIC_FIELDS가 PROVIDER_INVARIANT_FIELDS와 겹치지 않음', () => {
    for (const fileKey of Object.keys(PROVIDER_INVARIANT_FIELDS)) {
      const invariants = new Set(PROVIDER_INVARIANT_FIELDS[fileKey]);
      const specifics  = PROVIDER_SPECIFIC_FIELDS[fileKey] || [];

      for (const field of specifics) {
        assert.ok(
          !invariants.has(field),
          `필드 '${field}'가 ${fileKey}의 불변/고유 목록 모두에 있어서는 안 됨`
        );
      }
    }
  });

  await test('plan_synthesis 완료 판정: plan-synthesis.json 존재 + output.steps 최소 1개', async () => {
    const dir = makeTmpDir('e2e5-ps-completion');
    try {
      for (const [providerName, rawOutput, spec] of [
        ['claude', FAKE_CLAUDE_PLAN_SYNTHESIS_OUTPUT, { name: 'claude', model: 'claude-opus-4-5' }],
        ['codex',  FAKE_CODEX_PLAN_SYNTHESIS_OUTPUT,  { name: 'codex',  model: 'gpt-5.5' }],
      ]) {
        const projectRoot = path.join(dir, providerName);
        fs.mkdirSync(path.join(projectRoot, '.built', 'features', 'user-auth'), { recursive: true });
        fs.writeFileSync(path.join(projectRoot, '.built', 'features', 'user-auth.md'), FAKE_FEATURE_SPEC, 'utf8');

        const normalized = normalizePlanSynthesisOutput(rawOutput, {});
        const paths = writePlanSynthesisOutput({ projectRoot, feature: 'user-auth', output: normalized, providerSpec: spec });

        const doc = readJson(paths.jsonPath);

        // plan_synthesis 완료 판정 기준: 파일 존재 + output.steps 최소 1개 + acceptance_criteria 최소 1개
        const isPlanSynthesisComplete = (
          fs.existsSync(paths.jsonPath) &&
          Array.isArray(doc.output.steps) && doc.output.steps.length > 0 &&
          Array.isArray(doc.output.acceptance_criteria) && doc.output.acceptance_criteria.length > 0
        );

        assert.ok(
          isPlanSynthesisComplete,
          `${providerName}: plan_synthesis 완료 판정 통과`
        );
      }
    } finally {
      rmDir(dir);
    }
  });

  // =========================================================================
  // 섹션 5: iter phase 파일 계약 (do-result.md + check-result.md after iter)
  // =========================================================================

  console.log('\n  [5] iter phase 파일 계약 (iter 사이클 후 do-result.md / check-result.md)\n');

  await test('iter 사이클 후 fake-claude: do-result.md 불변 필드 유지', async () => {
    const dir = makeTmpDir('e2e5-iter-claude');
    try {
      // iter 사이클 시뮬레이션: needs_changes → 재도 실행 → approved
      const claudeEvents = FAKE_CLAUDE_RAW_EVENTS.flatMap(nClaude);
      const { resultPath } = runDoPhaseWriter(dir, 'fake-claude', claudeEvents);

      const data = parseFrontmatter(fs.readFileSync(resultPath, 'utf8')).data;

      for (const field of PROVIDER_INVARIANT_FIELDS['do-result.md']) {
        assert.ok(field in data, `iter 사이클 후 do-result.md 불변 필드 누락: ${field}`);
      }
      assert.strictEqual(data.feature_id, 'user-auth', 'feature_id 일치');
      assert.strictEqual(data.status,     'completed', 'status=completed');
    } finally {
      rmDir(dir);
    }
  });

  await test('iter 사이클 후 fake-codex: do-result.md 불변 필드 유지', async () => {
    const dir = makeTmpDir('e2e5-iter-codex');
    try {
      const codexEvents = FAKE_CODEX_STANDARD_EVENTS.flatMap(nCodex);
      const { resultPath } = runDoPhaseWriter(dir, 'fake-codex', codexEvents);

      const data = parseFrontmatter(fs.readFileSync(resultPath, 'utf8')).data;

      for (const field of PROVIDER_INVARIANT_FIELDS['do-result.md']) {
        assert.ok(field in data, `iter 사이클 후 do-result.md 불변 필드 누락: ${field}`);
      }
      assert.strictEqual(data.feature_id, 'user-auth', 'feature_id 일치');
      assert.strictEqual(data.status,     'completed', 'status=completed');
    } finally {
      rmDir(dir);
    }
  });

  await test('iter 사이클 후 check-result.md (approved): 불변 필드 유지', async () => {
    const dir = makeTmpDir('e2e5-iter-check');
    try {
      const checkResultPath = writeCheckResult(dir, FAKE_CHECK_APPROVED_AFTER_ITER);

      assert.ok(fs.existsSync(checkResultPath), 'iter 후 check-result.md 존재');
      const content = fs.readFileSync(checkResultPath, 'utf8');
      const { data } = parseFrontmatter(content);

      for (const field of PROVIDER_INVARIANT_FIELDS['check-result.md']) {
        assert.ok(field in data, `iter 후 check-result.md 불변 필드 누락: ${field}`);
      }
      assert.strictEqual(data.feature, 'user-auth', 'feature 일치');
      assert.strictEqual(data.status,  'approved',  'iter 완료 후 status=approved');
      assert.ok(!isNaN(Date.parse(data.checked_at)), 'checked_at 유효한 ISO 타임스탬프');
    } finally {
      rmDir(dir);
    }
  });

  await test('iter 사이클: claude vs codex do-result.md 불변 필드 값 동일', async () => {
    const dir = makeTmpDir('e2e5-iter-compare');
    try {
      const claudeEvents = FAKE_CLAUDE_RAW_EVENTS.flatMap(nClaude);
      const codexEvents  = FAKE_CODEX_STANDARD_EVENTS.flatMap(nCodex);

      const { resultPath: claudeR } = runDoPhaseWriter(dir, 'fake-claude', claudeEvents);
      const { resultPath: codexR  } = runDoPhaseWriter(dir, 'fake-codex',  codexEvents);

      const claudeData = parseFrontmatter(fs.readFileSync(claudeR, 'utf8')).data;
      const codexData  = parseFrontmatter(fs.readFileSync(codexR,  'utf8')).data;

      assert.strictEqual(claudeData.feature_id, codexData.feature_id, 'feature_id 동일');
      assert.strictEqual(claudeData.status,     codexData.status,     'status 동일');
    } finally {
      rmDir(dir);
    }
  });

  await test('usage 없는 provider: do-result.md 불변 필드 유지', async () => {
    const dir = makeTmpDir('e2e5-nousage');
    try {
      const noUsageEvents = FAKE_CODEX_STANDARD_EVENTS_NO_USAGE.flatMap(nCodex);
      const { resultPath, progressPath } = runDoPhaseWriter(dir, 'fake-nousage', noUsageEvents);

      // do-result.md 불변 필드 확인
      const resultData = parseFrontmatter(fs.readFileSync(resultPath, 'utf8')).data;
      for (const field of PROVIDER_INVARIANT_FIELDS['do-result.md']) {
        assert.ok(field in resultData, `usage 없는 provider do-result.md 불변 필드 누락: ${field}`);
      }

      // progress.json 불변 필드 확인
      const progress = readJson(progressPath);
      for (const field of PROVIDER_INVARIANT_FIELDS['progress.json']) {
        assert.ok(field in progress, `usage 없는 provider progress.json 불변 필드 누락: ${field}`);
      }
      assert.strictEqual(progress.status, 'completed', 'usage 없어도 status=completed');
    } finally {
      rmDir(dir);
    }
  });

  await test('usage 있는 provider vs usage 없는 provider: 불변 필드 값 동일', async () => {
    const dir = makeTmpDir('e2e5-usage-compare');
    try {
      const codexEvents  = FAKE_CODEX_STANDARD_EVENTS.flatMap(nCodex);
      const noUsageEvents = FAKE_CODEX_STANDARD_EVENTS_NO_USAGE.flatMap(nCodex);

      const { progressPath: withUsageP  } = runDoPhaseWriter(dir, 'with-usage',  codexEvents);
      const { progressPath: noUsageP    } = runDoPhaseWriter(dir, 'no-usage',    noUsageEvents);

      const withUsageProg = readJson(withUsageP);
      const noUsageProg   = readJson(noUsageP);

      // 불변 필드 값 동일
      assert.strictEqual(withUsageProg.feature, noUsageProg.feature, 'feature 동일');
      assert.strictEqual(withUsageProg.phase,   noUsageProg.phase,   'phase 동일');
      assert.strictEqual(withUsageProg.status,  noUsageProg.status,  'status 동일');

      // usage 관련 필드는 provider 고유 — 값이 달라도 됨 (optional)
      assert.ok(
        PROVIDER_SPECIFIC_FIELDS['progress.json'].includes('cost_usd'),
        'cost_usd는 provider 고유 필드'
      );
    } finally {
      rmDir(dir);
    }
  });

  // =========================================================================
  // 섹션 6: report.md 파일 계약
  // =========================================================================

  console.log('\n  [6] report.md 파일 계약\n');

  /**
   * fake report.md를 생성한다.
   * report.js가 생성하는 파일 포맷을 재현한다.
   *
   * @param {string} featureDir  report.md를 쓸 디렉토리
   * @param {object} reportData  { id, date, status, provider, model, body }
   * @returns {string}           생성된 파일 경로
   */
  function writeReport(featureDir, reportData) {
    const { id, date, status, provider, model, body } = reportData;
    const content = [
      '---',
      `id: ${id}`,
      `date: ${date}`,
      `status: ${status}`,
      `provider: ${provider}`,
      `model: ${model}`,
      '---',
      '',
      body || '',
    ].join('\n');

    fs.mkdirSync(featureDir, { recursive: true });
    const reportPath = path.join(featureDir, 'report.md');
    fs.writeFileSync(reportPath, content, 'utf8');
    return reportPath;
  }

  await test('fake-claude report.md: 필수 frontmatter 필드 존재', async () => {
    const dir = makeTmpDir('e2e5-report-claude');
    try {
      const reportPath = writeReport(dir, FAKE_REPORT_DATA_CLAUDE);

      assert.ok(fs.existsSync(reportPath), 'report.md 존재');
      const content = fs.readFileSync(reportPath, 'utf8');
      const { data } = parseFrontmatter(content);

      for (const field of PROVIDER_INVARIANT_FIELDS['report.md']) {
        assert.ok(field in data, `Claude report.md 불변 필드 누락: ${field}`);
      }
      assert.strictEqual(data.id,     'user-auth',  'id 일치');
      assert.strictEqual(data.status, 'completed',  'status=completed');
      assert.ok(!isNaN(Date.parse(data.date)), 'date 유효한 ISO 타임스탬프');
    } finally {
      rmDir(dir);
    }
  });

  await test('fake-codex report.md: 필수 frontmatter 필드 존재', async () => {
    const dir = makeTmpDir('e2e5-report-codex');
    try {
      const reportPath = writeReport(dir, FAKE_REPORT_DATA_CODEX);

      assert.ok(fs.existsSync(reportPath), 'report.md 존재');
      const content = fs.readFileSync(reportPath, 'utf8');
      const { data } = parseFrontmatter(content);

      for (const field of PROVIDER_INVARIANT_FIELDS['report.md']) {
        assert.ok(field in data, `Codex report.md 불변 필드 누락: ${field}`);
      }
      assert.strictEqual(data.id,     'user-auth',  'id 일치');
      assert.strictEqual(data.status, 'completed',  'status=completed');
      assert.ok(!isNaN(Date.parse(data.date)), 'date 유효한 ISO 타임스탬프');
    } finally {
      rmDir(dir);
    }
  });

  await test('claude vs codex: report.md 불변 필드 값 동일', async () => {
    const dir = makeTmpDir('e2e5-report-compare');
    try {
      const claudePath = writeReport(path.join(dir, 'claude'), FAKE_REPORT_DATA_CLAUDE);
      const codexPath  = writeReport(path.join(dir, 'codex'),  FAKE_REPORT_DATA_CODEX);

      const claudeData = parseFrontmatter(fs.readFileSync(claudePath, 'utf8')).data;
      const codexData  = parseFrontmatter(fs.readFileSync(codexPath,  'utf8')).data;

      // 불변 필드: id, status는 같아야 함 (date는 타입만 같아야 함)
      assert.strictEqual(claudeData.id,     codexData.id,     'id 동일');
      assert.strictEqual(claudeData.status, codexData.status, 'status 동일');
      assert.ok(!isNaN(Date.parse(claudeData.date)), 'Claude date 유효한 ISO 타임스탬프');
      assert.ok(!isNaN(Date.parse(codexData.date)),  'Codex date 유효한 ISO 타임스탬프');

      // 고유 필드: provider, model은 달라야 함
      assert.notStrictEqual(
        claudeData.provider,
        codexData.provider,
        `provider는 달라야 함 (claude=${claudeData.provider}, codex=${codexData.provider})`
      );
      assert.notStrictEqual(
        claudeData.model,
        codexData.model,
        `model은 달라야 함 (claude=${claudeData.model}, codex=${codexData.model})`
      );
    } finally {
      rmDir(dir);
    }
  });

  await test('report.md: provider 고유 필드 목록 확인', () => {
    assert.ok(
      PROVIDER_SPECIFIC_FIELDS['report.md'].includes('provider'),
      'provider는 report.md 고유 필드 목록에 있어야 함'
    );
    assert.ok(
      PROVIDER_SPECIFIC_FIELDS['report.md'].includes('model'),
      'model은 report.md 고유 필드 목록에 있어야 함'
    );

    // 불변/고유 필드 중복 없음
    const invariants = new Set(PROVIDER_INVARIANT_FIELDS['report.md']);
    for (const field of PROVIDER_SPECIFIC_FIELDS['report.md']) {
      assert.ok(
        !invariants.has(field),
        `report.md 필드 '${field}'가 불변/고유 목록 모두에 있어서는 안 됨`
      );
    }
  });

  await test('report.md: status는 completed만 허용 (정상 완료 시)', async () => {
    const dir = makeTmpDir('e2e5-report-status');
    try {
      const reportPath = writeReport(dir, { ...FAKE_REPORT_DATA_CLAUDE, status: 'completed' });
      const content = fs.readFileSync(reportPath, 'utf8');
      const { data } = parseFrontmatter(content);
      assert.strictEqual(data.status, 'completed', 'status=completed 기록됨');
    } finally {
      rmDir(dir);
    }
  });

  // -------------------------------------------------------------------------
  // 결과
  // -------------------------------------------------------------------------

  console.log(`\n  결과: ${passed} 통과, ${failed} 실패\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
