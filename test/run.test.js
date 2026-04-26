#!/usr/bin/env node
/**
 * test/run.test.js
 *
 * run.js 관련 단위 테스트 (Node.js assert + fs만 사용, 외부 패키지 없음)
 *
 * 테스트 범위:
 *   1. 인자 검증: feature 없음 → exit 1
 *   2. feature spec 없음 → exit 1
 *   3. 단계 순서 검증: do → check → iter → report 순서로 실행됨
 *   4. 실패 단계 중단: do 실패 시 state.json failed, check 미실행
 *   5. check 실패 시 state.json failed, iter 미실행
 *   6. state.json 갱신: 각 단계 phase/status 정상 기록
 *   7. 백그라운드 모드: --background 플래그로 즉시 exit 0
 *   8. 전체 성공: state.json status completed
 */

'use strict';

const assert       = require('assert');
const fs           = require('fs');
const os           = require('os');
const path         = require('path');
const childProcess = require('child_process');

// ---------------------------------------------------------------------------
// 테스트 큐 기반 러너 (async 지원)
// ---------------------------------------------------------------------------

const _tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  _tests.push({ name, fn });
}

async function runAll() {
  for (const { name, fn } of _tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${e.message}`);
      if (process.env.VERBOSE) console.error(e.stack);
      failed++;
    }
  }
}

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'run-test-'));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFeatureSpec(projectRoot, feature) {
  const featuresDir = path.join(projectRoot, '.built', 'features');
  fs.mkdirSync(featuresDir, { recursive: true });
  fs.writeFileSync(
    path.join(featuresDir, `${feature}.md`),
    `# Feature: ${feature}\n\nTest feature spec.\n`,
    'utf8'
  );
}

function writeState(projectRoot, feature, data) {
  const runDir = path.join(projectRoot, '.built', 'runtime', 'runs', feature);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, 'state.json'),
    JSON.stringify(data, null, 2),
    'utf8'
  );
}

function readState(projectRoot, feature) {
  const stateFile = path.join(projectRoot, '.built', 'runtime', 'runs', feature, 'state.json');
  if (!fs.existsSync(stateFile)) return null;
  return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
}

/**
 * run.js를 서브프로세스로 실행한다.
 *
 * @param {string} feature
 * @param {string} projectRoot  cwd로 사용할 임시 디렉토리
 * @param {object} [extraEnv]   추가 환경변수
 * @param {string[]} [extraArgs] 추가 인자
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>}
 */
