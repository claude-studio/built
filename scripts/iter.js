#!/usr/bin/env node
/**
 * iter.js
 *
 * /built:iter 스킬 헬퍼 — check-result.md가 needs_changes일 때 이전 산출물을 재주입해
 * Do 단계를 재실행하는 반복 루프.
 *
 * 사용법:
 *   node scripts/iter.js <feature>
 *
 * 동작:
 *   1. .built/features/<feature>/check-result.md 읽기 (frontmatter status 확인)
 *   2. status == approved → 즉시 종료 (이미 승인됨)
 *   3. status == needs_changes → Iter 루프 진입
 *      - 이전 do-result.md + check-result.md + feature-spec.md 재주입
 *      - pipeline-runner.js runPipeline()으로 Do 재실행
 *      - scripts/check.js 재실행 (Check 재수행)
 *      - 최대 BUILT_MAX_ITER 회 반복 (기본값 3)
 *      - 초과 시 상태 failed로 저장 후 종료
 *   4. state.json의 attempt 카운터 갱신 (파일이 있을 경우)
 *
 * 수렴 감지:
 *   - 연속 2회 이상 동일한 needs_changes 이슈 목록 → non_converging으로 종료
 *   - check-result.md의 "수정 필요 항목" 섹션 집합 비교
 *
 * 비용 상한:
 *   - BUILT_MAX_COST_USD 환경변수 설정 시, 각 iter 전 progress.json의 cost_usd 확인
 *   - 상한 초과 시 budget_exceeded 사유로 종료
 *
 * Exit codes:
 *   0 — approved 달성 또는 이미 approved
 *   1 — 오류 또는 최대 반복 초과 (수렴 불가)
 *
 * 외부 npm 패키지 없음. MULTICA_AGENT_TIMEOUT, BUILT_MAX_ITER, BUILT_MAX_COST_USD 환경변수 지원.
 */

'use strict';

const fs           = require('fs');
const path         = require('path');
const childProcess = require('child_process');

const { runPipeline }        = require(path.join(__dirname, '..', 'src', 'pipeline-runner'));
const { parse: parseFrontmatter } = require(path.join(__dirname, '..', 'src', 'frontmatter'));
const { updateState, readState }  = require(path.join(__dirname, '..', 'src', 'state'));
const { parseProviderConfig, getProviderForPhase } = require(path.join(__dirname, '..', 'src', 'providers/config'));

// ---------------------------------------------------------------------------
// 인자 파싱
// ---------------------------------------------------------------------------

const feature = process.argv[2];

