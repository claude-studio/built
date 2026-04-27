#!/usr/bin/env node
/**
 * run.js
 *
 * /built:run 스킬 헬퍼 — Do→Check→Iter→Report 전체 파이프라인을 오케스트레이션.
 *
 * 사용법:
 *   node scripts/run.js <feature> [--background] [--dry-run] [--allow-cost-overrun]
 *
 * 동작:
 *   1. .built/runtime/runs/<feature>/run-request.json 읽기 (선택, 모델 설정용 및 dry_run 설정)
 *   2. .built/features/<feature>/progress.json 에서 누적 비용 확인
 *      - total_cost_usd > $1.0 이면 사용자 확인 요청 (dry-run/명시 override 제외)
 *   3. .built/runtime/runs/<feature>/state.json 초기화 (phase: do, status: running)
 *   4. plan_synthesis가 명시적으로 설정된 경우 scripts/plan-synthesis.js 실행
 *   5. scripts/do.js → scripts/check.js → scripts/iter.js → scripts/report.js 순서로 실행
 *   6. 각 단계 사이 state.json phase 갱신
 *   7. 각 단계 실패 시 state.json에 failed 기록 후 종료
 *   8. 완료 시 state.json status: completed 갱신
 *
 * --background 플래그:
 *   - 파이프라인을 분리된 백그라운드 프로세스로 실행
 *   - PID를 state.json에 기록
 *   - 즉시 반환 (폴링은 caller 책임)
 *
 * --dry-run 플래그 (또는 run-request.json의 dry_run: true):
 *   - 실제 claude 호출 없이 실행 계획만 출력
 *   - 비용 경고 없이 통과
 *
 * --allow-cost-overrun 플래그:
 *   - 비대화형 자동화에서 비용 guard 초과를 명시적으로 승인
 *   - 기본 자동 승인은 하지 않음
 *
 * Exit codes:
 *   0 — 파이프라인 완료 (포그라운드) 또는 백그라운드 spawn 성공, 또는 dry-run 완료
 *   1 — 오류 또는 사용자가 비용 경고에서 실행 거부
 *
 * 외부 npm 패키지 없음. MULTICA_AGENT_TIMEOUT, BUILT_MAX_ITER 환경변수 지원.
 */

'use strict';

const fs           = require('fs');
const path         = require('path');
const childProcess = require('child_process');

const { initState, updateState, readState } = require(path.join(__dirname, '..', 'src', 'state'));
const {
  loadHooks,
  runHooks,
  injectFailuresIntoCheckResult,
  writePendingHookWarnings,
  readPendingHookWarnings,
  clearPendingHookWarnings,
} = require(path.join(__dirname, '..', 'src', 'hooks-runner'));
const registryModule = require(path.join(__dirname, '..', 'src', 'registry'));
const { getProviderForPhase } =
  require(path.join(__dirname, '..', 'src', 'providers/config'));
const {
  readRunRequest,
  readBuiltConfig,
  hasRunRequestProvidersField,
  resolveProviderConfig,
  printRunRequestParseFailure,
  printProviderConfigFailure,
} = require(path.join(__dirname, '..', 'src', 'run-request'));
const { formatClaudePermissionRemediation } =
  require(path.join(__dirname, '..', 'src', 'providers/failure'));
const { createPhaseAbortController } = require(path.join(__dirname, '..', 'src', 'phase-abort'));
const {
  buildRootContext,
  writeRootContext,
  formatRootContext,
} = require(path.join(__dirname, '..', 'src', 'root-context'));
const {
  assessRootApplication,
  formatHandoffMarkdown,
  formatHandoffConsole,
} = require(path.join(__dirname, '..', 'src', 'worktree-handoff'));

// ---------------------------------------------------------------------------
// 인자 파싱
// ---------------------------------------------------------------------------

const args       = process.argv.slice(2);
const feature    = args.find((a) => !a.startsWith('--'));
const background = args.includes('--background');
const dryRunFlag = args.includes('--dry-run');
const allowCostOverrun = args.includes('--allow-cost-overrun');