function runRunScript(feature, projectRoot, extraEnv, extraArgs) {
  return new Promise((resolve) => {
    const runScriptPath = path.join(__dirname, '..', 'scripts', 'run.js');
    const args = feature ? [runScriptPath, feature] : [runScriptPath];
    if (extraArgs) args.push(...extraArgs);

    const child = childProcess.spawn(process.execPath, args, {
      cwd: projectRoot || process.cwd(),
      env: Object.assign({}, process.env, extraEnv || {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      resolve({ exitCode: code === null ? 1 : code, stdout, stderr });
    });
  });
}

/**
 * 가짜 스크립트 디렉토리(fakeBinDir)를 생성해 run.js가 호출할 do/check/iter/report를 교체한다.
 * run.js는 __dirname/../scripts/*.js 경로로 서브스크립트를 호출하므로
 * 동일 경로에 fake 스크립트를 배치한다.
 *
 * ── 목적과 한계 ──
 * 이 fake는 **phase orchestration fake**이다.
 * 각 단계(do/check/iter/report)의 exit code와 호출 순서만 제어하며,
 * run.js의 단계 실행 순서, 실패 중단, state.json 갱신 로직을 검증하는 데 사용된다.
 *
 * 이 fake는 실제 claude -p --output-format stream-json stdout 형식을 시뮬레이션하지 **않는다**.
 * provider 출력 파싱, stream-json 디코딩, LLM 응답 처리 등은 이 fake의 범위 밖이다.
 * provider stdout fixture 검증이 필요하면 별도 테스트를 작성해야 한다.
 *
 * @param {string} baseDir        임시 프로젝트 디렉토리
 * @param {object} exitCodes      { do: 0, check: 0, iter: 0, report: 0 }
 * @param {string[]} [callLog]    실행된 스크립트 이름을 기록할 배열 (선택)
 * @returns {string}              fake scripts 디렉토리 경로
 */
function setupFakeScripts(baseDir, exitCodes, callLog) {
  // run.js의 실제 scripts/ 디렉토리를 복사해 fake 버전으로 교체할 수 없으므로
  // 대신 프로젝트 루트(.cwd)에 별도 scripts/ 를 배치하고
  // node를 실행할 때 NODE_PATH 등으로 유도하는 방식은 복잡하다.
  //
  // 대신: 임시 디렉토리 안에 scripts/ 를 만들고, run.js의 복사본을 만들어
  // 그 복사본이 fake scripts를 참조하도록 path를 바꾼다.
  //
  // 더 단순한 접근: fake 스크립트를 OS PATH 앞에 삽입하는 방식은
  // run.js가 process.execPath로 node를 직접 호출하므로 사용 불가.
  //
  // 가장 단순한 방법: 로그 파일을 통해 호출 여부 검증.
  // run.js를 동적으로 패치하지 않고, 각 fake 스크립트가 로그 파일을 남기도록 한다.
  //
  // 실제로는 run.js가 __dirname 기준으로 scripts/*.js를 호출하므로
  // 테스트에서 __dirname = test/, 실제 scripts = ../scripts/ 이다.
  // 가짜 스크립트 배치는 불가능하다.
  //
  // 따라서 다음 전략을 사용:
  //   - 임시 디렉토리에 mini run-harness를 생성
  //   - 해당 harness는 exitCodes에 따라 각 단계 결과를 반환
  //   - 이 harness를 사용해 run.js의 핵심 로직(순서, state 갱신, 실패 처리)을 검증
  //
  // NOTE: 이 방법은 run.js를 직접 fork해서 서브스크립트 경로를 바꿀 수 없으므로
  //       대신 run.js의 실제 scripts 경로와 동일한 경로에 fake 파일을 놓는다.
  //       즉, 실제 scripts/ 디렉토리에 fake 파일을 쓰는 것은 위험하므로
  //       run.js를 복사해 __dirname을 조작하는 방식으로 한다.

  const fakeScriptsDir = path.join(baseDir, 'scripts');
  fs.mkdirSync(fakeScriptsDir, { recursive: true });

  const logFile = path.join(baseDir, 'call.log');

  // 각 단계 fake 스크립트 생성
  for (const [name, exitCode] of Object.entries(exitCodes)) {
    const scriptContent = [
      '#!/usr/bin/env node',
      `'use strict';`,
      `const fs = require('fs');`,
      `const logFile = ${JSON.stringify(logFile)};`,
      `const entry = ${JSON.stringify(name)} + '\\n';`,
      `try { fs.appendFileSync(logFile, entry); } catch(_) {}`,
      `process.exit(${exitCode});`,
    ].join('\n');
    fs.writeFileSync(path.join(fakeScriptsDir, `${name}.js`), scriptContent, 'utf8');
  }

  // fake run.js 생성: 실제 run.js를 복사하되 scripts 경로만 fakeScriptsDir로 교체
  const realRunPath = path.join(__dirname, '..', 'scripts', 'run.js');
  const realSrcDir  = path.join(__dirname, '..', 'src');
  let realRunJs = fs.readFileSync(realRunPath, 'utf8');

  // 1) src/ 모듈 require를 절대 경로로 교체 (state, hooks-runner, registry, frontmatter 등 전체)
  realRunJs = realRunJs.replace(
    /require\(path\.join\(__dirname,\s*'\.\.', 'src', '([^']+)'\)\)/g,
    (_, moduleName) => `require(${JSON.stringify(path.join(realSrcDir, moduleName))})`
  );

  // 2) runScript() 내 스크립트 경로를 fakeScriptsDir로 교체
  const patchedRunJs = realRunJs.replace(
    /const scriptPath = path\.join\(__dirname, scriptName\);/,
    `const scriptPath = path.join(${JSON.stringify(fakeScriptsDir)}, scriptName);`
  );
  const fakeRunPath = path.join(baseDir, 'run-patched.js');
  fs.writeFileSync(fakeRunPath, patchedRunJs, 'utf8');

  return { fakeScriptsDir, logFile, fakeRunPath };
}

/**
 * 패치된 run.js를 실행한다.
 *
 * @param {string} feature
 * @param {string} projectRoot
 * @param {string} fakeRunPath
 * @param {object} [extraEnv]
 * @param {string[]} [extraArgs]
 */
function runPatchedScript(feature, projectRoot, fakeRunPath, extraEnv, extraArgs) {
  return new Promise((resolve) => {
    const args = [fakeRunPath, feature];
    if (extraArgs) args.push(...extraArgs);

    const child = childProcess.spawn(process.execPath, args, {
      cwd: projectRoot,
      env: Object.assign({}, process.env, extraEnv || {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      resolve({ exitCode: code === null ? 1 : code, stdout, stderr });
    });
  });
}

function readCallLog(logFile) {
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
}

function initGitProject(projectRoot) {
  childProcess.execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
  childProcess.execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: projectRoot, stdio: 'ignore' });
  childProcess.execFileSync('git', ['config', 'user.name', 'Built Test'], { cwd: projectRoot, stdio: 'ignore' });
  fs.writeFileSync(path.join(projectRoot, 'README.md'), '# test\n', 'utf8');
  childProcess.execFileSync('git', ['add', 'README.md'], { cwd: projectRoot, stdio: 'ignore' });
  childProcess.execFileSync('git', ['commit', '-m', '초기 테스트 커밋'], { cwd: projectRoot, stdio: 'ignore' });
}

// ---------------------------------------------------------------------------
// 섹션 1: 인자 검증
// ---------------------------------------------------------------------------

console.log('\n[1] 인자 검증');

test('feature 인자 없음 → exit 1', async () => {
  const result = await runRunScript(null, process.cwd());
  assert.strictEqual(result.exitCode, 1, `exit 1 예상, got ${result.exitCode}`);
  const combined = result.stdout + result.stderr;
  assert.ok(combined.includes('Usage'), `Usage 메시지 포함 필요, got: ${combined}`);
});

// ---------------------------------------------------------------------------
// 섹션 2: feature spec 없음
// ---------------------------------------------------------------------------

console.log('\n[2] feature spec 없음');

test('feature spec(.md) 없음 → exit 1', async () => {
  const dir = makeTmpDir();
  try {
    const result = await runRunScript('no-such-feature', dir);
    assert.strictEqual(result.exitCode, 1);
    const combined = result.stdout + result.stderr;
    assert.ok(combined.includes('not found') || combined.includes('없습니다'), `오류 메시지 포함 필요, got: ${combined}`);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// 섹션 3: 단계 순서 검증 (do → check → iter → report)
// ---------------------------------------------------------------------------

console.log('\n[3] 단계 순서 검증');

test('전체 성공 시 do → check → iter → report 순서로 실행', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'order-test');
    const { logFile, fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 0, report: 0,
    });

    const result = await runPatchedScript('order-test', dir, fakeRunPath);
    assert.strictEqual(result.exitCode, 0, `exit 0 예상, stdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const calls = readCallLog(logFile);
    assert.deepStrictEqual(calls, ['do', 'check', 'iter', 'report'], `실행 순서: ${calls}`);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// 섹션 4: 실패 단계 중단 — do 실패
// ---------------------------------------------------------------------------

console.log('\n[4] 실패 단계 중단');

test('do 실패 시 check/iter/report 미실행, exit 1', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'fail-do');
    const { logFile, fakeRunPath } = setupFakeScripts(dir, {
      do: 1, check: 0, iter: 0, report: 0,
    });

    const result = await runPatchedScript('fail-do', dir, fakeRunPath);
    assert.strictEqual(result.exitCode, 1);

    const calls = readCallLog(logFile);
    assert.deepStrictEqual(calls, ['do'], `do만 실행 예상, got: ${calls}`);
  } finally {
    rmDir(dir);
  }
});

test('check 실패 시 iter/report 미실행, exit 1', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'fail-check');
    const { logFile, fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 1, iter: 0, report: 0,
    });

    const result = await runPatchedScript('fail-check', dir, fakeRunPath);
    assert.strictEqual(result.exitCode, 1);

    const calls = readCallLog(logFile);
    assert.deepStrictEqual(calls, ['do', 'check'], `do/check만 실행 예상, got: ${calls}`);
  } finally {
    rmDir(dir);
  }
});

test('iter 실패 시 report 미실행, exit 1', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'fail-iter');
    const { logFile, fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 1, report: 0,
    });

    const result = await runPatchedScript('fail-iter', dir, fakeRunPath);
    assert.strictEqual(result.exitCode, 1);

    const calls = readCallLog(logFile);
    assert.deepStrictEqual(calls, ['do', 'check', 'iter'], `do/check/iter만 실행 예상, got: ${calls}`);
  } finally {
    rmDir(dir);
  }
});

test('report 실패 → exit 1', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'fail-report');
    const { logFile, fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 0, report: 1,
    });

    const result = await runPatchedScript('fail-report', dir, fakeRunPath);
    assert.strictEqual(result.exitCode, 1);

    const calls = readCallLog(logFile);
    assert.deepStrictEqual(calls, ['do', 'check', 'iter', 'report'], `모든 단계 실행 예상, got: ${calls}`);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// 섹션 5: state.json 갱신 검증
// ---------------------------------------------------------------------------

console.log('\n[5] state.json 갱신 검증');

test('전체 성공 후 state.json status=completed', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'state-ok');
    const { fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 0, report: 0,
    });

    const result = await runPatchedScript('state-ok', dir, fakeRunPath);
    assert.strictEqual(result.exitCode, 0, `exit 0 예상, stderr: ${result.stderr}`);

    const state = readState(dir, 'state-ok');
    assert.ok(state, 'state.json 존재 필요');
    assert.strictEqual(state.status, 'completed', `status=completed 예상, got: ${state.status}`);
  } finally {
    rmDir(dir);
  }
});

test('do 실패 시 state.json status=failed, phase=do', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'state-do-fail');
    const { fakeRunPath } = setupFakeScripts(dir, {
      do: 1, check: 0, iter: 0, report: 0,
    });

    const result = await runPatchedScript('state-do-fail', dir, fakeRunPath);
    assert.strictEqual(result.exitCode, 1);

    const state = readState(dir, 'state-do-fail');
    assert.ok(state, 'state.json 존재 필요');
    assert.strictEqual(state.status, 'failed', `status=failed 예상, got: ${state.status}`);
    assert.strictEqual(state.phase, 'do', `phase=do 예상, got: ${state.phase}`);
  } finally {
    rmDir(dir);
  }
});

test('check 실패 시 state.json status=failed, phase=check', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'state-check-fail');
    const { fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 1, iter: 0, report: 0,
    });

    const result = await runPatchedScript('state-check-fail', dir, fakeRunPath);
    assert.strictEqual(result.exitCode, 1);

    const state = readState(dir, 'state-check-fail');
    assert.ok(state, 'state.json 존재 필요');
    assert.strictEqual(state.status, 'failed', `status=failed 예상`);
    assert.strictEqual(state.phase, 'check', `phase=check 예상, got: ${state.phase}`);
  } finally {
    rmDir(dir);
  }
});

test('iter 실패 시 state.json status=failed, phase=iter', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'state-iter-fail');
    const { fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 1, report: 0,
    });

    const result = await runPatchedScript('state-iter-fail', dir, fakeRunPath);
    assert.strictEqual(result.exitCode, 1);

    const state = readState(dir, 'state-iter-fail');
    assert.ok(state, 'state.json 존재 필요');
    assert.strictEqual(state.status, 'failed');
    assert.strictEqual(state.phase, 'iter');
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// 섹션 6: 백그라운드 모드
// ---------------------------------------------------------------------------

console.log('\n[6] 백그라운드 모드');

test('--background 플래그로 즉시 exit 0', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'bg-test');
    // 백그라운드 재실행 환경에서는 실제 do/check 등이 호출되므로
    // _BUILT_RUN_FORKED=1 로 설정해 재진입을 방지하고 포그라운드 경로를 테스트
    // 대신, 백그라운드 spawn 경로를 직접 테스트:
    // _BUILT_RUN_FORKED 없이 --background 전달 → 즉시 exit 0
    const result = await runRunScript('bg-test', dir, {}, ['--background']);
    // 백그라운드 spawn 성공 시 exit 0
    assert.strictEqual(result.exitCode, 0, `exit 0 예상 (백그라운드 spawn), stderr: ${result.stderr}`);
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('백그라운드') || combined.includes('background') || combined.includes('pid'),
      `백그라운드 메시지 포함 필요, got: ${combined}`
    );
  } finally {
    rmDir(dir);
  }
});

test('_BUILT_RUN_FORKED=1 환경에서 --background 없이 실행 → 파이프라인 진입', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'bg-fork');
    const { fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 0, report: 0,
    });

    // _BUILT_RUN_FORKED=1 이면 background 재분기 없이 파이프라인 실행
    const result = await runPatchedScript('bg-fork', dir, fakeRunPath, {
      _BUILT_RUN_FORKED: '1',
    });
    assert.strictEqual(result.exitCode, 0, `exit 0 예상 (포그라운드 파이프라인), stderr: ${result.stderr}`);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// 섹션 7: state.json PID 기록
// ---------------------------------------------------------------------------

console.log('\n[7] state.json PID 기록');

test('포그라운드 실행 시 state.json에 pid 기록', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'pid-test');
    const { fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 0, report: 0,
    });

    await runPatchedScript('pid-test', dir, fakeRunPath);

    const state = readState(dir, 'pid-test');
    assert.ok(state, 'state.json 존재 필요');
    assert.ok(typeof state.pid === 'number' && state.pid > 0, `pid는 양의 정수 예상, got: ${state.pid}`);
  } finally {
    rmDir(dir);
  }
});

test('git 프로젝트에서는 execution worktree를 만들고 state/registry에 pointer를 기록', async () => {
  const dir = makeTmpDir();
  try {
    initGitProject(dir);
    writeFeatureSpec(dir, 'worktree-state');
    const { logFile, fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 0, report: 0,
    });

    const result = await runPatchedScript('worktree-state', dir, fakeRunPath);
    assert.strictEqual(result.exitCode, 0, `exit 0 예상, stdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const state = readState(dir, 'worktree-state');
    assert.ok(state.execution_worktree, 'execution_worktree state 필요');
    assert.strictEqual(state.execution_worktree.enabled, true);
    assert.ok(state.execution_worktree.path.includes(path.join('.claude', 'worktrees', 'worktree-state')));
    assert.strictEqual(state.execution_worktree.branch, 'built/worktree/worktree-state');
    assert.ok(state.execution_worktree.result_dir.endsWith(path.join('.built', 'features', 'worktree-state')));
    assert.strictEqual(
      fs.existsSync(path.join(state.execution_worktree.path, '.built', 'features', 'worktree-state.md')),
      true,
      'feature spec이 worktree로 동기화되어야 함'
    );

    const registry = JSON.parse(fs.readFileSync(path.join(dir, '.built', 'runtime', 'registry.json'), 'utf8'));
    assert.strictEqual(registry.features['worktree-state'].worktreePath, state.execution_worktree.path);
    assert.strictEqual(registry.features['worktree-state'].worktreeBranch, 'built/worktree/worktree-state');
    assert.deepStrictEqual(readCallLog(logFile), ['do', 'check', 'iter', 'report']);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// 실행 진입점
// ---------------------------------------------------------------------------

runAll().then(() => {
  console.log(`\n결과: ${passed} 통과, ${failed} 실패\n`);
  process.exit(failed > 0 ? 1 : 0);
});

// ---------------------------------------------------------------------------
// 섹션 8: 비용 경고
// ---------------------------------------------------------------------------

console.log('\n[8] 비용 경고');

/**
 * progress.json을 작성한다.
 */
function writeProgressJson(projectRoot, feature, costUsd) {
  const featureDir = path.join(projectRoot, '.built', 'features', feature);
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(
    path.join(featureDir, 'progress.json'),
    JSON.stringify({ feature, phase: 'do', cost_usd: costUsd }, null, 2),
    'utf8'
  );
}

function writeProgressJsonAt(featureDir, feature, costUsd) {
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(
    path.join(featureDir, 'progress.json'),
    JSON.stringify({ feature, phase: 'do', cost_usd: costUsd }, null, 2),
    'utf8'
  );
}

/**
 * 패치된 run.js를 stdin 입력과 함께 실행한다.
 */
function runPatchedScriptWithStdin(feature, projectRoot, fakeRunPath, stdinInput, extraArgs) {
  return new Promise((resolve) => {
    const args = [fakeRunPath, feature];
    if (extraArgs) args.push(...extraArgs);

    const child = childProcess.spawn(process.execPath, args, {
      cwd: projectRoot,
      env: Object.assign({}, process.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.stdin.write(stdinInput + '\n');
    child.stdin.end();

    child.on('close', (code) => {
      resolve({ exitCode: code === null ? 1 : code, stdout, stderr });
    });
  });
}

test('비용 $1.0 이하 → 경고 없이 파이프라인 실행', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'cost-low');
    writeProgressJson(dir, 'cost-low', 0.5);
    const { logFile, fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 0, report: 0,
    });

    const result = await runPatchedScript('cost-low', dir, fakeRunPath);
    assert.strictEqual(result.exitCode, 0, `exit 0 예상, stderr: ${result.stderr}`);
    assert.ok(!result.stdout.includes('비용 경고'), `비용 경고 미출력 필요, got: ${result.stdout}`);
    const calls = readCallLog(logFile);
    assert.deepStrictEqual(calls, ['do', 'check', 'iter', 'report']);
  } finally {
    rmDir(dir);
  }
});

test('비용 $1.0 초과 + 사용자 y → 파이프라인 실행', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'cost-high-yes');
    writeProgressJson(dir, 'cost-high-yes', 1.5);
    const { logFile, fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 0, report: 0,
    });

    const result = await runPatchedScriptWithStdin('cost-high-yes', dir, fakeRunPath, 'y');
    assert.strictEqual(result.exitCode, 0, `exit 0 예상, stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('비용 경고'), `비용 경고 출력 필요, got: ${result.stdout}`);
    const calls = readCallLog(logFile);
    assert.deepStrictEqual(calls, ['do', 'check', 'iter', 'report']);
  } finally {
    rmDir(dir);
  }
});

test('비용 $1.0 초과 + 사용자 N → 실행 중단, exit 1', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'cost-high-no');
    writeProgressJson(dir, 'cost-high-no', 2.0);
    const { logFile, fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 0, report: 0,
    });

    const result = await runPatchedScriptWithStdin('cost-high-no', dir, fakeRunPath, 'N');
    assert.strictEqual(result.exitCode, 1, `exit 1 예상 (사용자 거부), stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('비용 경고'), `비용 경고 출력 필요`);
    const calls = readCallLog(logFile);
    assert.deepStrictEqual(calls, [], `스크립트 미실행 예상, got: ${calls}`);
  } finally {
    rmDir(dir);
  }
});

