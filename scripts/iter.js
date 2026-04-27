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
const { createPhaseAbortController } = require(path.join(__dirname, '..', 'src', 'phase-abort'));
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
  console.error('Usage: node scripts/iter.js <feature>');
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
const progressFilePath = path.join(featureDir, 'progress.json');
const runDir           = path.join(runtimeRootBase, 'runs', feature);
const stateFilePath    = path.join(runDir, 'state.json');

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ITER = 3;
const DEFAULT_MAX_ITER_PROMPT_CHARS = 200000;
const DEFAULT_WARN_ITER_PROMPT_CHARS = 160000;
const MIN_ITER_ARTIFACT_CHARS = 1000;

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

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getIterPromptBudgetFromEnv(env = process.env) {
  return {
    maxChars: parsePositiveInt(env.BUILT_ITER_PROMPT_MAX_CHARS, DEFAULT_MAX_ITER_PROMPT_CHARS),
    warnChars: parsePositiveInt(env.BUILT_ITER_PROMPT_WARN_CHARS, DEFAULT_WARN_ITER_PROMPT_CHARS),
  };
}

function splitFrontmatter(raw) {
  if (!raw || !raw.startsWith('---\n')) return { frontmatter: '', body: raw || '' };
  const end = raw.indexOf('\n---', 4);
  if (end === -1) return { frontmatter: '', body: raw || '' };
  return {
    frontmatter: raw.slice(0, end + 4).trim(),
    body: raw.slice(end + 4).trim(),
  };
}

function truncateMiddle(text, maxChars, label) {
  const value = String(text || '');
  if (value.length <= maxChars) {
    return { text: value, truncated: false, originalChars: value.length };
  }

  const marker = `\n\n[${label} 축약됨: original_chars=${value.length}, included_chars=${maxChars}]\n\n`;
  const available = Math.max(0, maxChars - marker.length);
  if (available <= 0) {
    return {
      text: `[${label} 축약됨: original_chars=${value.length}, included_chars=0]`,
      truncated: true,
      originalChars: value.length,
    };
  }

  const headChars = Math.ceil(available * 0.65);
  const tailChars = available - headChars;
  return {
    text: value.slice(0, headChars) + marker + value.slice(value.length - tailChars),
    truncated: true,
    originalChars: value.length,
  };
}

function extractCheckPriorityLines(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  const priority = [];
  let inIssueSection = false;
  let inDiffBlock = false;

  for (const line of lines) {
    if (/^##\s+수정 필요 항목/.test(line)) {
      inIssueSection = true;
      priority.push(line);
      continue;
    }
    if (inIssueSection) {
      if (/^##/.test(line)) inIssueSection = false;
      else if (/^[-*]\s+/.test(line) || line.trim() === '') {
        priority.push(line);
        continue;
      }
    }

    if (/^```diff/.test(line)) inDiffBlock = true;
    if (inDiffBlock || /^diff --git\b/.test(line) || /^@@\s/.test(line) || /^[+-][^+-]/.test(line)) {
      priority.push(line);
      if (/^```$/.test(line)) inDiffBlock = false;
      continue;
    }

    if (/hook-failure|needs_changes|fail|error|실패|오류|수정|변경|위반/i.test(line)) {
      priority.push(line);
    }
  }

  return Array.from(new Set(priority)).join('\n').trim();
}

function compactCheckResult(raw, maxChars) {
  const value = String(raw || '');
  if (value.length <= maxChars) {
    return { text: value, truncated: false, originalChars: value.length };
  }

  const { frontmatter, body } = splitFrontmatter(value);
  const priority = extractCheckPriorityLines(body);
  const header = [
    '[check-result.md 축약본]',
    `original_chars: ${value.length}`,
    'status/frontmatter와 issue/diff/error 관련 줄을 우선 보존했습니다.',
    '',
    frontmatter,
    '',
    '## Priority Feedback',
    priority || '(우선 추출 가능한 issue/diff/error 줄 없음)',
    '',
    '## Body Excerpt',
  ].join('\n');

  const excerptBudget = Math.max(0, maxChars - header.length - 2);
  const excerpt = truncateMiddle(body, excerptBudget, 'check-result.md body');
  const combined = [header, excerpt.text].join('\n').slice(0, maxChars);
  return { text: combined, truncated: true, originalChars: value.length };
}

