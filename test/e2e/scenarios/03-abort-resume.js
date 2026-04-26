#!/usr/bin/env node
/**
 * test/e2e/scenarios/03-abort-resume.js
 *
 * E2E 시나리오 3: Abort & Resume
 *
 * 검증 흐름:
 *   A. run 중 abort → state.json status=aborted 확인
 *   B. abort 후 resume → state.json status=planned 복귀 확인
 *   C. BUILT_MAX_ITER=1 로 max_iter 초과 → state.json status=failed 확인
 *
 * 목표:
 *   - abortCommand()가 state.json을 aborted로 갱신한다
 *   - resumeCommand()가 state.json을 planned로 복귀시킨다
 *   - 복구 시나리오(실패 → 재실행)가 올바르게 동작한다
 *   - BUILT_MAX_ITER=1 설정으로 iter 1회 후 failed 상태가 된다
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const {
  makeTmpDir, rmDir,
  initProject, createFeatureSpec, writeFeatureFile, writeCheckResult,
  readState, setupFakeScripts, runPatchedRun, BUILT_ROOT,
} = require('../helpers');

// ---------------------------------------------------------------------------
// abort/resume 모듈 로드
// ---------------------------------------------------------------------------

const { abortCommand }  = require(path.join(BUILT_ROOT, 'scripts', 'abort'));
const { resumeCommand } = require(path.join(BUILT_ROOT, 'scripts', 'resume'));

// ---------------------------------------------------------------------------
// state.json 직접 생성 헬퍼
// ---------------------------------------------------------------------------

function createRunningState(projectRoot, feature) {
  const runDir = path.join(projectRoot, '.built', 'runtime', 'runs', feature);
  fs.mkdirSync(runDir, { recursive: true });
  const state = {
    feature,
    phase:      'do',
    status:     'running',
    pid:        process.pid,
    heartbeat:  new Date().toISOString(),
    startedAt:  new Date().toISOString(),
    updatedAt:  new Date().toISOString(),
    attempt:    0,
    last_error: null,
  };
  fs.writeFileSync(path.join(runDir, 'state.json'),
    JSON.stringify(state, null, 2) + '\n', 'utf8');
  return runDir;
}

// ---------------------------------------------------------------------------
// 테스트 러너
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL ${name}`);
    console.log(`       ${e.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// 시나리오
// ---------------------------------------------------------------------------

const FEATURE = 'dashboard-ui';

async function main() {
  console.log('\n[E2E] 시나리오 3: Abort & Resume + Max Iter 초과\n');

  // -------------------------------------------------------------------------
  // A. Abort 시나리오
  // -------------------------------------------------------------------------

  await test('abort: running 상태 feature → state.json status=aborted', async () => {
    const dir = makeTmpDir('e2e-abort');
    try {
      initProject(dir);
      createRunningState(dir, FEATURE);

      const { aborted } = await abortCommand(dir, FEATURE);
      assert.ok(aborted, 'aborted=true 예상');

      const state = readState(dir, FEATURE);
      assert.ok(state, 'state.json 존재 필요');
      assert.strictEqual(state.status, 'aborted',
        `status=aborted 예상, got: ${state.status}`);

    } finally {
      rmDir(dir);
    }
  });

  await test('abort: 이미 aborted 상태이면 aborted=false 반환', async () => {
    const dir = makeTmpDir('e2e-abort-dup');
    try {
      initProject(dir);
      createRunningState(dir, FEATURE);

      // 1차 abort
      await abortCommand(dir, FEATURE);

      // 2차 abort (이미 aborted)
      const { aborted } = await abortCommand(dir, FEATURE);
      assert.strictEqual(aborted, false, '이미 aborted이면 false 반환 예상');

    } finally {
      rmDir(dir);
    }
  });

  await test('abort: lock 파일이 있으면 삭제된다', async () => {
    const dir = makeTmpDir('e2e-abort-lock');
    try {
      initProject(dir);
      createRunningState(dir, FEATURE);

      // lock 파일 생성
      const locksDir = path.join(dir, '.built', 'runtime', 'locks');
      fs.mkdirSync(locksDir, { recursive: true });
      const lockFile = path.join(locksDir, `${FEATURE}.lock`);
      fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid }), 'utf8');

      await abortCommand(dir, FEATURE);

      assert.ok(!fs.existsSync(lockFile), 'lock 파일이 삭제되어야 함');

    } finally {
      rmDir(dir);
    }
  });

  // -------------------------------------------------------------------------
  // B. Resume 시나리오
  // -------------------------------------------------------------------------

  await test('resume: abort 후 resume → state.json status=planned 복귀', async () => {
    const dir = makeTmpDir('e2e-resume');
    try {
      initProject(dir);
      createRunningState(dir, FEATURE);

      // abort 먼저
      await abortCommand(dir, FEATURE);

      const stateAfterAbort = readState(dir, FEATURE);
      assert.strictEqual(stateAfterAbort.status, 'aborted');

      // resume
      const { resumed } = resumeCommand(dir, FEATURE);
      assert.ok(resumed, 'resumed=true 예상');

      const stateAfterResume = readState(dir, FEATURE);
      assert.ok(stateAfterResume, 'state.json 존재');
      assert.strictEqual(stateAfterResume.status, 'planned',
        `status=planned 예상, got: ${stateAfterResume.status}`);
      assert.strictEqual(stateAfterResume.last_error, null,
        'resume 후 last_error가 초기화되어야 함');

    } finally {
      rmDir(dir);
    }
  });

  await test('resume: failed 상태에서도 planned로 복귀 가능', async () => {
    const dir = makeTmpDir('e2e-resume-failed');
    try {
      initProject(dir);
      const runDir = createRunningState(dir, FEATURE);

      // failed 상태로 직접 설정
      const stateFile = path.join(runDir, 'state.json');
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      state.status = 'failed';
      state.last_error = 'do.js exited with code 1';
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');

      const { resumed } = resumeCommand(dir, FEATURE);
      assert.ok(resumed, 'failed에서도 resume=true 예상');

      const stateAfterResume = readState(dir, FEATURE);
      assert.strictEqual(stateAfterResume.status, 'planned');
      assert.strictEqual(stateAfterResume.last_error, null, 'last_error 초기화 확인');

    } finally {
      rmDir(dir);
    }
  });

  await test('resume: running 상태에서는 resume 불가 (resumed=false)', async () => {
    const dir = makeTmpDir('e2e-resume-running');
    try {
      initProject(dir);
      createRunningState(dir, FEATURE);

      // running 상태에서 resume 시도
      const { resumed } = resumeCommand(dir, FEATURE);
      assert.strictEqual(resumed, false,
        'running 상태에서 resume=false 예상');

    } finally {
      rmDir(dir);
    }
  });

  // -------------------------------------------------------------------------
  // C. BUILT_MAX_ITER=1 초과 → failed 시나리오
  // -------------------------------------------------------------------------

  await test('max_iter 초과: BUILT_MAX_ITER=1로 run 실패 → state.json status=failed', async () => {
    const dir = makeTmpDir('e2e-maxiter');
    try {
      initProject(dir);
      createFeatureSpec(dir, FEATURE);
      writeFeatureFile(dir, FEATURE, 'do-result.md', '# Do Result\n\n구현 완료.\n');

      // iter.js가 exit 1 반환 (max iter 초과 시뮬레이션)
      const { fakeRunPath } = setupFakeScripts(dir, {
        'do.js':     { exitCode: 0, outputFiles: [] },
        'check.js':  { exitCode: 0, outputFiles: [] },
        'iter.js':   { exitCode: 1, outputFiles: [] },  // max iter 초과
        'report.js': { exitCode: 0, outputFiles: [] },
      });

      const result = runPatchedRun(FEATURE, dir, fakeRunPath, {
        BUILT_MAX_ITER: '1',
      });

      assert.strictEqual(result.exitCode, 1,
        `max iter 초과 시 exit 1 예상, got: ${result.exitCode}`);

      const state = readState(dir, FEATURE);
      assert.ok(state, 'state.json 존재 필요');
      assert.strictEqual(state.status, 'failed',
        `status=failed 예상, got: ${state.status}`);
      assert.strictEqual(state.phase, 'iter',
        `실패 phase=iter 예상, got: ${state.phase}`);

    } finally {
      rmDir(dir);
    }
  });

  await test('abort 후 resume 후 재실행 → 완료 가능 (복구 플로우)', async () => {
    const dir = makeTmpDir('e2e-full-recovery');
    try {
      initProject(dir);
      createFeatureSpec(dir, FEATURE);

      // 1) 실행 중 abort
      createRunningState(dir, FEATURE);
      await abortCommand(dir, FEATURE);

      let state = readState(dir, FEATURE);
      assert.strictEqual(state.status, 'aborted');

      // 2) resume
      resumeCommand(dir, FEATURE);
      state = readState(dir, FEATURE);
      assert.strictEqual(state.status, 'planned');

      // 3) 재실행 (모든 단계 성공)
      const { fakeRunPath } = setupFakeScripts(dir, {
        'do.js':     { exitCode: 0, outputFiles: [] },
        'check.js':  { exitCode: 0, outputFiles: [] },
        'iter.js':   { exitCode: 0, outputFiles: [] },
        'report.js': { exitCode: 0, outputFiles: [] },
      });

      const result = runPatchedRun(FEATURE, dir, fakeRunPath);
      assert.strictEqual(result.exitCode, 0,
        `재실행 성공 예상\nstderr: ${result.stderr}`);

      state = readState(dir, FEATURE);
      assert.strictEqual(state.status, 'completed',
        `최종 status=completed 예상, got: ${state.status}`);

    } finally {
      rmDir(dir);
    }
  });

  // 결과 출력
  console.log(`\n  결과: ${passed} 통과, ${failed} 실패\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