test('비용 $1.0 초과 + stdin 닫힘 (비대화형) → 실행 중단, exit 1', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'cost-noninteractive');
    writeProgressJson(dir, 'cost-noninteractive', 1.01);
    const { logFile, fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 0, report: 0,
    });

    const result = await new Promise((resolve) => {
      const args = [fakeRunPath, 'cost-noninteractive'];
      const child = childProcess.spawn(process.execPath, args, {
        cwd: dir,
        env: Object.assign({}, process.env),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.stdin.end();

      child.on('close', (code) => {
        resolve({ exitCode: code === null ? 1 : code, stdout, stderr });
      });
    });

    assert.strictEqual(result.exitCode, 1, `exit 1 예상 (stdin 닫힘), stderr: ${result.stderr}`);
    const calls = readCallLog(logFile);
    assert.deepStrictEqual(calls, [], `스크립트 미실행 예상, got: ${calls}`);
  } finally {
    rmDir(dir);
  }
});

test('progress.json 없음 → 비용 0으로 간주, 경고 없이 실행', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'cost-no-progress');
    const { logFile, fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 0, report: 0,
    });

    const result = await runPatchedScript('cost-no-progress', dir, fakeRunPath);
    assert.strictEqual(result.exitCode, 0, `exit 0 예상, stderr: ${result.stderr}`);
    assert.ok(!result.stdout.includes('비용 경고'), `비용 경고 미출력 필요`);
  } finally {
    rmDir(dir);
  }
});