function compactDoResult(raw, maxChars) {
  return truncateMiddle(raw, maxChars, 'do-result.md');
}

function compactSpec(raw, maxChars) {
  return truncateMiddle(raw, maxChars, 'feature spec');
}

function allocateIterPromptBudgets(maxArtifactChars) {
  const base = MIN_ITER_ARTIFACT_CHARS * 3;
  const extra = Math.max(0, maxArtifactChars - base);
  return {
    specChars: MIN_ITER_ARTIFACT_CHARS + Math.floor(extra * 0.35),
    doChars: MIN_ITER_ARTIFACT_CHARS + Math.floor(extra * 0.25),
    checkChars: MIN_ITER_ARTIFACT_CHARS + Math.floor(extra * 0.40),
  };
}

function buildIterPrompt({ feature, attempt, maxIter, spec, doResult, checkResult, promptBudget }) {
  const introParts = [
    'You are re-implementing a feature for a software project.',
    'The previous implementation was reviewed and needs changes.',
    'Carefully read the review feedback and fix all the issues listed.',
    '',
    `Feature: ${feature}`,
    `Iteration: ${attempt} of ${maxIter}`,
  ];

  const finalInstructions = [
    '',
    'Re-implement the feature now, addressing ALL issues from the review feedback.',
    'Follow the Build Plan step by step from the Feature Spec.',
    'Make sure every item listed in the review issues is resolved.',
  ];

  const fixedChars = [
    ...introParts,
    '',
    '## Feature Spec',
    '',
    '## Previous Implementation (do-result.md)',
    '',
    '## Review Feedback (check-result.md)',
    '',
    ...finalInstructions,
  ].join('\n').length + 6;
  const maxArtifactChars = promptBudget.maxChars - fixedChars;

  if (maxArtifactChars < MIN_ITER_ARTIFACT_CHARS * 3) {
    const reason = `iter prompt budget 초과: 고정 지시문 이후 artifact 예산 부족 chars=${maxArtifactChars}, max=${promptBudget.maxChars}`;
    return { error: reason };
  }

  const budgets = allocateIterPromptBudgets(maxArtifactChars);
  const compactedSpec = compactSpec(spec, budgets.specChars);
  const compactedDo = compactDoResult(doResult, budgets.doChars);
  const compactedCheck = compactCheckResult(checkResult, budgets.checkChars);

  const prompt = [
    ...introParts,
    '',
    '## Feature Spec',
    compactedSpec.text,
    '',
    '## Previous Implementation (do-result.md)',
    compactedDo.text,
    '',
    '## Review Feedback (check-result.md)',
    compactedCheck.text,
    ...finalInstructions,
  ].join('\n');

  if (prompt.length > promptBudget.maxChars) {
    return {
      error: `iter prompt budget 초과: chars=${prompt.length}, max=${promptBudget.maxChars}`,
      stats: { chars: prompt.length, maxChars: promptBudget.maxChars },
    };
  }

  return {
    prompt,
    stats: {
      chars: prompt.length,
      maxChars: promptBudget.maxChars,
      specOriginalChars: compactedSpec.originalChars,
      doOriginalChars: compactedDo.originalChars,
      checkOriginalChars: compactedCheck.originalChars,
      specChars: compactedSpec.text.length,
      doChars: compactedDo.text.length,
      checkChars: compactedCheck.text.length,
      specTruncated: compactedSpec.truncated,
      doTruncated: compactedDo.truncated,
      checkTruncated: compactedCheck.truncated,
    },
  };
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
    cwd: process.cwd(),
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

const iterPromptBudget = getIterPromptBudgetFromEnv();

// ---------------------------------------------------------------------------
// 모델 및 provider 읽기
// iter provider 우선순위: providers.iter → providers.do → Claude 기본값
// routing-matrix: iter는 do의 수정 루프이므로 provider/sandbox 정책이 같다.
// ---------------------------------------------------------------------------

let model;
let providerSpec = { name: 'claude' };
const runRequestPath = path.join(runtimeRootBase, 'runs', feature, 'run-request.json');
let runRequest = null;
try {
  runRequest = readRunRequest(runRequestPath);
} catch (err) {
  printRunRequestParseFailure('built:iter', err);
  process.exit(1);
}

if (runRequest && runRequest.model) model = runRequest.model;

try {
  const builtConfig = readBuiltConfig(controlRoot);
  providerSpec = resolvePhaseProvider({
    runRequest,
    builtConfig,
    phase: 'iter',
    fallbackPhase: 'do',
  }).providerSpec;
} catch (err) {
  const configSourcePath = hasRunRequestProvidersField(runRequest)
    ? runRequestPath
    : path.join(controlRoot, '.built', 'config.json');
  printProviderConfigFailure('built:iter', configSourcePath, err);
  process.exit(1);
}

if (providerSpec && providerSpec.model) {
  model = providerSpec.model;
}

// ---------------------------------------------------------------------------
// Iter 루프 메인 함수
// ---------------------------------------------------------------------------

async function runIter(signal) {
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
  console.log(`[built:iter] prompt budget: ${iterPromptBudget.maxChars} chars`);
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

    const promptBuild = buildIterPrompt({
      feature,
      attempt,
      maxIter,
      spec,
      doResult,
      checkResult,
      promptBudget: iterPromptBudget,
    });

    if (promptBuild.error) {
      console.error(`[built:iter] ${promptBuild.error}`);
      console.error('[built:iter] BUILT_ITER_PROMPT_MAX_CHARS를 늘리거나 feature/check artifact를 정리한 뒤 다시 실행하세요.');
      tryMarkFailed(promptBuild.error, 'needs_iteration');
      return 1;
    }

    const iterPrompt = promptBuild.prompt;
    console.log(
      `[built:iter] prompt chars: ${promptBuild.stats.chars}/${promptBuild.stats.maxChars} ` +
      `(spec=${promptBuild.stats.specChars}/${promptBuild.stats.specOriginalChars}${promptBuild.stats.specTruncated ? ',truncated' : ''}, ` +
      `do=${promptBuild.stats.doChars}/${promptBuild.stats.doOriginalChars}${promptBuild.stats.doTruncated ? ',truncated' : ''}, ` +
      `check=${promptBuild.stats.checkChars}/${promptBuild.stats.checkOriginalChars}${promptBuild.stats.checkTruncated ? ',truncated' : ''})`
    );

    if (promptBuild.stats.chars >= iterPromptBudget.warnChars) {
      console.warn(`[built:iter] prompt budget 경고: chars=${promptBuild.stats.chars}, warn=${iterPromptBudget.warnChars}, max=${iterPromptBudget.maxChars}`);
    }

    console.log(`[built:iter] Do 재실행 중...`);

    const doRunResult = await runPipeline({
      prompt: iterPrompt,
      model,
      runtimeRoot: featureDir,
      phase: 'iter',
      featureId: feature,
      resultOutputPath: doResultPath,
      providerSpec,
      signal,
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

const abortControl = createPhaseAbortController({ label: 'built:iter' });

runIter(abortControl.signal).then((exitCode) => {
  abortControl.cleanup();
  process.exit(exitCode);
}).catch((err) => {
  abortControl.cleanup();
  console.error(`\n[built:iter] 예상치 못한 오류: ${err.message}`);
  process.exit(1);
});
