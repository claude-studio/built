#!/usr/bin/env node
/**
 * report.js
 *
 * /built:report 스킬 헬퍼 — do-result.md + check-result.md를 기반으로 Report를 생성.
 * src/pipeline-runner.js를 호출해 최종 보고서를 생성하고
 * .built/features/<feature>/report.md를 저장한다.
 *
 * 사용법:
 *   node scripts/report.js <feature>
 *
 * 출력:
 *   완료 후: .built/features/<feature>/report.md 생성
 *            state.json status: completed 갱신
 *
 * Exit codes:
 *   0 — Report 성공
 *   1 — 오류 (feature 없음, do-result.md 없음, runPipeline 실패 등)
 *
 * 외부 npm 패키지 없음. MULTICA_AGENT_TIMEOUT 환경변수 지원.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { runPipeline } = require(path.join(__dirname, '..', 'src', 'pipeline-runner'));
const { updateState } = require(path.join(__dirname, '..', 'src', 'state'));
const { parse, stringify } = require(path.join(__dirname, '..', 'src', 'frontmatter'));
const { generateKgDraft } = require(path.join(__dirname, '..', 'src', 'kg-updater'));
const { parseProviderConfig, getProviderForPhase } = require(path.join(__dirname, '..', 'src', 'providers', 'config'));
const { createPhaseAbortController } = require(path.join(__dirname, '..', 'src', 'phase-abort'));

// ---------------------------------------------------------------------------
// 인자 파싱
// ---------------------------------------------------------------------------

const feature = process.argv[2];

if (!feature) {
  console.error('Usage: node scripts/report.js <feature>');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 경로 설정
// ---------------------------------------------------------------------------

const projectRoot     = process.cwd();
const controlRoot     = process.env.BUILT_PROJECT_ROOT || projectRoot;
const runtimeRootBase = process.env.BUILT_RUNTIME_ROOT || path.join(controlRoot, '.built', 'runtime');
const specPath        = path.join(projectRoot, '.built', 'features', `${feature}.md`);
const featureDir      = process.env.BUILT_RESULT_ROOT || path.join(projectRoot, '.built', 'features', feature);
const doResultPath    = path.join(featureDir, 'do-result.md');
const checkResultPath = path.join(featureDir, 'check-result.md');
const reportPath      = path.join(featureDir, 'report.md');
const runDir          = path.join(runtimeRootBase, 'runs', feature);

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
// 파일 읽기
// ---------------------------------------------------------------------------

const spec     = fs.readFileSync(specPath, 'utf8');
const doResult = fs.readFileSync(doResultPath, 'utf8');
const checkResult = fs.existsSync(checkResultPath)
  ? fs.readFileSync(checkResultPath, 'utf8')
  : '(check-result.md 없음)';

// ---------------------------------------------------------------------------
// run-request.json에서 provider 및 모델 읽기
// 기본값: claude provider, claude-haiku-4-5-20251001 모델
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
let model = DEFAULT_MODEL;
let providerSpec = { name: 'claude', model: DEFAULT_MODEL };
const runRequestPath = path.join(runDir, 'run-request.json');
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
      const providerConfig = parseProviderConfig(req);
      const resolved = getProviderForPhase(providerConfig, 'report');
      // report provider가 명시적으로 설정된 경우만 override
      if (providerConfig['report']) {
        providerSpec = resolved;
        if (providerSpec.model) model = providerSpec.model;
      } else {
        // 기본값: claude + haiku (model이 run-request에 있으면 해당 모델 유지)
        providerSpec = { name: 'claude', model };
      }
    } catch (err) {
      console.error(`[built:report] provider 설정 오류: ${err.message}`);
      process.exit(1);
    }
  }
}

// providerSpec.model이 있으면 model 동기화
if (providerSpec.model) {
  model = providerSpec.model;
} else {
  providerSpec = { ...providerSpec, model };
}

// ---------------------------------------------------------------------------
// Report 프롬프트 생성
// ---------------------------------------------------------------------------

const prompt = [
  'You are generating a final report for a completed software feature implementation.',
  'Based on the feature spec, implementation result, and review findings, write a comprehensive report.',
  '',
  `Feature: ${feature}`,
  '',
  '## Feature Spec',
  spec,
  '',
  '## Implementation Result (do-result.md)',
  doResult,
  '',
  '## Review Result (check-result.md)',
  checkResult,
  '',
  'Generate a concise report that includes:',
  '1. Summary of what was implemented',
  '2. Key decisions made during implementation',
  '3. Any issues found during review and how they were resolved',
  '4. Final status and next steps',
  '',
  'Format the report as Markdown with clear sections.',
].join('\n');

// ---------------------------------------------------------------------------
// pipeline 실행
// ---------------------------------------------------------------------------

console.log(`[built:report] feature: ${feature}`);
console.log(`[built:report] provider: ${providerSpec.name}`);
console.log(`[built:report] model: ${model}`);
console.log(`[built:report] result: ${reportPath}`);
console.log('[built:report] 보고서 생성 중...\n');

const abortControl = createPhaseAbortController({ label: 'built:report' });

runPipeline({
  prompt,
  model,
  runtimeRoot: featureDir,
  phase: 'report',
  featureId: feature,
  resultOutputPath: reportPath,
  providerSpec,
  signal: abortControl.signal,
}).then((result) => {
  abortControl.cleanup();
  if (!result.success) {
    console.error(`\n[built:report] 실패: ${result.error}`);

    // state.json 갱신 (실패)
    if (fs.existsSync(path.join(runDir, 'state.json'))) {
      try {
        updateState(runDir, { phase: 'report', status: 'failed', last_error: result.error });
      } catch (_) {}
    }

    process.exit(result.exitCode || 1);
  }

  // report.md frontmatter 재작성: id, date, status, model 형식으로 정규화
  if (fs.existsSync(reportPath)) {
    try {
      const raw = fs.readFileSync(reportPath, 'utf8');
      const { content } = parse(raw);
      const frontmatter = {
        id: feature,
        date: new Date().toISOString(),
        status: 'completed',
        provider: providerSpec.name,
        model,
      };
      fs.writeFileSync(reportPath, stringify(frontmatter, content), 'utf8');
    } catch (_) {}
  }

  // state.json 갱신 (완료)
  if (fs.existsSync(path.join(runDir, 'state.json'))) {
    try {
      updateState(runDir, { phase: 'report', status: 'completed', last_error: null });
    } catch (_) {}
  }

  // KG 초안 생성 (completed 시점 트리거)
  const pluginRoot = path.join(__dirname, '..');
  generateKgDraft({
    pluginRoot,
    feature,
    specPath,
    doResultPath,
    checkResultPath,
  });

  console.log('\n[built:report] 완료');
  console.log(`  report.md: ${reportPath}`);
  process.exit(0);
}).catch((err) => {
  abortControl.cleanup();
  console.error(`\n[built:report] 오류: ${err.message}`);
  process.exit(1);
});
