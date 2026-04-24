#!/usr/bin/env node
/**
 * run.js
 *
 * /built:run 스킬 헬퍼 — Do→Check→Iter→Report 전체 파이프라인을 오케스트레이션.
 *
 * 사용법:
 *   node scripts/run.js <feature> [--background] [--dry-run]
 *
 * 동작:
 *   1. .built/runtime/runs/<feature>/run-request.json 읽기 (선택, 모델 설정용 및 dry_run 설정)
 *   2. .built/features/<feature>/progress.json 에서 누적 비용 확인
 *      - total_cost_usd > $1.0 이면 사용자 확인 요청 (dry-run 모드 제외)
 *   3. .built/runtime/runs/<feature>/state.json 초기화 (phase: do, status: running)
 *   4. scripts/do.js → scripts/check.js → scripts/iter.js → scripts/report.js 순서로 실행
 *   5. 각 단계 사이 state.json phase 갱신
 *   6. 각 단계 실패 시 state.json에 failed 기록 후 종료
 *   7. 완료 시 state.json status: completed 갱신
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

// ---------------------------------------------------------------------------
// 인자 파싱
// ---------------------------------------------------------------------------

const args       = process.argv.slice(2);
const feature    = args.find((a) => !a.startsWith('--'));
const background = args.includes('--background');
const dryRunFlag = args.includes('--dry-run');

if (!feature) {
  console.error('Usage: node scripts/run.js <feature> [--background] [--dry-run]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 경로 설정
// ---------------------------------------------------------------------------

const projectRoot    = process.cwd();
const specPath       = path.join(projectRoot, '.built', 'features', `${feature}.md`);
const featureDir     = path.join(projectRoot, '.built', 'features', feature);
const runDir         = path.join(projectRoot, '.built', 'runtime', 'runs', feature);
const runRequestPath = path.join(runDir, 'run-request.json');
const stateFilePath  = path.join(runDir, 'state.json');

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

function readRunRequest() {
  try {
    return JSON.parse(fs.readFileSync(runRequestPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

const runRequest = readRunRequest();
// --dry-run 플래그 또는 run-request.json의 dry_run: true 설정 시 dry-run 모드
const dryRun = dryRunFlag || (runRequest !== null && runRequest.dry_run === true);

// ---------------------------------------------------------------------------
// 백그라운드 모드 처리
// ---------------------------------------------------------------------------

// 백그라운드 재진입 방지용 환경변수
const FORK_ENV_KEY = '_BUILT_RUN_FORKED';

if (background && !process.env[FORK_ENV_KEY]) {
  // 자신을 detached 프로세스로 재실행 (--background 없이)
  const nodeArgs = [__filename, feature];
  if (dryRunFlag) nodeArgs.push('--dry-run');
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
function runScript(scriptName) {
  const scriptPath = path.join(__dirname, scriptName);
  const result = childProcess.spawnSync(process.execPath, [scriptPath, feature], {
    stdio:   'inherit',
    env:     process.env,
    cwd:     projectRoot,
  });

  const exitCode = result.status === null ? 1 : result.status;
  return { success: exitCode === 0, exitCode };
}

// ---------------------------------------------------------------------------
// 유틸: state.json 안전 갱신
// ---------------------------------------------------------------------------

function tryUpdateState(updates) {
  try {
    if (fs.existsSync(stateFilePath)) {
      updateState(runDir, updates);
    }
  } catch (_) {}
}

function tryMarkFailed(phase, reason) {
  tryUpdateState({ phase, status: 'failed', last_error: reason });
}

// ---------------------------------------------------------------------------
// 비용 경고: progress.json에서 누적 비용 확인 후 사용자 확인 요청
// ---------------------------------------------------------------------------

const COST_THRESHOLD_USD = 1.0;

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

    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    process.stdout.write(
      `\n[built:run] 비용 경고: 이 feature의 누적 비용이 $${cost.toFixed(4)} 입니다.\n` +
      `[built:run]    임계값($${COST_THRESHOLD_USD.toFixed(2)})을 초과했습니다.\n` +
      `[built:run] 계속 진행하시겠습니까? (y/N): `
    );

    let answered = false;

    rl.once('line', (answer) => {
      answered = true;
      const confirmed = answer.trim().toLowerCase() === 'y';
      resolve(confirmed);  // resolve 먼저 호출 후 close (rl.close가 'close' 이벤트를 동기 발생시킴)
      rl.close();
    });

    // stdin이 닫혀 있으면 (비대화형 환경) 기본값 N으로 처리
    rl.once('close', () => {
      if (!answered) resolve(false);
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
  if (runRequest && runRequest.model) {
    console.log(`Model: ${runRequest.model}`);
  }
  if (runRequest && runRequest.dry_run) {
    console.log('dry_run: true (run-request.json 설정)');
  }
  console.log('\n파이프라인 단계:');
  console.log('  1. Do    — feature 구현 (scripts/do.js)');
  console.log('  2. Check — 품질 검증 (scripts/check.js)');
  console.log('  3. Iter  — 반복 개선 (scripts/iter.js)');
  console.log('  4. Report — 결과 요약 (scripts/report.js)');
  console.log('\nSpec 미리보기:');
  console.log('---');
  console.log(specContent.trim());
  if (specContent.length >= 500) console.log('...(이하 생략)');
  console.log('---');
  console.log('\n[built:run] [dry-run] 완료. 실제 실행하려면 --dry-run 없이 다시 실행하세요.');
}

// ---------------------------------------------------------------------------
// 메인 파이프라인
// ---------------------------------------------------------------------------

async function runPipeline() {
  console.log(`[built:run] feature: ${feature}`);

  // dry-run 모드: 계획만 출력하고 종료
  if (dryRun) {
    printDryRunPlan();
    return 0;
  }

  console.log(`[built:run] 파이프라인: Do → Check → Iter → Report\n`);

  // 비용 경고 확인
  const proceed = await checkCostAndConfirm();
  if (!proceed) {
    console.log('\n[built:run] 사용자가 실행을 취소했습니다.');
    return 1;
  }

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
    });
  } catch (e) {
    console.warn(`[built:run] state.json 초기화 경고: ${e.message}`);
  }

  // ---- Do ----
  console.log('[built:run] [1/4] Do 단계 시작...');
  tryUpdateState({ phase: 'do', status: 'running', heartbeat: new Date().toISOString() });

  const doResult = runScript('do.js');
  if (!doResult.success) {
    console.error(`\n[built:run] Do 실패 (exit ${doResult.exitCode})`);
    tryMarkFailed('do', `do.js exited with code ${doResult.exitCode}`);
    return 1;
  }
  console.log('[built:run] [1/4] Do 완료\n');

  // ---- Check ----
  console.log('[built:run] [2/4] Check 단계 시작...');
  tryUpdateState({ phase: 'check', status: 'running', heartbeat: new Date().toISOString() });

  const checkResult = runScript('check.js');
  if (!checkResult.success) {
    console.error(`\n[built:run] Check 실패 (exit ${checkResult.exitCode})`);
    tryMarkFailed('check', `check.js exited with code ${checkResult.exitCode}`);
    return 1;
  }
  console.log('[built:run] [2/4] Check 완료\n');

  // ---- Iter ----
  console.log('[built:run] [3/4] Iter 단계 시작...');
  tryUpdateState({ phase: 'iter', status: 'running', heartbeat: new Date().toISOString() });

  const iterResult = runScript('iter.js');
  if (!iterResult.success) {
    console.error(`\n[built:run] Iter 실패 (exit ${iterResult.exitCode})`);
    tryMarkFailed('iter', `iter.js exited with code ${iterResult.exitCode}`);
    return 1;
  }
  console.log('[built:run] [3/4] Iter 완료\n');

  // ---- Report ----
  console.log('[built:run] [4/4] Report 단계 시작...');
  tryUpdateState({ phase: 'report', status: 'running', heartbeat: new Date().toISOString() });

  const reportResult = runScript('report.js');
  if (!reportResult.success) {
    console.error(`\n[built:run] Report 실패 (exit ${reportResult.exitCode})`);
    tryMarkFailed('report', `report.js exited with code ${reportResult.exitCode}`);
    return 1;
  }
  console.log('[built:run] [4/4] Report 완료\n');

  // ---- 완료 ----
  tryUpdateState({ phase: 'report', status: 'completed', last_error: null });

  console.log('[built:run] 파이프라인 완료!');
  console.log(`  state.json: ${stateFilePath}`);

  const reportMd = path.join(featureDir, 'report.md');
  if (fs.existsSync(reportMd)) {
    console.log(`  report.md: ${reportMd}`);
  }

  return 0;
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
