#!/usr/bin/env node
/**
 * smoke-compare-providers.js
 *
 * Claude/Codex real comparison smoke — opt-in.
 *
 * 기본 테스트에서는 실행하지 않는다. 다음처럼 명시적으로 opt-in한다.
 *   BUILT_COMPARE_REAL_SMOKE=1 node scripts/smoke-compare-providers.js
 *
 * 동작:
 *   1. Claude CLI 가용성과 Codex CLI 인증 상태를 확인한다.
 *   2. 임시 git repo를 생성하고 간단한 feature spec을 커밋한다.
 *   3. comparison 설정이 포함된 run-request.json을 작성한다.
 *   4. compare-providers.js를 실행해 Claude/Codex 각각 do phase를 실행한다.
 *   5. 비교 report와 candidate별 artifact(diff.patch, verification.json)를 검증한다.
 *
 * 완료 기준:
 *   - report.md가 생성되고 "자동 winner" 미선정 문구가 포함된다.
 *   - claude / codex 각 candidate의 output directory가 격리되어 생성된다.
 *   - 각 candidate에 diff.patch, verification.json, state.json이 존재한다.
 *   - canonical .built/features/ 결과 파일이 덮어쓰이지 않는다.
 *
 * 실패 시 원인 축 안내:
 *   - provider_unavailable  : Claude CLI 또는 Codex CLI 미설치
 *   - 인증(auth)            : Claude 또는 Codex 로그인 미완료
 *   - comparison_setup      : run-request.json 또는 comparison 설정 오류
 *   - candidate_failed      : 하나 이상의 candidate do phase 실패
 *   - artifact_missing      : 기대 산출물(report.md, diff.patch 등) 미생성
 *   - timeout               : 실행 시간이 제한(40분)을 초과
 *
 * 환경변수:
 *   BUILT_COMPARE_REAL_SMOKE=1  실제 실행 opt-in (필수)
 *   BUILT_KEEP_SMOKE_DIR=1      임시 디렉토리를 삭제하지 않고 유지
 *
 * Exit codes:
 *   0 — 성공 (또는 skip)
 *   1 — 오류
 *
 * 외부 npm 패키지 없음.
 */

'use strict';

const fs           = require('fs');
const os           = require('os');
const path         = require('path');
const childProcess = require('child_process');

const { checkLogin } = require('../src/providers/codex');
const { generateComparisonId } = require('../src/providers/comparison-config');

const TAG = '[built:smoke-compare]';

// ---------------------------------------------------------------------------
// opt-in guard
// ---------------------------------------------------------------------------