test('worktree 재실행 비용 경고는 canonical resultDir progress.json을 읽음', async () => {
  const dir = makeTmpDir();
  try {
    initGitProject(dir);
    const feature = 'cost-worktree';
    writeFeatureSpec(dir, feature);
    const worktreePath = path.join(dir, '.claude', 'worktrees', feature);
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
    childProcess.execFileSync('git', ['worktree', 'add', '-b', `built/worktree/${feature}`, worktreePath, 'HEAD'], {
      cwd: dir,
      stdio: 'ignore',
    });
    writeProgressJsonAt(path.join(worktreePath, '.built', 'features', feature), feature, 2.0);

    const { logFile, fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 0, report: 0,
    });

    const result = await runPatchedScriptWithStdin(feature, dir, fakeRunPath, 'N');
    assert.strictEqual(result.exitCode, 1, `exit 1 예상 (사용자 거부), stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('비용 경고'), `worktree progress 비용 경고 출력 필요, got: ${result.stdout}`);
    assert.deepStrictEqual(readCallLog(logFile), [], '비용 거부 시 단계 스크립트 미실행 필요');
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// 섹션 9: dry-run 모드
// ---------------------------------------------------------------------------

console.log('\n[9] dry-run 모드');

test('--dry-run 플래그 → 계획 출력 후 exit 0, 스크립트 미실행', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'dry-run-test');
    const { logFile, fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 0, report: 0,
    });

    const result = await runPatchedScript('dry-run-test', dir, fakeRunPath, {}, ['--dry-run']);
    assert.strictEqual(result.exitCode, 0, `exit 0 예상, stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('dry-run'), `dry-run 출력 필요, got: ${result.stdout}`);
    const calls = readCallLog(logFile);
    assert.deepStrictEqual(calls, [], `스크립트 미실행 예상, got: ${calls}`);
  } finally {
    rmDir(dir);
  }
});

