#!/usr/bin/env node
/**
 * plan-synthesis.js
 *
 * .built/runtime/runs/<feature>/run-request.json의 provider 설정을 읽어
 * plan_synthesis phase를 실행하고 canonical 산출물을 저장한다.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { runPipeline } = require(path.join(__dirname, '..', 'src', 'pipeline-runner'));
const { parseProviderConfig, getProviderForPhase } = require(path.join(__dirname, '..', 'src', 'providers/config'));
const {
  PLAN_SYNTHESIS_SCHEMA,
  buildPlanSynthesisInput,
  buildPlanSynthesisPrompt,
  normalizePlanSynthesisOutput,
  writePlanSynthesisOutput,
} = require(path.join(__dirname, '..', 'src', 'plan-synthesis'));
const { createPhaseAbortController } = require(path.join(__dirname, '..', 'src', 'phase-abort'));
const {
  buildRootContext,
  writeRootContext,
  formatRootContext,
} = require(path.join(__dirname, '..', 'src', 'root-context'));

const feature = process.argv[2];

if (!feature) {
  console.error('Usage: node scripts/plan-synthesis.js <feature>');
  process.exit(1);
}

const projectRoot      = process.cwd();
const controlRoot      = process.env.BUILT_PROJECT_ROOT || projectRoot;
const runtimeRootBase  = process.env.BUILT_RUNTIME_ROOT || path.join(controlRoot, '.built', 'runtime');
const runDir           = path.join(runtimeRootBase, 'runs', feature);
const runRequestPath   = path.join(runDir, 'run-request.json');
const runtimeRoot      = process.env.BUILT_RESULT_ROOT || path.join(projectRoot, '.built', 'features', feature);
const resultOutputPath = path.join(runtimeRoot, 'plan-synthesis-result.md');
const rootContextPath  = path.join(runtimeRoot, 'root-context.json');
const planSynthesisPaths = {
  jsonPath: path.join(runtimeRoot, 'plan-synthesis.json'),
  mdPath:   path.join(runtimeRoot, 'plan-synthesis.md'),
};

function readRunRequest() {
  try {
    return JSON.parse(fs.readFileSync(runRequestPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

const runRequest = readRunRequest();
let providerConfig;
try {
  providerConfig = parseProviderConfig(runRequest);
} catch (err) {
  console.error(`[built:plan_synthesis] provider 설정 오류: ${err.message}`);
  process.exit(1);
}

const providerSpec = getProviderForPhase(providerConfig, 'plan_synthesis');
const model = providerSpec.model || (runRequest && runRequest.model) || undefined;

let payload;
try {
  payload = buildPlanSynthesisInput({ projectRoot, feature, runRequest });
} catch (err) {
  console.error(`[built:plan_synthesis] 입력 payload 생성 실패: ${err.message}`);
  process.exit(1);
}

const prompt = buildPlanSynthesisPrompt(payload);

console.log(`[built:plan_synthesis] feature: ${feature}`);
console.log(`[built:plan_synthesis] provider: ${providerSpec.name}`);
console.log(`[built:plan_synthesis] result:   ${planSynthesisPaths.jsonPath}`);
const rootContext = buildRootContext({
  phase: 'plan_synthesis',
  feature,
  projectRoot: controlRoot,
  executionRoot: projectRoot,
  runtimeRoot: runtimeRootBase,
  resultRoot: runtimeRoot,
  artifactPaths: {
    run_request: runRequestPath,
    plan_synthesis_json: planSynthesisPaths.jsonPath,
    plan_synthesis_md: planSynthesisPaths.mdPath,
    root_context: rootContextPath,
  },
});
writeRootContext(rootContextPath, rootContext);
console.log(formatRootContext(rootContext));
console.log('[built:plan_synthesis] 실행 중...\n');

const abortControl = createPhaseAbortController({ label: 'built:plan_synthesis' });

runPipeline({
  prompt,
  model,
  runtimeRoot,
  phase: 'plan_synthesis',
  featureId: feature,
  resultOutputPath,
  jsonSchema: JSON.stringify(PLAN_SYNTHESIS_SCHEMA),
  providerSpec,
  signal: abortControl.signal,
}).then((result) => {
  abortControl.cleanup();
  if (!result.success) {
    console.error(`\n[built:plan_synthesis] 실패: ${result.error}`);
    process.exit(result.exitCode || 1);
    return;
  }

  const rawOutput = result.structuredOutput || result.text || '';
  const output = normalizePlanSynthesisOutput(rawOutput, payload);
  const paths = writePlanSynthesisOutput({ projectRoot, feature, resultRoot: runtimeRoot, output, providerSpec: { ...providerSpec, model } });

  console.log('\n[built:plan_synthesis] 완료');
  console.log(`  plan-synthesis.json: ${paths.jsonPath}`);
  console.log(`  plan-synthesis.md:   ${paths.mdPath}`);
  process.exit(0);
}).catch((err) => {
  abortControl.cleanup();
  console.error(`\n[built:plan_synthesis] 오류: ${err.message}`);
  process.exit(1);
});
