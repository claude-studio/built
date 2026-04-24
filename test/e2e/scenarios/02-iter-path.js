#!/usr/bin/env node
/**
 * test/e2e/scenarios/02-iter-path.js
 *
 * E2E 시나리오 2: Iter Path (needs_changes → iter → approved)
 *
 * 검증 흐름:
 *   A. check[approved] → iter가 즉시 exit 0 (루프 없음)
 *   B. needs_changes → 1회 iter 후 approved → exit 0
 *   C. BUILT_MAX_ITER=1 로 needs_changes가 계속되면 exit 1 (max iter 초과)
 *
 * 목표:
 *   - check-result.md 상태에 따라 iter 루프 동작이 달라진다
 *   - approved 달성 시 exit 0, max iter 초과 시 exit 1 반환
 *   - 실제 claude 호출 없이 mock 기반으로 전체 흐름 시뮬레이션
 */

'use strict';

const assert       = require('assert');
const fs           = require('fs');
const path         = require('path');
const childProcess = require('child_process');
const {
  makeTmpDir, rmDir,
  initProject, createFeatureSpec, writeFeatureFile, writeCheckResult,
  readState, BUILT_ROOT,
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
// iter.js 패치 실행 헬퍼
// ---------------------------------------------------------------------------

/**
 * scripts/iter.js를 패치해 실행한다.
 * - pipeline-runner.js runPipeline → mock (즉시 success: true)
 * - check.js → fakeCheckBehavior에 따라 approved 또는 needs_changes 반환
 *
 * @param {string} feature
 * @param {string} projectRoot
 * @param {'approved'|'needs_changes'} checkBehavior  fake check.js가 반환할 status
 * @param {object} [extraEnv]
 * @returns {{ exitCode, stdout, stderr }}
 */
function runIterScript(feature, projectRoot, checkBehavior, extraEnv) {
  const realIterPath = path.join(BUILT_ROOT, 'scripts', 'iter.js');
  const realSrcDir   = path.join(BUILT_ROOT, 'src');
  const featureDirExpr = JSON.stringify(path.join(projectRoot, '.built', 'features'));

  let src = fs.readFileSync(realIterPath, 'utf8');

  // require(path.join(__dirname, '..', 'src', 'X')) → 절대경로
  src = src.replace(
    /require\(path\.join\(__dirname,\s*'\.\.', 'src', '([^']+)'\)\)/g,
    (_, mod) => `require(${JSON.stringify(path.join(realSrcDir, mod))})`
  );

  // pipeline-runner mock (Do 재실행 → 즉시 success)
  const mockPipelineRunner = path.join(projectRoot, '_mock_pipeline_runner.js');
  fs.writeFileSync(mockPipelineRunner, [
    "'use strict';",
    `module.exports = {`,
    `  runPipeline: async function() {`,
    `    return { success: true, exitCode: 0 };`,
    `  }`,
    `};`,
  ].join('\n'), 'utf8');

  src = src.replace(
    /require\(["'].*?pipeline-runner["']\)/,
    `require(${JSON.stringify(mockPipelineRunner)})`
  );

  // fake check.js — checkBehavior에 따라 다른 check-result.md를 생성
  const fakeCheckJs = path.join(projectRoot, '_fake_check.js');
  if (checkBehavior === 'approved') {
    // 항상 approved 반환
    fs.writeFileSync(fakeCheckJs, [
      '#!/usr/bin/env node',
      "'use strict';",
      "const fs = require('fs'), path = require('path');",
      `const feature = process.argv[2] || '';`,
      `const featureDir = path.join(${featureDirExpr}, feature);`,
      `fs.mkdirSync(featureDir, { recursive: true });`,
      `fs.writeFileSync(path.join(featureDir, 'check-result.md'), [`,
      `  '---', 'feature: ' + feature, 'status: approved',`,
      `  'checked_at: ' + new Date().toISOString(), '---', '', '## 검토 결과', '', 'iter 후 승인됨.', '',`,
      `].join('\\n'), 'utf8');`,
      `process.exit(0);`,
    ].join('\n'), 'utf8');
  } else {
    // 항상 needs_changes 반환 (max iter 초과 시뮬레이션)
    fs.writeFileSync(fakeCheckJs, [
      '#!/usr/bin/env node',
      "'use strict';",
      "const fs = require('fs'), path = require('path');",
      `const feature = process.argv[2] || '';`,
      `const featureDir = path.join(${featureDirExpr}, feature);`,
      `fs.mkdirSync(featureDir, { recursive: true });`,
      `fs.writeFileSync(path.join(featureDir, 'check-result.md'), [`,
      `  '---', 'feature: ' + feature, 'status: needs_changes',`,
      `  'checked_at: ' + new Date().toISOString(), '---', '', '## 검토 결과', '',`,
      `  '수정이 필요합니다.', '', '## 수정 필요 항목', '', '- 버그 수정 필요', '',`,
      `].join('\\n'), 'utf8');`,
      `process.exit(0);`,
    ].join('\n'), 'utf8');
  }

  // iter.js의 check.js 경로를 fake로 교체
  src = src.replace(
    /const checkScriptPath = path\.join\(__dirname, 'check\.js'\);/,
    `const checkScriptPath = ${JSON.stringify(fakeCheckJs)};`
  );

  const fakeIterPath = path.join(projectRoot, '_iter_patched.js');
  fs.writeFileSync(fakeIterPath, src, 'utf8');

  const result = childProcess.spawnSync(
    process.execPath,
    [fakeIterPath, feature],
    {
      cwd: projectRoot,
      env: Object.assign({}, process.env, { NO_NOTIFY: '1' }, extraEnv || {}),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    }
  );

  return {
    exitCode: result.status === null ? 1 : result.status,
    stdout:   (result.stdout || Buffer.alloc(0)).toString(),
    stderr:   (result.stderr  || Buffer.alloc(0)).toString(),
  };
}

// ---------------------------------------------------------------------------
// state.json 초기화 헬퍼
// ---------------------------------------------------------------------------

function initRunState(projectRoot, feature, overrides) {
  const runDir = path.join(projectRoot, '.built', 'runtime', 'runs', feature);
  fs.mkdirSync(runDir, { recursive: true });
  const state = Object.assign({
    feature,
    phase:      'iter',
    status:     'running',
    pid:        null,
    heartbeat:  null,
    startedAt:  new Date().toISOString(),
    updatedAt:  new Date().toISOString(),
    attempt:    0,
    last_error: null,
  }, overrides || {});
  fs.writeFileSync(path.join(runDir, 'state.json'),
    JSON.stringify(state, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// 시나리오
// ---------------------------------------------------------------------------

const FEATURE = 'payment-flow';

async function main() {
  console.log('\n[E2E] 시나리오 2: Iter Path (needs_changes → iter → approved)\n');

  // -------------------------------------------------------------------------
  // A. check[approved] → iter 즉시 종료
  // -------------------------------------------------------------------------

  await test('iter: check-result.md가 approved이면 즉시 exit 0 (루프 없음)', async () => {
    const dir = makeTmpDir('e2e-iter-approved');
    try {
      initProject(dir);
      createFeatureSpec(dir, FEATURE);
      initRunState(dir, FEATURE);

      // do-result.md 필요
      writeFeatureFile(dir, FEATURE, 'do-result.md', '# Do Result\n\n구현 완료.\n');
      // check-result.md를 approved로 설정
      writeCheckResult(dir, FEATURE, 'approved');

      // approved이므로 루프 없이 즉시 exit 0
      const result = runIterScript(FEATURE, dir, 'approved');
      assert.strictEqual(result.exitCode, 0,
        `approved 상태에서 exit 0 예상\nstderr: ${result.stderr}`);

    } finally {
      rmDir(dir);
    }
  });

  // -------------------------------------------------------------------------
  // B. needs_changes → 1회 iter → approved
  // -------------------------------------------------------------------------

  await test('iter: needs_changes → 1회 iter 후 approved 달성 → exit 0', async () => {
    const dir = makeTmpDir('e2e-iter-needs');
    try {
      initProject(dir);
      createFeatureSpec(dir, FEATURE);
      initRunState(dir, FEATURE);

      writeFeatureFile(dir, FEATURE, 'do-result.md', '# Do Result\n\n1차 구현 완료.\n');
      // 초기 check-result.md를 needs_changes로 설정
      writeCheckResult(dir, FEATURE, 'needs_changes', ['버그 수정 필요', '테스트 추가 필요']);

      // fake check → 항상 approved (1회 iter 후 approved 달성 시뮬레이션)
      const result = runIterScript(FEATURE, dir, 'approved', { BUILT_MAX_ITER: '3' });

      assert.strictEqual(result.exitCode, 0,
        `1회 iter 후 approved → exit 0 예상\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

      // check-result.md가 approved로 갱신됐는지 확인
      const checkResultPath = path.join(dir, '.built', 'features', FEATURE, 'check-result.md');
      assert.ok(fs.existsSync(checkResultPath), 'check-result.md 존재 필요');
      const content = fs.readFileSync(checkResultPath, 'utf8');
      assert.ok(content.includes('approved'),
        `check-result.md에 approved 포함 필요`);

    } finally {
      rmDir(dir);
    }
  });

  // -------------------------------------------------------------------------
  // C. BUILT_MAX_ITER=1 로 needs_changes 계속 → max iter 초과 → exit 1
  // -------------------------------------------------------------------------

  await test('iter: BUILT_MAX_ITER=1 + needs_changes 지속 → exit 1 (max iter 초과)', async () => {
    const dir = makeTmpDir('e2e-iter-maxiter');
    try {
      initProject(dir);
      createFeatureSpec(dir, FEATURE);
      initRunState(dir, FEATURE);

      writeFeatureFile(dir, FEATURE, 'do-result.md', '# Do Result\n\n구현 완료.\n');
      // 초기 needs_changes 설정
      writeCheckResult(dir, FEATURE, 'needs_changes', ['수정 필요']);

      // fake check → 항상 needs_changes (수렴 불가 시뮬레이션)
      // BUILT_MAX_ITER=1이므로 1회 시도 후 max iter 초과
      const result = runIterScript(FEATURE, dir, 'needs_changes', { BUILT_MAX_ITER: '1' });

      assert.strictEqual(result.exitCode, 1,
        `max iter 초과 시 exit 1 예상\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

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