test('--dry-run 모드에서 비용 초과해도 경고 없이 통과', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'dry-run-high-cost');
    writeProgressJson(dir, 'dry-run-high-cost', 9.99);
    const { logFile, fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 0, report: 0,
    });

    const result = await runPatchedScript('dry-run-high-cost', dir, fakeRunPath, {}, ['--dry-run']);
    assert.strictEqual(result.exitCode, 0, `exit 0 예상, stderr: ${result.stderr}`);
    assert.ok(!result.stdout.includes('비용 경고'), `dry-run에서 비용 경고 미출력 필요`);
    assert.ok(result.stdout.includes('dry-run'), `dry-run 출력 필요`);
    const calls = readCallLog(logFile);
    assert.deepStrictEqual(calls, [], `스크립트 미실행 예상`);
  } finally {
    rmDir(dir);
  }
});

test('--dry-run 출력에 파이프라인 단계 포함', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'dry-run-stages');
    const { fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 0, report: 0,
    });

    const result = await runPatchedScript('dry-run-stages', dir, fakeRunPath, {}, ['--dry-run']);
    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.stdout.includes('Do'), `Do 단계 포함 필요`);
    assert.ok(result.stdout.includes('Check'), `Check 단계 포함 필요`);
    assert.ok(result.stdout.includes('Iter'), `Iter 단계 포함 필요`);
    assert.ok(result.stdout.includes('Report'), `Report 단계 포함 필요`);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// 섹션 10: max_cost_usd 우선순위 (run-request.json > config.json > 기본값)
