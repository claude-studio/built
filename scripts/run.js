#!/usr/bin/env node
/**
 * run.js
 *
 * /built:run 스킬 헬퍼 — Do→Check→Iter→Report 전체 파이프라인을 오케스트레이션.
 *
 * 사용법:
 *   node scripts/run.js <feature> [--background]
 *
 * 동작:
 *   1. .built/runtime/runs/<feature>/run-request.json 읽기 (선택, 모델 설정용)
 *   2. .built/runtime/runs/<feature>/state.json 초기화 (phase: do, status: running)
 *   3. scripts/do.js → scripts/check.js → scripts/iter.js → scripts/report.js 순서로 실행
 *   4. 각 단계 사이 state.json phase 갱신
 *   5. 각 단계 실패 시 state.json에 failed 기록 후 종료
 *   6. 완료 시 state.json status: completed 갱신
 *
 * --background 플래그:
 *   - 파이프라인을 분리된 백그라운드 프로세스로 실행
 *   - PID를 state.json에 기록
 *   - 즉시 반환 (폴링은 caller 책임)
 *
 * Exit codes:
 *   0 — 파이프라인 완료 (포그라운드) 또는 백그라운드 spawn 성공
 *   1 — 오류
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

if (!feature) {
  console.error('Usage: node scripts/run.js <feature> [--background]');
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
// 백그라운드 모드 처리
// ---------------------------------------------------------------------------

// 백그라운드 재진입 방지용 환경변수
const FORK_ENV_KEY = '_BUILT_RUN_FORKED';

if (background && !process.env[FORK_ENV_KEY]) {
  // 자신을 detached 프로세스로 재실행 (--background 없이)
  const nodeArgs = [__filename, feature];
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
// 메인 파이프라인
// ---------------------------------------------------------------------------

async function runPipeline() {
  console.log(`[built:run] feature: ${feature}`);
  console.log(`[built:run] 파이프라인: Do → Check → Iter → Report\n`);

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