if (!feature) {
  console.error('Usage: node scripts/run.js <feature> [--background] [--dry-run] [--allow-cost-overrun]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 경로 설정
// ---------------------------------------------------------------------------

const projectRoot    = process.cwd();
const specPath       = path.join(projectRoot, '.built', 'features', `${feature}.md`);
const rootFeatureDir = path.join(projectRoot, '.built', 'features', feature);
let featureDir       = rootFeatureDir;
const runDir             = path.join(projectRoot, '.built', 'runtime', 'runs', feature);
const registryRuntimeDir = path.join(projectRoot, '.built', 'runtime');
const runRequestPath     = path.join(runDir, 'run-request.json');
const stateFilePath      = path.join(runDir, 'state.json');
const runRootContextPath = path.join(runDir, 'root-context.json');
let executionContext = {
  enabled: false,
  path: projectRoot,
  branch: null,
  resultDir: featureDir,
  cleanupCommand: null,
  fallbackReason: null,
};

// ---------------------------------------------------------------------------
// 유효성 검사
// ---------------------------------------------------------------------------

if (!fs.existsSync(specPath)) {
  console.error(`Error: feature spec not found: ${specPath}`);
  console.error(`/built:plan ${feature} 를 먼저 실행해주세요.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// run-request.json 읽기 (dry_run 설정 포함)
// ---------------------------------------------------------------------------

let runRequest;
try {
  runRequest = readRunRequest(runRequestPath);
} catch (err) {
  printRunRequestParseFailure('built:run', err);
  process.exit(1);
}

// --dry-run 플래그 또는 run-request.json의 dry_run: true 설정 시 dry-run 모드
const dryRun = dryRunFlag || (runRequest !== null && runRequest.dry_run === true);

function hasWorktreeDisabled() {
  return process.env.BUILT_DISABLE_WORKTREE === '1' ||
    process.env.BUILT_EXECUTION_WORKTREE === '0' ||
    (runRequest !== null && runRequest.execution_worktree === false);
}

function hasPlanSynthesisEnabled() {
  if (runRequest && runRequest.plan_synthesis === true) return true;
  return Boolean(providerConfig.plan_synthesis);
}

// ---------------------------------------------------------------------------
// config.json 읽기 (global default_max_cost_usd 지원)
// ---------------------------------------------------------------------------

const builtConfig = readBuiltConfig(projectRoot);

let providerResolution;
let providerConfig;
try {
  providerResolution = resolveProviderConfig(runRequest, builtConfig);
  providerConfig = providerResolution.config;
} catch (err) {
  const configSourcePath = hasRunRequestProvidersField(runRequest)
    ? runRequestPath
    : path.join(projectRoot, '.built', 'config.json');
  printProviderConfigFailure('built:run', configSourcePath, err);
  process.exit(1);
}

function providerForLog(phase) {
  const spec = getProviderForPhase(providerConfig, phase);
  const sandbox = spec.sandbox ? `, sandbox=${spec.sandbox}` : '';
  return `${spec.name}${sandbox}, source=${providerResolution.source}`;
}

function providerRoutingContext() {
  const phases = {};
  for (const phase of ['plan_synthesis', 'do', 'check', 'iter', 'report']) {
    phases[phase] = getProviderForPhase(providerConfig, phase);
  }
  return {
    source: providerResolution.source,
    phases,
  };
}

// ---------------------------------------------------------------------------
// 백그라운드 모드 처리
// ---------------------------------------------------------------------------

// 백그라운드 재진입 방지용 환경변수
const FORK_ENV_KEY = '_BUILT_RUN_FORKED';

if (background && !process.env[FORK_ENV_KEY]) {
  // 자신을 detached 프로세스로 재실행 (--background 없이)
  const nodeArgs = [__filename, feature];
  if (dryRunFlag) nodeArgs.push('--dry-run');
  if (allowCostOverrun) nodeArgs.push('--allow-cost-overrun');
  const child = childProcess.spawn(process.execPath, nodeArgs, {
    detached: true,
    stdio: 'ignore',
    env: Object.assign({}, process.env, { [FORK_ENV_KEY]: '1' }),
    cwd: projectRoot,
  });

  child.unref();

  // state.json에 PID 기록 (디렉토리 및 파일 준비)
  try {
    fs.mkdirSync(runDir, { recursive: true });
    if (!fs.existsSync(stateFilePath)) {
      initState(runDir, feature);
    }
    updateState(runDir, {
      phase:      'do',
      status:     'running',
      pid:        child.pid,
      heartbeat:  new Date().toISOString(),
    });
  } catch (_) {}

  console.log(`[built:run] 백그라운드 실행 시작 (pid: ${child.pid})`);
  console.log(`[built:run] 상태 확인: ${stateFilePath}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 유틸: 하위 스크립트 실행
// ---------------------------------------------------------------------------

/**
 * 지정된 script를 동기 서브프로세스로 실행한다.
 *
 * @param {string} scriptName  scripts/ 디렉토리 내 파일명 (확장자 포함)
 * @returns {{ success: boolean, exitCode: number }}
 */
function runScript(scriptName, signal) {
  const scriptPath = path.join(__dirname, scriptName);
  if (signal && signal.aborted) {
    return Promise.resolve({ success: false, exitCode: 130 });
  }

  return new Promise((resolve) => {
    const child = childProcess.spawn(process.execPath, [scriptPath, feature], {
      stdio:   'inherit',
      env:     executionEnv(),
      cwd:     executionContext.path,
    });

    let settled = false;
    function finish(exitCode) {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', abortChild);
      resolve({ success: exitCode === 0, exitCode });
    }

    function abortChild() {
      if (child.exitCode !== null) return;
      try { child.kill('SIGTERM'); } catch (_) {}
    }

    if (signal) {
      if (signal.aborted) abortChild();
      else signal.addEventListener('abort', abortChild, { once: true });
    }

    child.on('error', () => finish(1));
    child.on('exit', (code, sig) => {
      if (code !== null) return finish(code);
      return finish(sig ? 130 : 1);
    });
  });
}

// ---------------------------------------------------------------------------
// 유틸: state.json 안전 갱신
// ---------------------------------------------------------------------------

function tryUpdateState(updates) {
  try {
    if (fs.existsSync(stateFilePath)) {
      const current = readState(runDir);
      if (current.status === 'aborted' && updates.status !== 'aborted') {
        return;
      }
      updateState(runDir, updates);
    }
  } catch (_) {}
}

function isCurrentRunAborted() {
  try {
    return fs.existsSync(stateFilePath) && readState(runDir).status === 'aborted';
  } catch (_) {
    return false;
  }
}

function stopIfExternallyAborted() {
  if (!isCurrentRunAborted()) return false;
  console.error('\n[built:run] 외부 abort가 감지되어 남은 단계를 실행하지 않습니다.');
  return true;
}

function readProgressLastFailure() {
  const progressPath = path.join(featureDir, 'progress.json');
  try {
    const data = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
    return data.last_failure || null;
  } catch (_) {
    return null;
  }
}

function tryMarkFailed(phase, reason) {
  const lastFailure = readProgressLastFailure();
  if (isCurrentRunAborted()) {
    return lastFailure;
  }
  const updates = { phase, status: 'failed', last_error: reason };
  if (lastFailure) {
    updates.last_failure = lastFailure;
  }
  tryUpdateState(updates);
  return lastFailure;
}

function printFailureRemediation(failure) {
  if (!failure || failure.code !== 'claude_permission_request') return;
  console.error('\n[built:run] Claude permission remediation');
  console.error(formatClaudePermissionRemediation(feature));
}

function safeWorktreeName(featureId) {
  return String(featureId)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'feature';
}

function runGit(args) {
  return childProcess.spawnSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function isGitRepository() {
  const result = runGit(['rev-parse', '--is-inside-work-tree']);
  return result.status === 0 && String(result.stdout).trim() === 'true';
}

function branchExists(branch) {
  return runGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0;
}

function currentBranch(cwd) {
  const result = childProcess.spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) return null;
  return String(result.stdout).trim() || null;
}

function syncFileIfChanged(src, dest) {
  if (!fs.existsSync(src)) return;
  let shouldWrite = true;
  try {
    shouldWrite = !fs.existsSync(dest) || fs.readFileSync(src, 'utf8') !== fs.readFileSync(dest, 'utf8');
  } catch (_) {
    shouldWrite = true;
  }
  if (!shouldWrite) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function syncExecutionInputs(worktreePath) {
  syncFileIfChanged(specPath, path.join(worktreePath, '.built', 'features', `${feature}.md`));
  for (const rel of [
    path.join('.built', 'config.json'),
    path.join('.built', 'hooks.json'),
    path.join('.built', 'hooks.local.json'),
  ]) {
    syncFileIfChanged(path.join(projectRoot, rel), path.join(worktreePath, rel));
  }
}

function prepareExecutionContext() {
  if (hasWorktreeDisabled()) {
    return {
      enabled: false,
      path: projectRoot,
      branch: currentBranch(projectRoot),
      resultDir: rootFeatureDir,
      cleanupCommand: null,
      fallbackReason: 'disabled',
    };
  }

  if (!isGitRepository()) {
    return {
      enabled: false,
      path: projectRoot,
      branch: null,
      resultDir: rootFeatureDir,
      cleanupCommand: null,
      fallbackReason: 'not_git_repository',
    };
  }

  const safeName = safeWorktreeName(feature);
  const worktreePath = registryModule.getWorktreePath(projectRoot, safeName);
  const branch = `built/worktree/${safeName}`;
  const resultDir = path.join(worktreePath, '.built', 'features', feature);

  if (!fs.existsSync(worktreePath)) {
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
    const args = branchExists(branch)
      ? ['worktree', 'add', worktreePath, branch]
      : ['worktree', 'add', '-b', branch, worktreePath, 'HEAD'];
    const result = runGit(args);
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || '').trim();
      throw new Error(`execution worktree 생성 실패: ${detail || `git ${args.join(' ')}`}`);
    }
  }

  syncExecutionInputs(worktreePath);

  return {
    enabled: true,
    path: worktreePath,
    branch: currentBranch(worktreePath) || branch,
    resultDir,
    cleanupCommand: `node scripts/cleanup.js ${feature}`,
    fallbackReason: null,
  };
}

function executionEnv() {
  return Object.assign({}, process.env, {
    BUILT_PROJECT_ROOT: projectRoot,
    BUILT_RUNTIME_ROOT: registryRuntimeDir,
    BUILT_WORKTREE: executionContext.enabled ? executionContext.path : '',
    BUILT_RESULT_ROOT: featureDir,
  });
}

function currentRootContext() {
  return buildRootContext({
    phase: 'run',
    feature,
    projectRoot,
    executionRoot: executionContext.path,
    runtimeRoot: registryRuntimeDir,
    resultRoot: featureDir,
    artifactPaths: {
      feature_spec: specPath,
      run_request: runRequestPath,
      state: stateFilePath,
      root_context: runRootContextPath,
      progress: path.join(featureDir, 'progress.json'),
      do_result: path.join(featureDir, 'do-result.md'),
      check_result: path.join(featureDir, 'check-result.md'),
      report: path.join(featureDir, 'report.md'),
      kg_draft: path.join(projectRoot, 'kg', 'issues', `${feature.toUpperCase()}.md`),
    },
    providerRouting: providerRoutingContext(),
  });
}

function currentRegistryEntry() {
  try {
    const registry = registryModule.getAll(registryRuntimeDir);
    return registry && registry[feature] ? registry[feature] : null;
  } catch (_) {
    return null;
  }
}

function appendRunHandoffToReport(state) {
  const reportMd = path.join(featureDir, 'report.md');
  if (!fs.existsSync(reportMd)) return;

  const marker = '## Root 적용 / handoff';
  const handoff = formatHandoffMarkdown(feature, projectRoot, state, currentRegistryEntry());
  try {
    const raw = fs.readFileSync(reportMd, 'utf8');
    const next = raw.includes(marker)
      ? raw
      : `${raw.replace(/\s*$/, '')}\n\n${handoff}\n`;
    fs.writeFileSync(reportMd, next, 'utf8');
  } catch (e) {
    console.warn(`[built:run] handoff report 갱신 경고: ${e.message}`);
  }
}

function printRunHandoff(state) {
  const registryEntry = currentRegistryEntry();
  const assessment = assessRootApplication(projectRoot, state, registryEntry);
  tryUpdateState({
    execution_worktree: Object.assign({}, state.execution_worktree || {}, {
      root_applied: assessment.rootApplied,
      root_apply_status: assessment.status,
      root_apply_summary: assessment.summary,
    }),
  });
  appendRunHandoffToReport(state);
  console.log('');
  console.log(formatHandoffConsole(feature, projectRoot, state, registryEntry));
}

// ---------------------------------------------------------------------------
// 비용 경고: progress.json에서 누적 비용 확인 후 사용자 확인 요청
// ---------------------------------------------------------------------------

// 비용 상한 우선순위: run-request.json > config.json > 기본값 $1.0
const DEFAULT_COST_THRESHOLD_USD = 1.0;
const COST_THRESHOLD_USD = (() => {
  if (runRequest !== null && typeof runRequest.max_cost_usd === 'number' && runRequest.max_cost_usd > 0) {
    return runRequest.max_cost_usd;
  }
  if (builtConfig !== null && typeof builtConfig.default_max_cost_usd === 'number' && builtConfig.default_max_cost_usd > 0) {
    return builtConfig.default_max_cost_usd;
  }
  return DEFAULT_COST_THRESHOLD_USD;
})();

/**
 * progress.json에서 누적 cost_usd를 읽는다.
 * 파일이 없거나 읽기 실패 시 0을 반환한다.
 *
 * @returns {number}
 */
function readAccumulatedCost() {
  const progressPath = path.join(featureDir, 'progress.json');
  try {
    const data = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
    return typeof data.cost_usd === 'number' ? data.cost_usd : 0;
  } catch (_) {
    return 0;
  }
}

function formatCostGuardOverrideHint() {
  return [
    '[built:run] 중단 원인: 비용 guard가 사용자 승인 없이 자동 실행을 시작하지 않았습니다.',
    '[built:run] 해결 방법: 의도적으로 계속하려면 `--allow-cost-overrun` 플래그를 붙여 다시 실행하세요.',
    `[built:run] 예: node scripts/run.js ${feature} --allow-cost-overrun`,
    '[built:run] 또는 `.built/runtime/runs/<feature>/run-request.json`의 `max_cost_usd`나 `.built/config.json`의 `default_max_cost_usd`를 조정하세요.',
  ].join('\n');
}

/**
 * 비용이 임계값을 초과하면 사용자에게 확인을 요청한다.
 * 사용자가 거부하면 false를 반환한다.
 * 비용이 임계값 이하이면 true를 반환한다.
 *
 * @returns {Promise<boolean>}  true = 계속 진행, false = 중단
 */
function checkCostAndConfirm() {
  return new Promise((resolve) => {
    const cost = readAccumulatedCost();
    if (cost <= COST_THRESHOLD_USD) {
      resolve(true);
      return;
    }

    process.stdout.write(
      `\n[built:run] 비용 경고: 이 feature의 누적 비용이 $${cost.toFixed(4)} 입니다.\n` +
      `[built:run]    임계값($${COST_THRESHOLD_USD.toFixed(2)})을 초과했습니다.\n`
    );

    if (allowCostOverrun) {
      process.stdout.write('[built:run] --allow-cost-overrun 플래그로 비용 초과를 명시 승인했습니다.\n');
      resolve(true);
      return;
    }

    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    process.stdout.write('[built:run] 계속 진행하시겠습니까? (y/N): ');

    let answered = false;

    rl.once('line', (answer) => {
      answered = true;
      const confirmed = answer.trim().toLowerCase() === 'y';
      if (!confirmed) {
        process.stdout.write(`\n${formatCostGuardOverrideHint()}\n`);
      }
      resolve(confirmed);  // resolve 먼저 호출 후 close (rl.close가 'close' 이벤트를 동기 발생시킴)
      rl.close();
    });

    // stdin이 닫혀 있으면 (비대화형 환경) 기본값 N으로 처리
    rl.once('close', () => {
      if (!answered) {
        process.stdout.write(`\n[built:run] 비대화형 환경에서 stdin이 닫혀 있어 기본값 N으로 처리했습니다.\n${formatCostGuardOverrideHint()}\n`);
        resolve(false);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// dry-run: 실행 계획만 출력하고 종료
// ---------------------------------------------------------------------------

/**
 * dry-run 모드에서 실행 계획을 출력한다.
 * 실제 claude 호출 없이 계획만 보여준다.
 */
function printDryRunPlan() {
  const specContent = (() => {
    try { return fs.readFileSync(specPath, 'utf8').slice(0, 500); } catch (_) { return '(읽기 실패)'; }
  })();

  console.log('[built:run] [dry-run] 실행 계획 출력 (실제 claude 호출 없음)\n');
  console.log(`Feature: ${feature}`);
  console.log(`Spec: ${specPath}`);
  console.log(`Run dir: ${runDir}`);
  console.log(
    `Execution worktree: ${hasWorktreeDisabled() ? '(legacy/root execution)' : registryModule.getWorktreePath(projectRoot, safeWorktreeName(feature))}`
  );
  if (runRequest && runRequest.model) {
    console.log(`Model: ${runRequest.model}`);
  }
  if (runRequest && runRequest.dry_run) {
    console.log('dry_run: true (run-request.json 설정)');
  }
  console.log(`Provider source: ${providerResolution.source}`);
  for (const phase of ['do', 'check', 'iter', 'report']) {
    console.log(`Provider ${phase}: ${providerForLog(phase)}`);
  }
  console.log('\n파이프라인 단계:');
  if (hasPlanSynthesisEnabled()) {
    console.log('  0. Plan synthesis — 실행 계획 구조화 (scripts/plan-synthesis.js)');
  }
  console.log('  1. Do     — feature 구현 (scripts/do.js)');
  console.log('  2. Check  — 품질 검증 (scripts/check.js)');
  console.log('  3. Iter   — 반복 개선 (scripts/iter.js)');
  console.log('  4. Report — 결과 요약 (scripts/report.js)');
  console.log('\nSpec 미리보기:');
  console.log('---');
  console.log(specContent.trim());
  if (specContent.length >= 500) console.log('...(이하 생략)');
  console.log('---');
  console.log('\n[built:run] [dry-run] 완료. 실제 실행하려면 --dry-run 없이 다시 실행하세요.');
}

// ---------------------------------------------------------------------------
// 파이프라인 본체 (state 초기화 → Do → Check → Iter → Report)
// ---------------------------------------------------------------------------

/**
 * 실제 파이프라인 단계를 실행한다.
 * lock 획득 / registry 등록은 runPipeline()이 담당하며, 이 함수는 순수 단계만 실행한다.
 *
 * @returns {Promise<number>} 0 = 성공, 1 = 실패
 */
async function _runPipelineSteps(signal) {
  const planSynthesisEnabled = hasPlanSynthesisEnabled();
  // state.json 초기화
  try {
    fs.mkdirSync(runDir, { recursive: true });
    if (!fs.existsSync(stateFilePath)) {
      initState(runDir, feature);
    }
    updateState(runDir, {
      phase:     'do',
      status:    'running',
      pid:       process.pid,
      heartbeat: new Date().toISOString(),
      root_context: currentRootContext(),
      execution_worktree: {
        enabled: executionContext.enabled,
        path: executionContext.path,
        branch: executionContext.branch,
        result_dir: executionContext.resultDir,
        runtime_root: registryRuntimeDir,
        cleanup: executionContext.cleanupCommand,
        fallback_reason: executionContext.fallbackReason,
      },
      plan_synthesis_enabled: planSynthesisEnabled,
      provider_routing: providerRoutingContext(),
    });
  } catch (e) {
    console.warn(`[built:run] state.json 초기화 경고: ${e.message}`);
  }

  // 훅 사전 로드 (파이프라인 전체에서 재사용)
  let hooks;
  try {
    hooks = loadHooks(executionContext.path);
  } catch (e) {
    console.warn(`[built:run] hooks 로드 실패 (무시하고 계속): ${e.message}`);
    hooks = null;
  }

  /** 공통 훅 실행 옵션 */
  const hookBase = {
    projectRoot: executionContext.path,
    worktree: executionContext.enabled ? executionContext.path : '',
    feature,
    featureDir,
    runDir,
    hooks: hooks || undefined,
  };

  // ---- Plan Synthesis ----
  console.log(`[built:run] plan_synthesis: ${planSynthesisEnabled ? 'enabled' : 'disabled'}`);
  if (planSynthesisEnabled) {
    const providerSpec = getProviderForPhase(providerConfig, 'plan_synthesis');

    console.log('[built:run] [0/4] Plan synthesis 단계 시작...');
    console.log(`[built:run] [0/4] provider: ${providerSpec.name} (${providerForLog('plan_synthesis')})`);
    tryUpdateState({ phase: 'plan_synthesis', status: 'running', heartbeat: new Date().toISOString() });

    const planResult = await runScript('plan-synthesis.js', signal);
    if (stopIfExternallyAborted()) return 1;
    if (!planResult.success) {
      console.error(`\n[built:run] Plan synthesis 실패 (exit ${planResult.exitCode})`);
      tryMarkFailed('plan_synthesis', `plan-synthesis.js exited with code ${planResult.exitCode}`);
      return 1;
    }
    console.log('[built:run] [0/4] Plan synthesis 완료\n');
  }

  // ---- before_do 훅 ----
  // recoverable halt 실패는 check-result.md에 주입하고 Do/Check를 건너뛴 뒤 iter로 넘긴다.
  // iter.js는 check-result.md를 읽으므로 needs_changes → iter 루프 진입 가능.
  let skipToIter = false;
  {
    const hooksResult = runHooks('before_do', {
      ...hookBase,
      previousResultPath: path.join(featureDir, 'do-result.md'),
    });

    if (hooksResult.failures.length > 0) {
      try {
        fs.mkdirSync(featureDir, { recursive: true });
        if (hooksResult.halted) {
          // check-result.md에 실패 주입 (iter 인지용)
          injectFailuresIntoCheckResult(featureDir, hooksResult.failures, true);
        } else {
          writePendingHookWarnings(featureDir, hooksResult.failures);
        }
      } catch (e) {
        console.warn(`[built:run] before_do 실패 주입 경고: ${e.message}`);
      }
    }

    if (hooksResult.halted) {
      console.error('\n[built:run] before_do 훅 실패 (halt_on_fail: true) — Do 단계를 건너뜁니다.');
      console.error('[built:run] check-result.md에 실패 내역을 기록했습니다. iter로 복구를 시도합니다.');
      skipToIter = true;
    }
  }

  // ---- Do ----
  if (!skipToIter) {
    console.log('[built:run] [1/4] Do 단계 시작...');
    console.log(`[built:run] [1/4] provider: ${providerForLog('do')}`);
    tryUpdateState({ phase: 'do', status: 'running', heartbeat: new Date().toISOString() });

    const doResult = await runScript('do.js', signal);
    if (stopIfExternallyAborted()) return 1;
    if (!doResult.success) {
      console.error(`\n[built:run] Do 실패 (exit ${doResult.exitCode})`);
      const failure = tryMarkFailed('do', `do.js exited with code ${doResult.exitCode}`);
      printFailureRemediation(failure);
      return 1;
    }
    console.log('[built:run] [1/4] Do 완료\n');
  } else {
    console.log('[built:run] [1/4] Do 단계 건너뜀 (before_do hook halt)\n');
  }

  // ---- after_do 훅 ----
  // lint, typecheck, build 등. halt_on_fail: true 실패 시 Check를 건너뛰고 iter로 넘긴다.
  if (!skipToIter) {
    const doResultPath = path.join(featureDir, 'do-result.md');
    const hooksResult  = runHooks('after_do', {
      ...hookBase,
      previousResultPath: doResultPath,
    });

    if (hooksResult.halted) {
      // after_do 실패는 Check 이전이므로 check-result.md 주입으로 iter 인지
      try {
        fs.mkdirSync(featureDir, { recursive: true });
        injectFailuresIntoCheckResult(featureDir, hooksResult.failures, true);
      } catch (e) {
        console.warn(`[built:run] after_do 실패 주입 경고: ${e.message}`);
      }

      console.error('\n[built:run] after_do 훅 실패 (halt_on_fail: true) — Check 단계를 건너뜁니다.');
      console.error('[built:run] check-result.md에 실패 내역을 기록했습니다. iter로 복구를 시도합니다.');
      skipToIter = true;
    }

    // halt_on_fail: false 경고성 실패는 Check가 check-result.md를 새로 쓸 때 병합되도록 보관
    if (!hooksResult.halted && hooksResult.failures.length > 0) {
      try {
        writePendingHookWarnings(featureDir, hooksResult.failures);
      } catch (_) {}
    }
  }

  // ---- before_check 훅 ----
  // halt_on_fail: true 실패 시 Check 건너뜀. check-result.md를 needs_changes로 생성해 iter 루프 진입.
  // halt_on_fail: false 실패 시 check-result.md에 경고 기록 후 Check 진행.
  if (!skipToIter) {
    const hooksResult = runHooks('before_check', {
      ...hookBase,
      previousResultPath: path.join(featureDir, 'do-result.md'),
    });

    if (hooksResult.failures.length > 0) {
      try {
        fs.mkdirSync(featureDir, { recursive: true });
        if (hooksResult.halted) {
          injectFailuresIntoCheckResult(featureDir, hooksResult.failures, true);
        } else {
          writePendingHookWarnings(featureDir, hooksResult.failures);
        }
      } catch (e) {
        console.warn(`[built:run] before_check 실패 주입 경고: ${e.message}`);
      }
    }

    if (hooksResult.halted) {
      console.error('\n[built:run] before_check 훅 실패 (halt_on_fail: true) — Check 단계를 건너뜁니다.');
      console.error('[built:run] check-result.md를 needs_changes로 생성했습니다. iter로 복구를 시도합니다.');
      skipToIter = true;
    }
  }

  // ---- Check ----
  if (!skipToIter) {
    console.log('[built:run] [2/4] Check 단계 시작...');
    console.log(`[built:run] [2/4] provider: ${providerForLog('check')}`);
    tryUpdateState({ phase: 'check', status: 'running', heartbeat: new Date().toISOString() });

    const checkResult = await runScript('check.js', signal);
    if (stopIfExternallyAborted()) return 1;
    if (!checkResult.success) {
      console.error(`\n[built:run] Check 실패 (exit ${checkResult.exitCode})`);
      tryMarkFailed('check', `check.js exited with code ${checkResult.exitCode}`);
      return 1;
    }
    try {
      const pendingWarnings = readPendingHookWarnings(featureDir);
      if (pendingWarnings.length > 0) {
        injectFailuresIntoCheckResult(featureDir, pendingWarnings, false);
        clearPendingHookWarnings(featureDir);
      }
    } catch (e) {
      console.warn(`[built:run] check 전 hook 경고 병합 경고: ${e.message}`);
    }
    console.log('[built:run] [2/4] Check 완료\n');
  } else {
    console.log('[built:run] [2/4] Check 단계 건너뜀 (hook halt → iter 복구)\n');
  }

  // ---- after_check 훅 ----
  // lint/build 등 후처리. halt_on_fail: true 실패 시 check-result.md status를
  // needs_changes로 강제하여 iter 루프가 인지하도록 한다.
  // check-result.md status가 approved여도 훅 실패 시 needs_changes로 덮어씀.
  if (!skipToIter) {
    const checkResultPath = path.join(featureDir, 'check-result.md');
    const hooksResult     = runHooks('after_check', {
      ...hookBase,
      previousResultPath: checkResultPath,
      conditionContext: {
        check: (() => {
          // check-result.md frontmatter 읽어 condition 평가 컨텍스트 구성
          try {
            const { parse } = require(path.join(__dirname, '..', 'src', 'frontmatter'));
            const raw = fs.readFileSync(checkResultPath, 'utf8');
            return parse(raw).data;
          } catch (_) {
            return {};
          }
        })(),
      },
    });

    if (hooksResult.failures.length > 0) {
      // halt_on_fail: true 실패 → needs_changes 강제 (iter 루프 트리거)
      // halt_on_fail: false 실패 → 경고만 기록 (status 유지)
      try {
        injectFailuresIntoCheckResult(
          featureDir,
          hooksResult.failures,
          hooksResult.halted, // true: needs_changes 강제, false: 경고만
        );
      } catch (e) {
        console.warn(`[built:run] after_check 실패 주입 경고: ${e.message}`);
      }
    }

    if (hooksResult.halted) {
      console.error('\n[built:run] after_check 훅 실패 (halt_on_fail: true)');
      console.error('[built:run] check-result.md status를 needs_changes로 강제했습니다.');
      console.error('[built:run] iter가 재실행되어 실패 내역을 Claude에 전달합니다.');
      // 파이프라인은 중단하지 않음 — iter 단계에서 needs_changes를 보고 재실행
    }
  }

  // ---- Iter ----
  console.log('[built:run] [3/4] Iter 단계 시작...');
  console.log(`[built:run] [3/4] provider: ${providerForLog('iter')}`);
  tryUpdateState({ phase: 'iter', status: 'running', heartbeat: new Date().toISOString() });

  const iterResult = await runScript('iter.js', signal);
  if (stopIfExternallyAborted()) return 1;
  if (!iterResult.success) {
    console.error(`\n[built:run] Iter 실패 (exit ${iterResult.exitCode})`);
    const failure = tryMarkFailed('iter', `iter.js exited with code ${iterResult.exitCode}`);
    printFailureRemediation(failure);
    return 1;
  }
  console.log('[built:run] [3/4] Iter 완료\n');

  // ---- before_report 훅 ----
  // halt_on_fail: true 실패 시 Report 건너뜀, state failed 처리.
  // halt_on_fail: false 실패 시 경고 기록 후 Report 진행.
  {
    const checkResultPath = path.join(featureDir, 'check-result.md');
    const hooksResult = runHooks('before_report', {
      ...hookBase,
      previousResultPath: checkResultPath,
    });

    if (hooksResult.failures.length > 0) {
      try {
        injectFailuresIntoCheckResult(
          featureDir,
          hooksResult.failures,
          false, // before_report 경고는 status 변경 없음
        );
      } catch (_) {}
    }

    if (hooksResult.halted) {
      console.error('\n[built:run] before_report 훅 실패 (halt_on_fail: true) — Report 단계를 건너뜁니다.');
      tryMarkFailed('report', 'before_report hook halted pipeline');
      return 1;
    }
  }

  // ---- Report ----
  console.log('[built:run] [4/4] Report 단계 시작...');
  console.log(`[built:run] [4/4] provider: ${providerForLog('report')}`);
  tryUpdateState({ phase: 'report', status: 'running', heartbeat: new Date().toISOString() });

  const reportResult = await runScript('report.js', signal);
  if (stopIfExternallyAborted()) return 1;
  if (!reportResult.success) {
    console.error(`\n[built:run] Report 실패 (exit ${reportResult.exitCode})`);
    tryMarkFailed('report', `report.js exited with code ${reportResult.exitCode}`);
    return 1;
  }
  console.log('[built:run] [4/4] Report 완료\n');

  // ---- after_report 훅 ----
  // git add, PR 초안 등 후처리. 실패해도 파이프라인 성공은 유지.
  {
    const reportMdPath = path.join(featureDir, 'report.md');
    runHooks('after_report', {
      ...hookBase,
      previousResultPath: reportMdPath,
    });
    // after_report 실패는 파이프라인 결과에 영향 없음 (경고 로그만 출력됨)
  }

  // ---- 완료 ----
  tryUpdateState({ phase: 'report', status: 'completed', last_error: null });

  console.log('[built:run] 파이프라인 완료!');
  console.log(`  state.json: ${stateFilePath}`);

  const reportMd = path.join(featureDir, 'report.md');
  if (fs.existsSync(reportMd)) {
    console.log(`  report.md: ${reportMd}`);
  }
  try {
    const completedState = readState(runDir);
    printRunHandoff(completedState);
  } catch (e) {
    console.warn(`[built:run] handoff 출력 경고: ${e.message}`);
  }

  return 0;
}

// ---------------------------------------------------------------------------
// 메인 파이프라인 (lock + registry 관리)
// ---------------------------------------------------------------------------

async function runPipeline() {
  console.log(`[built:run] feature: ${feature}`);

  // dry-run 모드: 계획만 출력하고 종료
  if (dryRun) {
    printDryRunPlan();
    return 0;
  }

  console.log(`[built:run] 파이프라인: Do → Check → Iter → Report\n`);

  // lock 획득 — 같은 feature의 중복 실행 방지
  try {
    registryModule.acquire(registryRuntimeDir, feature);
  } catch (lockErr) {
    console.error(`\n[built:run] 중복 실행 방지: ${lockErr.message}`);
    console.error('[built:run] 이미 이 feature가 실행 중입니다. /built:status로 확인하세요.');
    return 1;
  }

  try {
    executionContext = prepareExecutionContext();
    featureDir = executionContext.resultDir;
    const rootContext = currentRootContext();
    writeRootContext(runRootContextPath, rootContext);
    console.log(formatRootContext(rootContext));
    console.log('');
  } catch (e) {
    console.error(`[built:run] ${e.message}`);
    try { registryModule.release(registryRuntimeDir, feature); } catch (_) {}
    return 1;
  }

  // 비용 경고 확인은 executionContext 준비 후 canonical resultDir 기준으로 수행한다.
  const proceed = await checkCostAndConfirm();
  if (!proceed) {
    console.log('\n[built:run] 사용자가 실행을 취소했습니다.');
    try { registryModule.release(registryRuntimeDir, feature); } catch (_) {}
    return 1;
  }

  // registry에 실행 상태 등록
  try {
    registryModule.register(registryRuntimeDir, feature, {
      status:       'running',
      pid:          process.pid,
      worktreePath: executionContext.enabled ? executionContext.path : null,
      worktreeBranch: executionContext.branch,
      resultDir: executionContext.resultDir,
    });
  } catch (_) {}

  const abortControl = createPhaseAbortController({ label: 'built:run' });

  // 파이프라인 실행 — 성공/실패 모두 finally에서 lock 해제 + registry 갱신
  let exitCode = 1;
  try {
    exitCode = await _runPipelineSteps(abortControl.signal);
  } finally {
    const externallyAborted = isCurrentRunAborted();
    abortControl.cleanup();
    // lock 해제
    try { registryModule.release(registryRuntimeDir, feature); } catch (_) {}
    // registry 상태 갱신 (running → completed/failed)
    try {
      registryModule.update(registryRuntimeDir, feature, {
        status: externallyAborted || abortControl.signal.aborted ? 'aborted' : exitCode === 0 ? 'completed' : 'failed',
        pid:    null,
        worktreePath: executionContext.enabled ? executionContext.path : null,
        worktreeBranch: executionContext.branch,
        resultDir: executionContext.resultDir,
      });
    } catch (_) {}
    if (abortControl.signal.aborted) {
      tryUpdateState({ status: 'aborted', last_error: '사용자 중단 신호로 실행이 중단되었습니다.' });
    }
  }
  return exitCode;
}

// ---------------------------------------------------------------------------
// 실행 진입점
// ---------------------------------------------------------------------------

runPipeline().then((exitCode) => {
  process.exit(exitCode);
}).catch((err) => {
  console.error(`\n[built:run] 예상치 못한 오류: ${err.message}`);
  process.exit(1);
});