// ---------------------------------------------------------------------------

console.log('\n[10] max_cost_usd 우선순위');

/**
 * run-request.json을 작성한다.
 */
function writeRunRequest(projectRoot, feature, data) {
  const runDir = path.join(projectRoot, '.built', 'runtime', 'runs', feature);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, 'run-request.json'),
    JSON.stringify(data, null, 2),
    'utf8'
  );
}

/**
 * .built/config.json을 작성한다.
 */
function writeBuiltConfig(projectRoot, data) {
  const builtDir = path.join(projectRoot, '.built');
  fs.mkdirSync(builtDir, { recursive: true });
  fs.writeFileSync(
    path.join(builtDir, 'config.json'),
    JSON.stringify(data, null, 2),
    'utf8'
  );
}

test('run-request.json max_cost_usd → 해당 임계값 사용 (초과 시 경고)', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'req-max-cost');
    // 누적 비용 $0.3, max_cost_usd $0.2 → $0.3 > $0.2 이므로 경고 출력
    writeProgressJson(dir, 'req-max-cost', 0.3);
    writeRunRequest(dir, 'req-max-cost', { max_cost_usd: 0.2 });
    const { logFile, fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 0, report: 0,
    });

    const result = await runPatchedScriptWithStdin('req-max-cost', dir, fakeRunPath, 'y');
    assert.ok(result.stdout.includes('비용 경고'), `run-request max_cost_usd 임계값 적용, 경고 출력 필요, got: ${result.stdout}`);
  } finally {
    rmDir(dir);
  }
});

