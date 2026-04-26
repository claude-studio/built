#!/usr/bin/env node
/**
 * check.js
 *
 * /built:check 스킬 헬퍼 — feature spec + do-result.md를 읽어 Check 단계를 실행.
 * src/pipeline-runner.js를 --json-schema 모드로 호출해 구조화 응답을 받고
 * .built/features/<feature>/check-result.md를 생성한다.
 *
 * 사용법:
 *   node scripts/check.js <feature>
 *
 * 출력:
 *   완료 후: .built/features/<feature>/check-result.md 생성
 *            frontmatter status: needs_changes | approved
 *
 * Exit codes:
 *   0 — Check 성공
 *   1 — 오류 (feature 없음, do-result.md 없음, runPipeline 실패 등)
 *
 * 외부 npm 패키지 없음. MULTICA_AGENT_TIMEOUT 환경변수 지원.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { runPipeline } = require(path.join(__dirname, '..', 'src', 'pipeline-runner'));
const { checkKg }    = require(path.join(__dirname, '..', 'src', 'kg-checker'));
const { readRecentDriftSignals } = require(path.join(__dirname, '..', 'src', 'kg-signals'));
const { parseProviderConfig, getProviderForPhase } = require(path.join(__dirname, '..', 'src', 'providers', 'config'));

// ---------------------------------------------------------------------------
// Check 단계에서 사용할 JSON Schema
// ---------------------------------------------------------------------------

const CHECK_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: ['needs_changes', 'approved'],
      description: 'needs_changes: 수정 필요, approved: 검토 통과',
    },
    issues: {
      type: 'array',
      items: { type: 'string' },
      description: '수정이 필요한 항목 목록 (approved 시 빈 배열)',
    },
    acceptance_criteria_results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criterion: { type: 'string', description: '완료 기준 항목 원문' },
          passed: { type: 'boolean', description: '충족 여부' },
        },
        required: ['criterion', 'passed'],
      },
      description: 'feature-spec 완료 기준 항목별 충족 여부 (항목이 없으면 빈 배열)',
    },
    summary: {
      type: 'string',
      description: '검토 결과 요약',
    },
  },
  required: ['status', 'summary'],
});

// ---------------------------------------------------------------------------
// 인자 파싱
// ---------------------------------------------------------------------------

const feature = process.argv[2];

if (!feature) {
  console.error('Usage: node scripts/check.js <feature>');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 경로 설정
// ---------------------------------------------------------------------------

const projectRoot      = process.cwd();
const controlRoot      = process.env.BUILT_PROJECT_ROOT || projectRoot;
const runtimeRootBase  = process.env.BUILT_RUNTIME_ROOT || path.join(controlRoot, '.built', 'runtime');
const specPath         = path.join(projectRoot, '.built', 'features', `${feature}.md`);
const featureDir       = process.env.BUILT_RESULT_ROOT || path.join(projectRoot, '.built', 'features', feature);
const doResultPath     = path.join(featureDir, 'do-result.md');
const checkResultPath  = path.join(featureDir, 'check-result.md');

// ---------------------------------------------------------------------------
// 유효성 검사
// ---------------------------------------------------------------------------

if (!fs.existsSync(specPath)) {
  console.error(`Error: feature spec not found: ${specPath}`);
  console.error(`/built:plan ${feature} 를 먼저 실행해주세요.`);
  process.exit(1);
}

if (!fs.existsSync(doResultPath)) {
  console.error(`Error: do-result.md not found: ${doResultPath}`);
  console.error(`/built:do ${feature} 를 먼저 실행해주세요.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// feature spec + do-result.md 읽기
// ---------------------------------------------------------------------------

const spec     = fs.readFileSync(specPath, 'utf8');
const doResult = fs.readFileSync(doResultPath, 'utf8');

// ---------------------------------------------------------------------------
// run-request.json에서 모델 및 provider 설정 읽기 (선택)
// ---------------------------------------------------------------------------

let model;
let providerSpec = { name: 'claude' };
const runRequestPath = path.join(runtimeRootBase, 'runs', feature, 'run-request.json');
if (fs.existsSync(runRequestPath)) {
  let req;
  try {
    req = JSON.parse(fs.readFileSync(runRequestPath, 'utf8'));
  } catch (_) {
    req = null;
  }

  if (req) {
    if (req.model) model = req.model;
    try {
      providerSpec = getProviderForPhase(parseProviderConfig(req), 'check');
    } catch (err) {
      console.error(`[built:check] provider 설정 오류: ${err.message}`);
      process.exit(1);
    }
  }
}

if (providerSpec && providerSpec.model) {
  model = providerSpec.model;
}

// ---------------------------------------------------------------------------
// Check 프롬프트 생성
// ---------------------------------------------------------------------------

const prompt = [
  'You are a code reviewer for a software project.',
  'Review the implementation against the feature spec and provide structured feedback.',
  '',
  `Feature: ${feature}`,
  '',
  '## Feature Spec (feature-spec.md)',
  spec,
  '',
  '## Implementation Result (do-result.md)',
  doResult,
  '',
  'Review the implementation carefully:',
  '1. Does it fulfill ALL acceptance criteria listed in the Feature Spec above?',
  '   - Extract each acceptance criterion from the spec and check it individually.',
  '2. Are there any bugs, missing edge cases, or incomplete parts?',
  '3. Does it follow the build plan steps outlined in the spec?',
  '',
  'Respond with:',
  '- status: "approved" if all acceptance criteria are met, "needs_changes" if any are not',
  '- issues: list of specific items that need to be fixed (empty array if approved)',
  '- acceptance_criteria_results: for each acceptance criterion in the spec, provide {criterion, passed}',
  '- summary: brief summary of your review findings',
].join('\n');

// ---------------------------------------------------------------------------
// pipeline 실행 (--json-schema 모드)
// ---------------------------------------------------------------------------

console.log(`[built:check] feature: ${feature}`);
console.log(`[built:check] provider: ${providerSpec.name}`);
console.log(`[built:check] model: ${model || '(default)'}`);
console.log(`[built:check] result: ${checkResultPath}`);
console.log('[built:check] 검토 중...\n');

const checkStartTime = Date.now();

runPipeline({
  prompt,
  model,
  runtimeRoot: featureDir,
  phase: 'check',
  featureId: feature,
  jsonSchema: CHECK_SCHEMA,
  providerSpec,
}).then((result) => {
  const checkDurationMs = Date.now() - checkStartTime;
  if (!result.success) {
    console.error(`\n[built:check] 실패: ${result.error}`);
    process.exit(result.exitCode || 1);
  }

  // structuredOutput 파싱
  const output = result.structuredOutput;
  if (!output || typeof output.status !== 'string') {
    console.error('\n[built:check] 오류: 구조화 응답 파싱 실패 - status 필드 없음');
    process.exit(1);
  }

  const status = output.status === 'approved' ? 'approved' : 'needs_changes';
  const issues = Array.isArray(output.issues) ? output.issues : [];
  const summary = typeof output.summary === 'string' ? output.summary : '';
  const acResults = Array.isArray(output.acceptance_criteria_results)
    ? output.acceptance_criteria_results.filter(
        (r) => r && typeof r.criterion === 'string' && typeof r.passed === 'boolean'
      )
    : [];

  // ---------------------------------------------------------------------------
  // check-result.md 생성
  // ---------------------------------------------------------------------------

  const now = new Date().toISOString();

  let issuesSection = '';
  if (issues.length > 0) {
    issuesSection = '\n## 수정 필요 항목\n\n' + issues.map((item) => `- ${item}`).join('\n') + '\n';
  }

  let acSection = '';
  if (acResults.length > 0) {
    acSection = '\n## 완료 기준 충족 여부\n\n' +
      acResults.map((r) => `- [${r.passed ? 'x' : ' '}] ${r.criterion}`).join('\n') + '\n';
  }

  // KG 일관성 검사 (built 플러그인 kg/ 기준, 비차단 정보 섹션)
  const pluginRoot = path.join(__dirname, '..');
  const kgResult = checkKg(pluginRoot);
  let kgSection = '';
  if (kgResult.findings.length > 0) {
    kgSection = '\n## KG 일관성\n\n' + kgResult.summary + '\n\n' +
      kgResult.findings.map((f) => `- ${f}`).join('\n') + '\n';
  }

  // 방향성 신호 (최근 review 시계열 기반, 비차단 정보 섹션)
  const signalResult = readRecentDriftSignals({
    kgDir: path.join(pluginRoot, 'kg'),
    days: 7,
    minConsecutive: 2,
  });
  let signalSection = '';
  if (signalResult.signals.length > 0) {
    signalSection = '\n## 방향성 신호 (KG)\n\n' +
      signalResult.signals.map((s) => `- ${s.message}`).join('\n') + '\n';
  }

  const content = [
    '---',
    `feature: ${feature}`,
    `status: ${status}`,
    `checked_at: ${now}`,
    `provider: ${providerSpec.name}`,
    `model: ${model || null}`,
    `duration_ms: ${checkDurationMs}`,
    '---',
    '',
    '## 검토 결과',
    '',
    summary,
    acSection,
    issuesSection,
    kgSection,
    signalSection,
  ].join('\n');

  // 디렉토리 생성 (없을 경우)
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(checkResultPath, content, 'utf8');

  console.log(`\n[built:check] 완료 (${status})`);
  console.log(`  check-result.md: ${checkResultPath}`);

  if (kgResult.findings.length > 0) {
    console.log(`\n[built:check] KG 일관성 이슈 ${kgResult.findings.length}개:`);
    kgResult.findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  }

  if (signalResult.signals.length > 0) {
    console.log(`\n[built:check] 방향성 신호 ${signalResult.signals.length}개:`);
    signalResult.signals.forEach((s, i) => console.log(`  ${i + 1}. ${s.message}`));
  }

  if (status === 'needs_changes') {
    console.log('\n수정이 필요한 항목:');
    issues.forEach((item, i) => console.log(`  ${i + 1}. ${item}`));
    console.log('\n다음 단계: /built:iter <feature>');
  } else {
    console.log('\n다음 단계: /built:report <feature>');
  }

  process.exit(0);
}).catch((err) => {
  console.error(`\n[built:check] 오류: ${err.message}`);
  process.exit(1);
});