if (process.env.BUILT_COMPARE_REAL_SMOKE !== '1') {
  console.log(
    `${TAG} skip: BUILT_COMPARE_REAL_SMOKE=1 설정 시 Claude/Codex real comparison smoke를 실행합니다.`
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------

function spawnCmd(cmd, args, options) {
  const r = childProcess.spawnSync(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  return {
    ok:     r.status === 0,
    stdout: (r.stdout  || Buffer.alloc(0)).toString(),
    stderr: (r.stderr  || Buffer.alloc(0)).toString(),
    status: r.status,
    error:  r.error,
  };
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// 사전 점검: Claude CLI 가용성
// ---------------------------------------------------------------------------

function checkClaudeAvailability() {
  const r = spawnCmd('claude', ['--version']);
  if (!r.ok || r.error) {
    return { available: false, detail: 'claude CLI가 설치되지 않았거나 PATH에 없습니다. npm install -g @anthropic-ai/claude-code 후 재시도하세요.' };
  }
  return { available: true, detail: r.stdout.trim() };
}

// ---------------------------------------------------------------------------
// 사전 점검 실행
// ---------------------------------------------------------------------------

console.log(`${TAG} 사전 점검 시작...`);

const claudeCheck = checkClaudeAvailability();
if (!claudeCheck.available) {
  console.error(`${TAG} 원인축: provider_unavailable — ${claudeCheck.detail}`);
  process.exit(1);
}
console.log(`${TAG} Claude CLI: ${claudeCheck.detail}`);

const codexCheck = checkLogin();
if (!codexCheck.available) {
  if (codexCheck.detail && codexCheck.detail.includes('app-server')) {
    console.error(`${TAG} 원인축: provider_unavailable (app-server) — ${codexCheck.detail}`);
  } else {
    console.error(`${TAG} 원인축: provider_unavailable — ${codexCheck.detail}`);
  }
  process.exit(1);
}
if (!codexCheck.loggedIn) {
  console.error(`${TAG} 원인축: 인증(auth) — Codex 로그인이 필요합니다. codex login 실행 후 재시도하세요.`);
  process.exit(1);
}
console.log(`${TAG} Codex CLI: ${codexCheck.detail}`);

// ---------------------------------------------------------------------------
// 임시 프로젝트 디렉토리 설정
// ---------------------------------------------------------------------------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'built-compare-smoke-'));
const feature = 'compare-smoke';

console.log(`${TAG} 임시 디렉토리: ${tmpDir}`);

/**
 * 임시 디렉토리를 정리한다.
 * BUILT_KEEP_SMOKE_DIR=1이면 유지한다.
 */
function cleanup() {
  if (process.env.BUILT_KEEP_SMOKE_DIR === '1') {
    console.log(`${TAG} BUILT_KEEP_SMOKE_DIR=1: 임시 디렉토리 유지: ${tmpDir}`);
    return;
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
}

try {
  // -------------------------------------------------------------------------
  // 임시 git repo 초기화
  // -------------------------------------------------------------------------

  const gitInit = spawnCmd('git', ['init'], { cwd: tmpDir, stdio: 'pipe' });
  if (!gitInit.ok) {
    console.error(`${TAG} 원인축: comparison_setup — git init 실패: ${gitInit.stderr.trim()}`);
    process.exit(1);
  }

  // git 최소 사용자 설정 (commit을 위해 필요)
  spawnCmd('git', ['config', 'user.email', 'smoke@built.local'], { cwd: tmpDir });
  spawnCmd('git', ['config', 'user.name', 'built smoke'], { cwd: tmpDir });

  // -------------------------------------------------------------------------
  // feature spec 작성 및 초기 커밋
  // -------------------------------------------------------------------------
  // 워크트리는 base_ref(HEAD)에서 생성되므로, feature spec을 커밋에 포함해야 한다.

  fs.mkdirSync(path.join(tmpDir, '.built', 'features'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, '.built', 'features', `${feature}.md`),
    [
      '# compare smoke',
      '',
      '## 목표',
      'src/greet.js 파일에 greet(name) 함수를 구현한다.',
      '',
      '## 구현 내용',
      '- greet(name) 함수: "Hello, <name>!" 문자열을 반환한다.',
      '- module.exports로 내보낸다.',
      '',
      '## 완료 기준',
      '- src/greet.js 파일이 존재한다.',
      '- greet("World")가 "Hello, World!"를 반환한다.',
    ].join('\n') + '\n',
    'utf8'
  );

  // package.json (verification command용 — node -e로 단순 확인)
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ name: 'compare-smoke', version: '0.0.1' }, null, 2) + '\n',
    'utf8'
  );

  // 초기 커밋 (워크트리 기준 base)
  spawnCmd('git', ['add', '-A'], { cwd: tmpDir });
  const commitResult = spawnCmd('git', ['commit', '-m', 'initial: compare smoke setup'], { cwd: tmpDir });
  if (!commitResult.ok) {
    console.error(`${TAG} 원인축: comparison_setup — git commit 실패: ${commitResult.stderr.trim()}`);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // comparison run-request.json 작성
  // -------------------------------------------------------------------------

  const comparisonId = generateComparisonId();
  const runRequestPath = path.join(tmpDir, '.built', 'runtime', 'runs', feature, 'run-request.json');

  writeJson(runRequestPath, {
    featureId:  feature,
    planPath:   `.built/features/${feature}.md`,
    createdAt:  new Date().toISOString(),
    providers: {
      do: 'claude',  // 기본 provider (비교 모드에서는 comparison 필드가 우선)
    },
    comparison: {
      enabled:  true,
      id:       comparisonId,
      phase:    'do',
      base_ref: 'HEAD',
      candidates: [
        {
          id:       'claude',
          provider: {
            name:       'claude',
            timeout_ms: 900000,
          },
        },
        {
          id:       'codex',
          provider: {
            name:       'codex',
            sandbox:    'workspace-write',
            timeout_ms: 900000,
          },
        },
      ],
      verification: {
        // node -e로 greet.js가 존재하고 기대 결과를 반환하는지 확인
        commands: [
          'node -e "const g = require(\'./src/greet.js\'); if (g.greet(\'World\') !== \'Hello, World!\') throw new Error(\'output mismatch\');"',
        ],
        smoke: true,
      },
      report: {
        format: 'markdown',
      },
    },
  });

  console.log(`${TAG} comparison id: ${comparisonId}`);
  console.log(`${TAG} run-request.json 작성 완료: ${runRequestPath}`);

  // -------------------------------------------------------------------------
  // compare-providers.js 실행
  // -------------------------------------------------------------------------

  const compareScript = path.join(__dirname, 'compare-providers.js');
  console.log(`${TAG} compare-providers.js 실행 시작...`);

  const compareResult = childProcess.spawnSync(
    process.execPath,
    [compareScript, feature, '--phase', 'do', '--comparison', comparisonId],
    {
      cwd:     tmpDir,
      env:     process.env,
      stdio:   'inherit',
      timeout: 1000 * 60 * 40,  // 40분 제한
    }
  );

  const exitCode = compareResult.status === null ? 1 : compareResult.status;

  if (exitCode !== 0) {
    if (compareResult.signal === 'SIGTERM' || compareResult.status === null) {
      console.error(`${TAG} 원인축: timeout — 실행 시간이 40분 제한을 초과했습니다.`);
    } else if (compareResult.error) {
      console.error(`${TAG} 원인축: comparison_setup — ${compareResult.error.message}`);
    } else {
      console.error(`${TAG} 원인축: candidate_failed — compare-providers.js 실패 (exit ${exitCode}). 위 출력을 확인하세요.`);
    }
    process.exit(exitCode);
  }

  // -------------------------------------------------------------------------
  // 산출물 검증
  // -------------------------------------------------------------------------

  const compRootDir = path.join(tmpDir, '.built', 'runtime', 'runs', feature, 'comparisons', comparisonId);

  function assertExists(filePath, label) {
    if (!fs.existsSync(filePath)) {
      console.error(`${TAG} 원인축: artifact_missing — ${label} 미생성: ${filePath}`);
      process.exit(1);
    }
  }

  // report.md 검증
  const reportPath = path.join(compRootDir, 'report.md');
  assertExists(reportPath, 'report.md');

  const reportContent = fs.readFileSync(reportPath, 'utf8');
  if (!reportContent.includes('자동 winner는 선택하지 않았습니다')) {
    console.error(`${TAG} 원인축: artifact_missing — report.md에 "자동 winner는 선택하지 않았습니다" 문구 없음`);
    process.exit(1);
  }
  console.log(`${TAG} report.md 검증 완료: ${reportPath}`);

  // manifest.json 검증
  const manifestPath = path.join(compRootDir, 'manifest.json');
  assertExists(manifestPath, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.finished_at) {
    console.error(`${TAG} 원인축: artifact_missing — manifest.json에 finished_at 없음`);
    process.exit(1);
  }
  console.log(`${TAG} manifest.json 검증 완료 (status: ${manifest.status})`);

  // candidate별 artifact 검증
  for (const candidateId of ['claude', 'codex']) {
    const candidateDir = path.join(compRootDir, 'providers', candidateId);

    assertExists(path.join(candidateDir, 'state.json'),        `providers/${candidateId}/state.json`);
    assertExists(path.join(candidateDir, 'verification.json'), `providers/${candidateId}/verification.json`);
    assertExists(path.join(candidateDir, 'diff.patch'),        `providers/${candidateId}/diff.patch`);
    assertExists(path.join(candidateDir, 'git-status.txt'),    `providers/${candidateId}/git-status.txt`);
    assertExists(path.join(candidateDir, 'run-request.json'),  `providers/${candidateId}/run-request.json`);

    const state = JSON.parse(fs.readFileSync(path.join(candidateDir, 'state.json'), 'utf8'));
    console.log(`${TAG} candidate ${candidateId}: phase_status=${state.status}`);

    // candidate별 run-request.json이 비교 output에만 있고 canonical 경로에 없는지 확인
    const canonicalRunRequest = path.join(tmpDir, '.built', 'features', candidateId, 'run-request.json');
    if (fs.existsSync(canonicalRunRequest)) {
      console.error(`${TAG} 원인축: artifact_missing — canonical 경로에 candidate run-request.json이 생성됨 (격리 위반): ${canonicalRunRequest}`);
      process.exit(1);
    }
  }

  // canonical do-result.md가 덮어쓰이지 않았는지 확인
  // (기본 feature canonical 경로는 tmpDir/.built/features/<feature>/do-result.md)
  const canonicalDoResult = path.join(tmpDir, '.built', 'features', feature, 'do-result.md');
  if (fs.existsSync(canonicalDoResult)) {
    console.error(`${TAG} 원인축: artifact_missing — canonical do-result.md가 비교 모드에 의해 생성됨 (격리 위반): ${canonicalDoResult}`);
    process.exit(1);
  }
  console.log(`${TAG} canonical do-result.md 격리 확인: 파일 없음 (정상)`);

  // -------------------------------------------------------------------------
  // 결과 요약
  // -------------------------------------------------------------------------

  console.log(`${TAG} ok`);
  console.log(`${TAG} comparison id   : ${comparisonId}`);
  console.log(`${TAG} report           : ${reportPath}`);
  console.log(`${TAG} claude artifacts : ${path.join(compRootDir, 'providers', 'claude')}`);
  console.log(`${TAG} codex artifacts  : ${path.join(compRootDir, 'providers', 'codex')}`);

  if (process.env.BUILT_KEEP_SMOKE_DIR === '1') {
    console.log(`${TAG} 임시 디렉토리 유지 중 (BUILT_KEEP_SMOKE_DIR=1): ${tmpDir}`);
  }

  process.exit(0);

} catch (err) {
  console.error(`${TAG} 예외 발생: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
} finally {
  cleanup();
}