test('run-request.json max_cost_usd → 이하 시 경고 없이 실행', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'req-max-cost-ok');
    // 누적 비용 $0.5, max_cost_usd $1.0 → 경고 없음
    writeProgressJson(dir, 'req-max-cost-ok', 0.5);
    writeRunRequest(dir, 'req-max-cost-ok', { max_cost_usd: 1.0 });
    const { logFile, fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 0, report: 0,
    });

    const result = await runPatchedScript('req-max-cost-ok', dir, fakeRunPath);
    assert.strictEqual(result.exitCode, 0, `exit 0 예상, stderr: ${result.stderr}`);
    assert.ok(!result.stdout.includes('비용 경고'), `경고 미출력 필요, got: ${result.stdout}`);
  } finally {
    rmDir(dir);
  }
});

test('config.json default_max_cost_usd → 해당 임계값 사용 (초과 시 경고)', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'cfg-max-cost');
    // 누적 비용 $0.4, config default_max_cost_usd $0.3 → 경고 출력
    writeProgressJson(dir, 'cfg-max-cost', 0.4);
    writeBuiltConfig(dir, {
      version: 1, max_parallel: 1, default_model: 'claude-opus-4-5',
      max_iterations: 3, cost_warn_usd: 1.0, default_max_cost_usd: 0.3,
    });
    const { logFile, fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 0, report: 0,
    });

    const result = await runPatchedScriptWithStdin('cfg-max-cost', dir, fakeRunPath, 'y');
    assert.ok(result.stdout.includes('비용 경고'), `config default_max_cost_usd 임계값 적용, 경고 출력 필요, got: ${result.stdout}`);
  } finally {
    rmDir(dir);
  }
});