if (!feature) {
  console.error('Usage: node scripts/iter.js <feature>');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 경로 설정
// ---------------------------------------------------------------------------

const projectRoot      = process.cwd();
const specPath         = path.join(projectRoot, '.built', 'features', `${feature}.md`);
const featureDir       = path.join(projectRoot, '.built', 'features', feature);
const doResultPath     = path.join(featureDir, 'do-result.md');
const checkResultPath  = path.join(featureDir, 'check-result.md');
const progressFilePath = path.join(featureDir, 'progress.json');
const runDir           = path.join(projectRoot, '.built', 'runtime', 'runs', feature);
const stateFilePath    = path.join(runDir, 'state.json');

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ITER = 3;

// ---------------------------------------------------------------------------
// 유틸: frontmatter status 읽기
// ---------------------------------------------------------------------------

/**
 * check-result.md 파일을 읽어 frontmatter status를 반환한다.
 *
 * @returns {'approved' | 'needs_changes' | null}
 */
function readCheckStatus() {
  if (!fs.existsSync(checkResultPath)) return null;
  const raw = fs.readFileSync(checkResultPath, 'utf8');
  try {
    const { data } = parseFrontmatter(raw);
    if (data.status === 'approved') return 'approved';
    if (data.status === 'needs_changes') return 'needs_changes';
    return null;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 유틸: check-result.md에서 이슈 목록 추출 (집합 비교용)
// ---------------------------------------------------------------------------

/**
 * check-result.md 본문의 "수정 필요 항목" 섹션에서 이슈 문자열 배열을 추출한다.
 * 섹션이 없거나 파일이 없으면 빈 배열을 반환한다.
 *
 * @returns {string[]}
 */
function extractCheckIssues() {
  if (!fs.existsSync(checkResultPath)) return [];
  try {
    const raw = fs.readFileSync(checkResultPath, 'utf8');
    const lines = raw.split('\n');
    const issues = [];
    let inIssueSection = false;
    for (const line of lines) {
      if (/^##\s+수정 필요 항목/.test(line)) {
        inIssueSection = true;
        continue;
      }
      if (inIssueSection) {
        if (/^##/.test(line)) break; // 다음 섹션 진입 시 중단
        const match = line.match(/^[-*]\s+(.+)/);
        if (match) issues.push(match[1].trim());
      }
    }
    return issues;
  } catch (_) {
    return [];
  }
}

/**
 * 두 이슈 목록이 동일한지 집합 비교한다 (대소문자 무시).
 * 둘 다 비어있으면 false를 반환한다 (비교 의미 없음).
 *
 * @param {string[]} a
 * @param {string[]} b
 * @returns {boolean}
 */
function issueSetEqual(a, b) {
  if (a.length === 0 && b.length === 0) return false;
  if (a.length !== b.length) return false;
  const normalize = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const setA = new Set(a.map(normalize));
  for (const item of b) {
    if (!setA.has(normalize(item))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 유틸: progress.json에서 누적 cost_usd 읽기
// ---------------------------------------------------------------------------

/**
 * progress.json의 cost_usd를 반환한다. 파일이 없거나 파싱 실패 시 0 반환.
 *
 * @returns {number}
 */
function readAccumulatedCost() {
  if (!fs.existsSync(progressFilePath)) return 0;
  try {
    const data = JSON.parse(fs.readFileSync(progressFilePath, 'utf8'));
    return typeof data.cost_usd === 'number' ? data.cost_usd : 0;
  } catch (_) {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// 유틸: state.json attempt 갱신 (파일이 있을 경우만)
// ---------------------------------------------------------------------------

function tryUpdateAttempt(attempt) {
  if (!fs.existsSync(stateFilePath)) return;
  try {
    updateState(runDir, { attempt, phase: 'iter', status: 'running' });
  } catch (_) {
    // state.json 갱신 실패는 무시 (iter 로직에 영향 없음)
  }
}

// ---------------------------------------------------------------------------
// 유틸: state.json failed 기록 (파일이 있을 경우만)
// ---------------------------------------------------------------------------

/**
 * @param {string} reason      last_error에 기록할 원인 문자열
 * @param {string} failureKind failure_kind 값 (retryable|needs_iteration|non_converging|worker_crashed|needs_replan)
 */
function tryMarkFailed(reason, failureKind) {
  if (!fs.existsSync(stateFilePath)) return;
  try {
    updateState(runDir, {
      status:       'failed',
      phase:        'iter',
      last_error:   reason,
      failure_kind: failureKind || 'needs_iteration',
    });
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// 유틸: check.js 서브프로세스 실행
// ---------------------------------------------------------------------------

/**
 * scripts/check.js를 서브프로세스로 실행한다.
 *
 * @returns {{ success: boolean, exitCode: number }}
 */
function runCheckScript() {
  const checkScriptPath = path.join(__dirname, 'check.js');
  const result = childProcess.spawnSync(process.execPath, [checkScriptPath, feature], {
    stdio: 'inherit',
    env: process.env,
    cwd: projectRoot,
  });

  const exitCode = result.status === null ? 1 : result.status;
  return { success: exitCode === 0, exitCode };
}

// ---------------------------------------------------------------------------
// 유효성 검사
// ---------------------------------------------------------------------------

if (!fs.existsSync(specPath)) {
  console.error(`Error: feature spec not found: ${specPath}`);
  console.error(`/built:plan ${feature} 를 먼저 실행해주세요.`);
  process.exit(1);
}

if (!fs.existsSync(checkResultPath)) {
  console.error(`Error: check-result.md not found: ${checkResultPath}`);
  console.error(`/built:check ${feature} 를 먼저 실행해주세요.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 환경변수 파싱
// ---------------------------------------------------------------------------

const maxIterRaw = process.env.BUILT_MAX_ITER;
const maxIter = (maxIterRaw && /^\d+$/.test(maxIterRaw.trim()))
  ? Math.max(1, parseInt(maxIterRaw.trim(), 10))
  : DEFAULT_MAX_ITER;

const maxCostRaw = process.env.BUILT_MAX_COST_USD;
const maxCostUsd = (maxCostRaw && /^\d*\.?\d+$/.test(maxCostRaw.trim()))
  ? parseFloat(maxCostRaw.trim())
  : null; // null → 상한 없음

// ---------------------------------------------------------------------------
// 모델 및 provider 읽기
// iter provider 우선순위: providers.iter → providers.do → Claude 기본값
// routing-matrix: iter는 do의 수정 루프이므로 provider/sandbox 정책이 같다.
// ---------------------------------------------------------------------------

let model;
let providerSpec = { name: 'claude' };
const runRequestPath = path.join(projectRoot, '.built', 'runtime', 'runs', feature, 'run-request.json');
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
      // providers.iter 설정이 있으면 우선 사용, 없으면 providers.do로 fallback
      if (providerConfig['iter']) {
        providerSpec = providerConfig['iter'];
      } else if (providerConfig['do']) {
        providerSpec = providerConfig['do'];
      }
    } catch (err) {
      console.error(`[built:iter] provider 설정 오류: ${err.message}`);
      process.exit(1);
    }
  }
}

if (providerSpec && providerSpec.model) {
  model = providerSpec.model;
}

// ---------------------------------------------------------------------------
// Iter 루프 메인 함수
// ---------------------------------------------------------------------------

async function runIter() {
  // 초기 상태 확인
  const initialStatus = readCheckStatus();

  if (initialStatus === 'approved') {
    console.log(`[built:iter] status: approved → 이미 승인됨. 반복 불필요.`);
    console.log(`\n다음 단계: /built:report ${feature}`);
    return 0;
  }

  if (initialStatus === null) {
    console.error(`[built:iter] 오류: check-result.md의 status를 읽을 수 없습니다.`);
    console.error(`  파일: ${checkResultPath}`);
    return 1;
  }

  // needs_changes — 루프 진입
  console.log(`[built:iter] feature: ${feature}`);
  console.log(`[built:iter] 최대 반복 횟수: ${maxIter}`);
  console.log(`[built:iter] provider: ${providerSpec.name}`);
  console.log(`[built:iter] model: ${model || '(default)'}`);
  if (maxCostUsd !== null) {
    console.log(`[built:iter] 비용 상한: $${maxCostUsd} (BUILT_MAX_COST_USD)`);
  }
  console.log(`[built:iter] status: needs_changes → Iter 루프 시작\n`);

  // 수렴 감지용: 이전 이슈 목록 추적
  let prevIssues = extractCheckIssues();

  for (let attempt = 1; attempt <= maxIter; attempt++) {
    console.log(`[built:iter] === 반복 ${attempt}/${maxIter} ===`);

    // ----- 비용 상한 확인 -----
    if (maxCostUsd !== null) {
      const accumulatedCost = readAccumulatedCost();
      if (accumulatedCost >= maxCostUsd) {
        const reason = `비용 상한 초과: $${accumulatedCost.toFixed(4)} >= $${maxCostUsd} (BUILT_MAX_COST_USD)`;
        console.error(`[built:iter] ${reason}`);
        tryMarkFailed(reason, 'retryable');
        return 1;
      }
      console.log(`[built:iter] 누적 비용: $${accumulatedCost.toFixed(4)} / 상한 $${maxCostUsd}`);
    }

    // state.json attempt 갱신
    tryUpdateAttempt(attempt);

    // ----- Do 재실행 -----

    // 현재 산출물 읽기
    const spec     = fs.readFileSync(specPath, 'utf8');
    const doResult = fs.existsSync(doResultPath)
      ? fs.readFileSync(doResultPath, 'utf8')
      : '(이전 결과 없음)';
    const checkResult = fs.readFileSync(checkResultPath, 'utf8');

    // Iter 프롬프트 구성: 이전 산출물 + 검토 피드백 재주입
    const iterPrompt = [
      'You are re-implementing a feature for a software project.',
      'The previous implementation was reviewed and needs changes.',
      'Carefully read the review feedback and fix all the issues listed.',
      '',
      `Feature: ${feature}`,
      `Iteration: ${attempt} of ${maxIter}`,
      '',
      '## Feature Spec',
      spec,
      '',
      '## Previous Implementation (do-result.md)',
      doResult,
      '',
      '## Review Feedback (check-result.md)',
      checkResult,
      '',
      'Re-implement the feature now, addressing ALL issues from the review feedback.',
      'Follow the Build Plan step by step from the Feature Spec.',
      'Make sure every item listed in the review issues is resolved.',
    ].join('\n');

    console.log(`[built:iter] Do 재실행 중...`);

    const doRunResult = await runPipeline({
      prompt: iterPrompt,
      model,
      runtimeRoot: featureDir,
      phase: 'iter',
      featureId: feature,
      resultOutputPath: doResultPath,
      providerSpec,
    });

    if (!doRunResult.success) {
      console.error(`[built:iter] Do 실패 (반복 ${attempt}): ${doRunResult.error}`);
      if (attempt === maxIter) {
        tryMarkFailed(
          `Do 단계 실패 (반복 ${attempt}/${maxIter}): ${doRunResult.error}`,
          'worker_crashed'
        );
        console.error(`\n[built:iter] 최대 반복 횟수 초과. 수렴 불가.`);
        return 1;
      }
      console.log(`[built:iter] 다음 반복으로 계속...`);
      continue;
    }

    console.log(`[built:iter] Do 완료. Check 재실행 중...`);

    // ----- Check 재실행 -----

    const checkRunResult = runCheckScript();

    if (!checkRunResult.success) {
      console.error(`[built:iter] Check 실패 (반복 ${attempt}): exit code ${checkRunResult.exitCode}`);
      if (attempt === maxIter) {
        tryMarkFailed(
          `Check 단계 실패 (반복 ${attempt}/${maxIter})`,
          'worker_crashed'
        );
        console.error(`\n[built:iter] 최대 반복 횟수 초과. 수렴 불가.`);
        return 1;
      }
      console.log(`[built:iter] 다음 반복으로 계속...`);
      continue;
    }

    // 새 check-result.md 읽기
    const newStatus = readCheckStatus();

    if (newStatus === 'approved') {
      console.log(`\n[built:iter] approved 달성 (반복 ${attempt}/${maxIter})`);
      console.log(`  check-result.md: ${checkResultPath}`);
      console.log(`\n다음 단계: /built:report ${feature}`);
      return 0;
    }

    console.log(`[built:iter] 반복 ${attempt}: status=${newStatus || 'unknown'} → 아직 needs_changes`);

    // ----- 수렴 감지 -----
    const currentIssues = extractCheckIssues();
    if (issueSetEqual(prevIssues, currentIssues)) {
      const reason = `수렴 실패: 연속 2회 동일한 needs_changes 이슈 감지 (반복 ${attempt}/${maxIter})`;
      console.error(`\n[built:iter] ${reason}`);
      console.error(`  동일 이슈 목록: ${currentIssues.join(', ') || '(없음)'}`);
      tryMarkFailed(reason, 'non_converging');
      return 1;
    }
    prevIssues = currentIssues;

    if (attempt === maxIter) {
      break;
    }
  }

  // 최대 반복 초과
  tryMarkFailed(
    `최대 반복 횟수 초과 (${maxIter}회). 수렴 불가.`,
    'non_converging'
  );
  console.error(`\n[built:iter] 최대 반복 횟수 (${maxIter})를 초과했습니다. 수렴 불가.`);
  console.error(`  check-result.md를 확인하고 수동으로 개입이 필요합니다.`);
  return 1;
}

// ---------------------------------------------------------------------------
// 실행 진입점
// ---------------------------------------------------------------------------

runIter().then((exitCode) => {
  process.exit(exitCode);
}).catch((err) => {
  console.error(`\n[built:iter] 예상치 못한 오류: ${err.message}`);
  process.exit(1);
});
