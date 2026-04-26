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
const { parseProviderConfig, getProviderForPhase } = require(path.join(__dirname, '..', 'src', 'providers/config'));
const { readPlanSynthesisOutput } = require(path.join(__dirname, '..', 'src', 'plan-synthesis'));
const { createPhaseAbortController } = require(path.join(__dirname, '..', 'src', 'phase-abort'));

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
// kg/decisions + kg/issues 컨텍스트 로드 (없으면 skip)
// ---------------------------------------------------------------------------

/**
 * 디렉토리의 *.md 파일을 읽어 배열로 반환. 디렉토리 없으면 빈 배열.
 */
function loadMdFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .map(f => {
        try { return fs.readFileSync(path.join(dir, f), 'utf8').trim(); }
        catch (_) { return null; }
      })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

const kgRoot        = path.join(projectRoot, 'kg');
const decisions     = loadMdFiles(path.join(kgRoot, 'decisions'));
const issues        = loadMdFiles(path.join(kgRoot, 'issues'));

// ---------------------------------------------------------------------------
// run-request.json에서 모델 읽기 (선택)
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
      providerSpec = getProviderForPhase(parseProviderConfig(req), 'do');
    } catch (err) {
      console.error(`[built:do] provider 설정 오류: ${err.message}`);
      process.exit(1);
    }
  }
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

if (decisions.length > 0 || issues.length > 0) {
  promptParts.push('', '## Prior Decisions (kg/)');
  if (decisions.length > 0) {
    promptParts.push('', '### Architecture Decisions');
    decisions.forEach(d => promptParts.push('', d));
  }
  if (issues.length > 0) {
    promptParts.push('', '### Issue History');
    issues.forEach(i => promptParts.push('', i));
  }
}

promptParts.push(
  '',
  'Implement this feature now.',
  'Follow the Build Plan step by step: Schema → Core → Structure → States → Integration → Polish.',
  'After completing each step, briefly note what was done before moving to the next step.',
);

const prompt = promptParts.join('\n');

// ---------------------------------------------------------------------------
// pipeline 실행
// ---------------------------------------------------------------------------

console.log(`[built:do] feature: ${feature}`);
console.log(`[built:do] provider: ${providerSpec.name}`);
console.log(`[built:do] model: ${model || '(default)'}`);
console.log(`[built:do] result:   ${resultOutputPath}`);
console.log(`[built:do] progress: ${path.join(runtimeRoot, 'progress.json')}`);
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