test('run-request.json max_cost_usd가 config.json default_max_cost_usd보다 우선', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'priority-test');
    // 누적 비용 $0.5
    // config default_max_cost_usd $0.3 → $0.5 > $0.3 이면 경고
    // run-request max_cost_usd $1.0 → $0.5 <= $1.0 이면 경고 없음
    // run-request가 우선이므로 경고 없어야 함
    writeProgressJson(dir, 'priority-test', 0.5);
    writeBuiltConfig(dir, {
      version: 1, max_parallel: 1, default_model: 'claude-opus-4-5',
      max_iterations: 3, cost_warn_usd: 1.0, default_max_cost_usd: 0.3,
    });
    writeRunRequest(dir, 'priority-test', { max_cost_usd: 1.0 });
    const { logFile, fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 0, report: 0,
    });

    const result = await runPatchedScript('priority-test', dir, fakeRunPath);
    assert.strictEqual(result.exitCode, 0, `exit 0 예상 (run-request 우선), stderr: ${result.stderr}`);
    assert.ok(!result.stdout.includes('비용 경고'), `run-request max_cost_usd 우선 적용, 경고 미출력 필요, got: ${result.stdout}`);
  } finally {
    rmDir(dir);
  }
});

test('run-request, config 모두 없으면 기본값 $1.0 사용', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'default-threshold');
    // 누적 비용 $0.9 → 기본값 $1.0 이하, 경고 없음
    writeProgressJson(dir, 'default-threshold', 0.9);
    const { logFile, fakeRunPath } = setupFakeScripts(dir, {
      do: 0, check: 0, iter: 0, report: 0,
    });

    const result = await runPatchedScript('default-threshold', dir, fakeRunPath);
    assert.strictEqual(result.exitCode, 0, `exit 0 예상, stderr: ${result.stderr}`);
    assert.ok(!result.stdout.includes('비용 경고'), `기본값 $1.0 이하, 경고 미출력 필요`);
  } finally {
    rmDir(dir);
  }
});
