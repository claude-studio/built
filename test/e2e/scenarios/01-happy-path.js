#!/usr/bin/env node
/**
 * test/e2e/scenarios/01-happy-path.js
 *
 * E2E 시나리오 1: Happy Path
 *
 * 검증 흐름:
 *   init → feature spec 생성 → run (do→check[approved]→iter→report) → 산출물 파일 존재 확인
 *
 * 목표:
 *   - 전체 파이프라인이 순서대로 실행된다
 *   - 각 단계 산출물 파일(do-result.md, check-result.md, report.md)이 생성된다
 *   - state.json status가 completed로 기록된다
 *   - 실제 claude 호출 없이 mock 기반으로 전체 흐름 시뮬레이션
 */

'use strict';

const assert = require('assert');
const path   = require('path');
const {
  makeTmpDir, rmDir,
  initProject, createFeatureSpec,
  readState, setupFakeScripts, runPatchedRun, readCallLog,
  assertFileExists,
} = require('../helpers');

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

const FEATURE = 'user-auth';

async function main() {
  console.log('\n[E2E] 시나리오 1: Happy Path (init → plan → run → 산출물 확인)\n');

  await test('전체 파이프라인 성공: do → check[approved] → iter → report', async () => {
    const dir = makeTmpDir('e2e-happy');
    try {
      // 1) 프로젝트 초기화
      initProject(dir);

      // 2) feature spec 생성 (plan 단계 시뮬레이션)
      createFeatureSpec(dir, FEATURE,
        `# Feature: ${FEATURE}\n\n사용자 인증 기능을 구현한다.\n`
      );

      const featureDir = path.join(dir, '.built', 'features', FEATURE);

      // 3) 각 단계 fake 스크립트 정의
      //    - do.js: do-result.md 생성, exit 0
      //    - check.js: check-result.md(approved) 생성, exit 0
      //    - iter.js: check-result.md가 approved이므로 즉시 exit 0
      //    - report.js: report.md 생성, exit 0
      const { fakeRunPath, callLogPath } = setupFakeScripts(dir, {
        'do.js': {
          exitCode: 0,
          outputFiles: [{
            fileName: 'do-result.md',
            content: `---\nfeature: ${FEATURE}\nphase: do\n---\n\n# Do Result\n\n구현 완료.\n`,
          }],
        },
        'check.js': {
          exitCode: 0,
          outputFiles: [{
            fileName: 'check-result.md',
            content: [
              '---',
              `feature: ${FEATURE}`,
              'status: approved',
              `checked_at: ${new Date().toISOString()}`,
              '---',
              '',
              '## 검토 결과',
              '',
              '모든 항목이 기준을 충족합니다.',
              '',
            ].join('\n'),
          }],
        },
        'iter.js': {
          exitCode: 0,
          outputFiles: [],  // approved 상태이므로 추가 파일 없음
        },
        'report.js': {
          exitCode: 0,
          outputFiles: [{
            fileName: 'report.md',
            content: `---\nfeature: ${FEATURE}\nphase: report\n---\n\n# Report\n\n작업이 완료되었습니다.\n`,
          }],
        },
      });

      // 4) 패치된 run.js 실행
      const result = runPatchedRun(FEATURE, dir, fakeRunPath);

      // 5) 검증
      assert.strictEqual(result.exitCode, 0,
        `exit 0 예상\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

      // 단계 실행 순서 검증
      const calls = readCallLog(callLogPath);
      assert.deepStrictEqual(calls, ['do.js', 'check.js', 'iter.js', 'report.js'],
        `실행 순서: ${calls}`);

      // 산출물 파일 존재 확인
      assertFileExists(path.join(featureDir, 'do-result.md'));
      assertFileExists(path.join(featureDir, 'check-result.md'));
      assertFileExists(path.join(featureDir, 'report.md'));

      // state.json 검증
      const state = readState(dir, FEATURE);
      assert.ok(state, 'state.json 존재 필요');
      assert.strictEqual(state.status, 'completed',
        `status=completed 예상, got: ${state.status}`);

    } finally {
      rmDir(dir);
    }
  });

  await test('state.json 전체 필드 정합성 확인 (phase, pid, timestamps)', async () => {
    const dir = makeTmpDir('e2e-happy-state');
    try {
      initProject(dir);
      createFeatureSpec(dir, FEATURE);

      const { fakeRunPath } = setupFakeScripts(dir, {
        'do.js':     { exitCode: 0, outputFiles: [] },
        'check.js':  { exitCode: 0, outputFiles: [] },
        'iter.js':   { exitCode: 0, outputFiles: [] },
        'report.js': { exitCode: 0, outputFiles: [] },
      });

      runPatchedRun(FEATURE, dir, fakeRunPath);

      const state = readState(dir, FEATURE);
      assert.ok(state, 'state.json 존재');
      assert.strictEqual(state.feature, FEATURE, `feature 필드: ${state.feature}`);
      assert.strictEqual(state.status, 'completed');
      assert.strictEqual(state.phase, 'report', `완료 시 phase=report, got: ${state.phase}`);
      assert.ok(typeof state.pid === 'number' && state.pid > 0,
        `pid는 양수 정수, got: ${state.pid}`);
      assert.ok(state.startedAt, 'startedAt 존재');
      assert.ok(state.updatedAt, 'updatedAt 존재');

    } finally {
      rmDir(dir);
    }
  });

  await test('feature spec 없으면 pipeline이 시작되지 않음 (exit 1)', async () => {
    const dir = makeTmpDir('e2e-no-spec');
    try {
      initProject(dir);
      // spec 파일 생성 안 함

      const { fakeRunPath } = setupFakeScripts(dir, {
        'do.js':     { exitCode: 0, outputFiles: [] },
        'check.js':  { exitCode: 0, outputFiles: [] },
        'iter.js':   { exitCode: 0, outputFiles: [] },
        'report.js': { exitCode: 0, outputFiles: [] },
      });

      const result = runPatchedRun('no-such-feature', dir, fakeRunPath);
      assert.strictEqual(result.exitCode, 1,
        `feature spec 없으면 exit 1 예상, got: ${result.exitCode}`);

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
