#!/usr/bin/env node
/**
 * do.js
 *
 * /built:do 스킬 헬퍼 — feature spec을 읽어 Do 단계를 포그라운드로 실행.
 * src/pipeline-runner.js를 호출해 claude -p 서브세션을 spawn.
 *
 * 사용법:
 *   node scripts/do.js <feature>
 *
 * 출력:
 *   실행 중: stream-json stdout이 progress-writer를 통해 처리됨
 *   완료 후: .built/features/<feature>/do-result.md 생성
 *            .built/features/<feature>/progress.json 실시간 갱신
 *
 * Exit codes:
 *   0 — Do 성공
 *   1 — 오류 (feature 없음, runPipeline 실패 등)
 *
 * 외부 npm 패키지 없음. MULTICA_AGENT_TIMEOUT 환경변수 지원.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { runPipeline } = require(path.join(__dirname, '..', 'src', 'pipeline-runner'));
const { readPlanSynthesisOutput } = require(path.join(__dirname, '..', 'src', 'plan-synthesis'));
const { createPhaseAbortController } = require(path.join(__dirname, '..', 'src', 'phase-abort'));
const { getPromptBudgetFromEnv, buildDoKgContext } = require(path.join(__dirname, 'do-kg-context'));
const {
  readRunRequest,
  readBuiltConfig,
  hasRunRequestProvidersField,
  resolvePhaseProvider,
  printRunRequestParseFailure,
  printProviderConfigFailure,
} = require(path.join(__dirname, '..', 'src', 'run-request'));

// ---------------------------------------------------------------------------
// 인자 파싱
// ---------------------------------------------------------------------------

const feature = process.argv[2];

if (!feature) {
  console.error('Usage: node scripts/do.js <feature>');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 경로 설정
// ---------------------------------------------------------------------------

const projectRoot      = process.cwd();
const controlRoot      = process.env.BUILT_PROJECT_ROOT || projectRoot;
const runtimeRootBase  = process.env.BUILT_RUNTIME_ROOT || path.join(controlRoot, '.built', 'runtime');
const specPath         = path.join(projectRoot, '.built', 'features', `${feature}.md`);
const runtimeRoot      = process.env.BUILT_RESULT_ROOT || path.join(projectRoot, '.built', 'features', feature);
const resultOutputPath = path.join(runtimeRoot, 'do-result.md');

// ---------------------------------------------------------------------------
// 유효성 검사
// ---------------------------------------------------------------------------

if (!fs.existsSync(specPath)) {
  console.error(`Error: feature spec not found: ${specPath}`);
  console.error(`/built:plan ${feature} 를 먼저 실행해주세요.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// feature spec 읽기
// ---------------------------------------------------------------------------

const spec = fs.readFileSync(specPath, 'utf8');

// ---------------------------------------------------------------------------
// run-request.json에서 모델 읽기 (선택)
// ---------------------------------------------------------------------------

let model;
let providerSpec = { name: 'claude' };
let runRequest = null;
const runRequestPath = path.join(runtimeRootBase, 'runs', feature, 'run-request.json');
try {
  runRequest = readRunRequest(runRequestPath);
} catch (err) {
  printRunRequestParseFailure('built:do', err);
  process.exit(1);
}

if (runRequest && runRequest.model) model = runRequest.model;

try {
  const builtConfig = readBuiltConfig(controlRoot);
  providerSpec = resolvePhaseProvider({ runRequest, builtConfig, phase: 'do' }).providerSpec;
} catch (err) {
  const configSourcePath = hasRunRequestProvidersField(runRequest)
    ? runRequestPath
    : path.join(controlRoot, '.built', 'config.json');
  printProviderConfigFailure('built:do', configSourcePath, err);
  process.exit(1);
}

if (providerSpec && providerSpec.model) {
  model = providerSpec.model;
}

// ---------------------------------------------------------------------------
// Do 프롬프트 생성
// ---------------------------------------------------------------------------

const promptParts = [
  'You are implementing a feature for a software project.',
  'Read the feature spec carefully and implement it step by step following the Build Plan.',
  '',
  `Feature: ${feature}`,
  '',
  spec,
];

const planSynthesis = readPlanSynthesisOutput(projectRoot, feature);
if (planSynthesis) {
  promptParts.push(
    '',
    '## Plan Synthesis',
    '',
    'Use this canonical plan_synthesis output as the implementation plan.',
    '',
    JSON.stringify(planSynthesis, null, 2),
  );
}

const finalInstructions = [
  '',
  'Implement this feature now.',
  'Follow the Build Plan step by step: Schema → Core → Structure → States → Integration → Polish.',
  'After completing each step, briefly note what was done before moving to the next step.',
];

const promptBudget = getPromptBudgetFromEnv();
const nonKgPromptChars = promptParts.join('\n').length + finalInstructions.join('\n').length + 2;
const maxKgChars = Math.max(0, promptBudget.maxChars - nonKgPromptChars);
const kgContext = buildDoKgContext({
  projectRoot,
  featureSpec: spec,
  planSynthesis,
  providerSpec,
  runRequest,
  maxSectionChars: maxKgChars,
});

if (kgContext.text) {
  promptParts.push(kgContext.text);
}

promptParts.push(...finalInstructions);

const prompt = promptParts.join('\n');

if (prompt.length > promptBudget.maxChars) {
  console.error(`[built:do] prompt budget 초과: chars=${prompt.length}, max=${promptBudget.maxChars}`);
  console.error('[built:do] feature spec 또는 plan_synthesis가 너무 커서 provider 실행 전에 중단합니다.');
  process.exit(1);
}

if (prompt.length >= promptBudget.warnChars) {
  console.warn(`[built:do] prompt budget 경고: chars=${prompt.length}, warn=${promptBudget.warnChars}, max=${promptBudget.maxChars}`);
}

// ---------------------------------------------------------------------------
// pipeline 실행
// ---------------------------------------------------------------------------

console.log(`[built:do] feature: ${feature}`);
console.log(`[built:do] provider: ${providerSpec.name}`);
console.log(`[built:do] model: ${model || '(default)'}`);
console.log(`[built:do] result:   ${resultOutputPath}`);
console.log(`[built:do] progress: ${path.join(runtimeRoot, 'progress.json')}`);
console.log(`[built:do] prompt chars: ${prompt.length}/${promptBudget.maxChars}`);
console.log(`[built:do] kg context: full=${kgContext.stats.full_docs}, indexed_decisions=${kgContext.stats.indexed_decisions}, indexed_issues=${kgContext.stats.indexed_issues}, skipped_decisions=${kgContext.stats.skipped_decisions}, skipped_issues=${kgContext.stats.skipped_issues}, chars=${kgContext.stats.chars}`);
console.log('[built:do] 실행 중...\n');

const abortControl = createPhaseAbortController({ label: 'built:do' });

runPipeline({
  prompt,
  model,
  runtimeRoot,
  phase: 'do',
  featureId: feature,
  resultOutputPath,
  providerSpec,
  signal: abortControl.signal,
}).then((result) => {
  abortControl.cleanup();
  if (result.success) {
    console.log('\n[built:do] 완료');
    console.log(`  do-result.md: ${resultOutputPath}`);
    process.exit(0);
  } else {
    console.error(`\n[built:do] 실패: ${result.error}`);
    process.exit(result.exitCode || 1);
  }
}).catch((err) => {
  abortControl.cleanup();
  console.error(`\n[built:do] 오류: ${err.message}`);
  process.exit(1);
});
