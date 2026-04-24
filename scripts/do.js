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
const specPath         = path.join(projectRoot, '.built', 'features', `${feature}.md`);
const runtimeRoot      = path.join(projectRoot, '.built', 'features', feature);
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
// 이미 실행 중 여부 확인
// ---------------------------------------------------------------------------

const stateFile = path.join(runtimeRoot, 'state.json');
if (fs.existsSync(stateFile)) {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (state.status === 'running') {
      console.error(`Error: 이미 실행 중입니다 (pid: ${state.pid || 'unknown'})`);
      console.error(`상태 파일: ${stateFile}`);
      process.exit(1);
    }
  } catch (_) {
    // 파싱 실패 시 무시하고 계속
  }
}

// ---------------------------------------------------------------------------
// feature spec 읽기
// ---------------------------------------------------------------------------

const spec = fs.readFileSync(specPath, 'utf8');

// ---------------------------------------------------------------------------
// run-request.json에서 모델 읽기 (선택)
// ---------------------------------------------------------------------------

let model;
const runRequestPath = path.join(projectRoot, '.built', 'runtime', 'runs', feature, 'run-request.json');
if (fs.existsSync(runRequestPath)) {
  try {
    const req = JSON.parse(fs.readFileSync(runRequestPath, 'utf8'));
    if (req.model) model = req.model;
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Do 프롬프트 생성
// ---------------------------------------------------------------------------

const prompt = [
  'You are implementing a feature for a software project.',
  'Read the feature spec carefully and implement it step by step following the Build Plan.',
  '',
  `Feature: ${feature}`,
  '',
  spec,
  '',
  'Implement this feature now.',
  'Follow the Build Plan step by step: Schema → Core → Structure → States → Integration → Polish.',
  'After completing each step, briefly note what was done before moving to the next step.',
].join('\n');

// ---------------------------------------------------------------------------
// pipeline 실행
// ---------------------------------------------------------------------------

console.log(`[built:do] feature: ${feature}`);
console.log(`[built:do] model: ${model || '(default)'}`);
console.log(`[built:do] result:   ${resultOutputPath}`);
console.log(`[built:do] progress: ${path.join(runtimeRoot, 'progress.json')}`);
console.log('[built:do] 실행 중...\n');

runPipeline({
  prompt,
  model,
  runtimeRoot,
  phase: 'do',
  featureId: feature,
  resultOutputPath,
}).then((result) => {
  if (result.success) {
    console.log('\n[built:do] 완료');
    console.log(`  do-result.md: ${resultOutputPath}`);
    process.exit(0);
  } else {
    console.error(`\n[built:do] 실패: ${result.error}`);
    process.exit(result.exitCode || 1);
  }
}).catch((err) => {
  console.error(`\n[built:do] 오류: ${err.message}`);
  process.exit(1);
});
