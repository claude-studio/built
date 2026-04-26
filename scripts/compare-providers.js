#!/usr/bin/env node
/**
 * compare-providers.js
 *
 * provider 비교 모드 MVP
 *
 * 사용법:
 *   node scripts/compare-providers.js <feature> [--phase do] [--comparison <id>]
 *
 * 동작:
 *   1. .built/runtime/runs/<feature>/run-request.json의 comparison 필드를 읽는다.
 *   2. comparison.enabled: true와 phase: do를 검증한다.
 *   3. candidate별 worktree/branch/output 디렉토리를 격리해 생성한다.
 *   4. candidate별로 순차 실행한다 (do phase).
 *   5. 각 candidate의 diff.patch, git-status.txt, verification.json을 저장한다.
 *   6. .built/runtime/runs/<feature>/comparisons/<id>/report.md를 생성한다.
 *
 * 주의:
 *   - 기본 /built:run 또는 node scripts/run.js는 이 스크립트를 호출하지 않는다.
 *   - 이 스크립트만 comparison 필드를 읽는다.
 *   - canonical .built/features/<feature>/ 결과 파일을 덮어쓰지 않는다.
 *   - 자동 winner 선택, 자동 merge, canonical branch 적용을 수행하지 않는다.
 *
 * 환경변수:
 *   BUILT_COMPARE_FAKE_PROVIDER=1  fake provider로 실행 (offline 테스트용)
 *                                  git 연산과 실제 phase 실행을 건너뛴다.
 *
 * Exit codes:
 *   0 — 성공
 *   1 — 오류
 *
 * 외부 npm 패키지 없음.
 */

'use strict';

const fs           = require('fs');
const path         = require('path');
const childProcess = require('child_process');

const { parseComparisonConfig } =
  require(path.join(__dirname, '..', 'src', 'providers', 'comparison-config'));
const { sanitizeJson, sanitizeText } = require('./sanitize');

// ---------------------------------------------------------------------------
// 환경 / 인자 파싱
// ---------------------------------------------------------------------------

const FAKE_PROVIDER = process.env.BUILT_COMPARE_FAKE_PROVIDER === '1';

const args    = process.argv.slice(2);
const feature = args.find((a) => !a.startsWith('-'));

function getArgValue(flag) {
  const i = args.indexOf(flag);
  return (i !== -1 && i + 1 < args.length) ? args[i + 1] : null;
}

const phaseArg  = getArgValue('--phase') || 'do';
const compIdArg = getArgValue('--comparison');

if (!feature) {
  console.error('Usage: node scripts/compare-providers.js <feature> [--phase do] [--comparison <id>]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 경로 설정
// ---------------------------------------------------------------------------

const projectRoot    = process.cwd();
const runDir         = path.join(projectRoot, '.built', 'runtime', 'runs', feature);
const runRequestPath = path.join(runDir, 'run-request.json');

// ---------------------------------------------------------------------------
// run-request.json 읽기
// ---------------------------------------------------------------------------

let runRequest;
try {
  runRequest = JSON.parse(fs.readFileSync(runRequestPath, 'utf8'));
} catch (e) {
  console.error(`[compare] run-request.json 읽기 실패: ${runRequestPath}`);
  console.error(`[compare] ${e.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// comparison 설정 파싱
// ---------------------------------------------------------------------------

let comp;
try {
  comp = parseComparisonConfig(runRequest);
} catch (e) {
  console.error(`[compare] comparison 설정 오류: ${e.message}`);
  process.exit(1);
}

if (!comp) {
  console.error('[compare] comparison.enabled: true가 아닙니다. 비교 모드를 실행하지 않습니다.');
  process.exit(1);
}

// CLI --phase와 comparison.phase 일치 검증
if (phaseArg !== comp.phase) {
  console.error(
    `[compare] --phase "${phaseArg}"가 comparison.phase "${comp.phase}"와 다릅니다.`
  );
  process.exit(1);
}

// CLI --comparison이 있으면 comparison id 오버라이드
if (compIdArg) {
  comp.id = compIdArg;
}

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------

/**
 * KST 기준 날짜 문자열을 반환한다.
 */
function toKSTString(date) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y   = kst.getUTCFullYear();
  const m   = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d   = String(kst.getUTCDate()).padStart(2, '0');
  const h   = String(kst.getUTCHours()).padStart(2, '0');
  const min = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min} KST`;
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(sanitizeJson(data), null, 2) + '\n', 'utf8');
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, sanitizeText(text), 'utf8');
}

/**
 * 명령을 동기 실행해 결과를 반환한다.
 */
function spawnCmd(cmd, cmdArgs, options) {
  const result = childProcess.spawnSync(cmd, cmdArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  return {
    ok:     result.status === 0,
    stdout: (result.stdout || Buffer.alloc(0)).toString(),
    stderr: (result.stderr || Buffer.alloc(0)).toString(),
    status: result.status,
  };
}

// ---------------------------------------------------------------------------
// 경로: comparison 루트
// ---------------------------------------------------------------------------

const compRootDir  = path.join(runDir, 'comparisons', comp.id);
const worktreeBase = path.join(projectRoot, '.claude', 'worktrees');

// ---------------------------------------------------------------------------
// base_ref 해결
// ---------------------------------------------------------------------------

/**
 * base_ref를 short commit SHA로 해결한다.
 * fake 모드에서는 'fake000'을 반환한다.
 *
 * @returns {string}
 */
function resolveBaseCommit() {
  if (FAKE_PROVIDER) return 'fake000';

  const result = spawnCmd('git', ['-C', projectRoot, 'rev-parse', comp.base_ref]);
  if (!result.ok) {
    throw new Error(`base_ref "${comp.base_ref}" 해결 실패: ${result.stderr.trim()}`);
  }
  return result.stdout.trim().slice(0, 8);
}

// ---------------------------------------------------------------------------
// input snapshot 준비
// ---------------------------------------------------------------------------

/**
 * manifest 생성 전 공통 input snapshot 파일을 쓴다.
 * canonical .built/features/<feature>/ 는 건드리지 않는다.
 */
function prepareInputSnapshot(baseCommit) {
  const specPath    = path.join(projectRoot, '.built', 'features', `${feature}.md`);
  const specContent = fs.existsSync(specPath) ? fs.readFileSync(specPath, 'utf8') : '';

  writeJson(path.join(compRootDir, 'input-snapshot.json'), {
    feature_id:  feature,
    base_commit: baseCommit,
    base_ref:    comp.base_ref,
    plan_path:   runRequest.planPath || `.built/features/${feature}.md`,
    created_at:  new Date().toISOString(),
  });

  writeText(
    path.join(compRootDir, 'acceptance-criteria.md'),
    specContent
      ? `# Acceptance Criteria\n\n(${feature}.md 에서 복사)\n\n${specContent}`
      : `# Acceptance Criteria\n\n(spec 없음)\n`
  );

  writeJson(path.join(compRootDir, 'verification-plan.json'), {
    commands: comp.verification.commands,
    smoke:    comp.verification.smoke,
  });
}

// ---------------------------------------------------------------------------
// candidate worktree 생성
// ---------------------------------------------------------------------------

/**
 * candidate용 branch와 worktree를 생성한다.
 * fake 모드에서는 실제 git 연산 없이 디렉토리만 생성한다.
 *
 * @param {object} candidate
 * @param {string} baseCommit  (현재는 미사용; 실제 git 연산에서 ref로 사용)
 * @returns {{ worktreePath: string, branch: string }}
 */
function createCandidateWorktree(candidate) {
  const worktreePath = path.join(
    worktreeBase,
    `${feature}-compare-${comp.id}-${candidate.id}`
  );
  const branch = `compare/${feature}/${comp.id}/${candidate.id}`;

  if (FAKE_PROVIDER) {
    fs.mkdirSync(worktreePath, { recursive: true });
    return { worktreePath, branch };
  }

  // git branch 생성
  fs.mkdirSync(worktreeBase, { recursive: true });
  const branchResult = spawnCmd('git', [
    '-C', projectRoot,
    'checkout', '-b', branch, comp.base_ref,
  ]);
  if (!branchResult.ok) {
    throw new Error(`branch 생성 실패 (${branch}): ${branchResult.stderr.trim()}`);
  }

  // git worktree 추가
  const worktreeResult = spawnCmd('git', [
    '-C', projectRoot,
    'worktree', 'add', worktreePath, branch,
  ]);
  if (!worktreeResult.ok) {
    throw new Error(`worktree 생성 실패 (${worktreePath}): ${worktreeResult.stderr.trim()}`);
  }

  return { worktreePath, branch };
}

// ---------------------------------------------------------------------------
// candidate 실행
// ---------------------------------------------------------------------------

/**
 * 한 candidate의 phase를 실행하고 결과 파일을 compRootDir/providers/<id>/ 에 저장한다.
 * canonical .built/features/<feature>/ 는 건드리지 않는다.
 *
 * @param {object} candidate
 * @param {string} worktreePath
 * @param {string} branch
 * @returns {object}  결과 요약
 */
function runCandidate(candidate, worktreePath, branch) {
  const candidateOutDir = path.join(compRootDir, 'providers', candidate.id);

  fs.mkdirSync(path.join(candidateOutDir, 'result'), { recursive: true });
  fs.mkdirSync(path.join(candidateOutDir, 'logs'),   { recursive: true });

  const startedAt = new Date().toISOString();

  // candidate 전용 run-request.json
  // 이 파일은 comparison output dir에만 저장한다.
  const candidateRunRequest = {
    featureId: feature,
    planPath:  runRequest.planPath || `.built/features/${feature}.md`,
    createdAt: new Date().toISOString(),
    providers: { [comp.phase]: candidate.provider },
  };
  writeJson(path.join(candidateOutDir, 'run-request.json'), candidateRunRequest);

  // state.json 초기화
  const stateInit = {
    feature:    feature,
    phase:      comp.phase,
    status:     'running',
    pid:        null,
    heartbeat:  startedAt,
    startedAt,
    updatedAt:  startedAt,
    attempt:    1,
    last_error: null,
  };
  writeJson(path.join(candidateOutDir, 'state.json'), stateInit);

  let phaseStatus = 'completed';
  let phaseError  = null;
  let durationMs  = 0;

  if (FAKE_PROVIDER) {
    // fake: placeholder do-result.md를 comparison output에만 작성
    const fakeResult = [
      '---',
      `feature_id: ${feature}`,
      'status: completed',
      'model: fake',
      'cost_usd: 0',
      'duration_ms: 0',
      `created_at: "${startedAt}"`,
      '---',
      '',
      `# Do Result (fake — candidate: ${candidate.id})`,
      '',
      `provider: ${candidate.provider.name}`,
    ].join('\n');
    writeText(path.join(candidateOutDir, 'result', `${comp.phase}-result.md`), fakeResult);
    writeText(path.join(candidateOutDir, 'logs', `${comp.phase}.jsonl`), '');

  } else {
    // real: scripts/do.js를 worktree cwd로 실행
    // worktree에 run-request.json 배치
    const worktreeRunDir = path.join(
      worktreePath, '.built', 'runtime', 'runs', feature
    );
    fs.mkdirSync(worktreeRunDir, { recursive: true });
    fs.writeFileSync(
      path.join(worktreeRunDir, 'run-request.json'),
      JSON.stringify(candidateRunRequest, null, 2) + '\n',
      'utf8'
    );

    const scriptPath = path.join(__dirname, 'do.js');
    const t0         = Date.now();
    const doResult   = childProcess.spawnSync(
      process.execPath,
      [scriptPath, feature],
      { stdio: 'inherit', cwd: worktreePath, env: process.env }
    );
    durationMs = Date.now() - t0;

    if (doResult.status !== 0) {
      phaseStatus = 'failed';
      phaseError  = `do.js exited with code ${doResult.status}`;
    } else {
      // do-result.md를 comparison output으로 복사
      // canonical .built/features/<feature>/do-result.md는 건드리지 않는다.
      const srcResult = path.join(
        worktreePath, '.built', 'features', feature, 'do-result.md'
      );
      if (fs.existsSync(srcResult)) {
        writeText(
          path.join(candidateOutDir, 'result', `${comp.phase}-result.md`),
          fs.readFileSync(srcResult, 'utf8')
        );
      }

      // logs 복사
      const srcLog = path.join(
        worktreePath, '.built', 'features', feature, 'logs', `${comp.phase}.jsonl`
      );
      if (fs.existsSync(srcLog)) {
        writeText(
          path.join(candidateOutDir, 'logs', `${comp.phase}.jsonl`),
          fs.readFileSync(srcLog, 'utf8')
        );
      } else {
        writeText(path.join(candidateOutDir, 'logs', `${comp.phase}.jsonl`), '');
      }
    }
  }

  // verification commands 실행
  const verificationResults = [];
  for (const cmd of comp.verification.commands) {
    if (FAKE_PROVIDER) {
      verificationResults.push({ command: cmd, status: 'skipped', exit_code: null });
      continue;
    }
    const parts  = cmd.split(/\s+/);
    const vResult = childProcess.spawnSync(parts[0], parts.slice(1), {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd:   worktreePath,
      env:   process.env,
    });
    verificationResults.push({
      command:   cmd,
      status:    vResult.status === 0 ? 'pass' : 'fail',
      exit_code: vResult.status,
      stdout:    (vResult.stdout || Buffer.alloc(0)).toString().slice(0, 1000),
      stderr:    (vResult.stderr || Buffer.alloc(0)).toString().slice(0, 500),
    });
  }

  const allPass = verificationResults.length === 0 ||
    verificationResults.every((r) => r.status === 'pass' || r.status === 'skipped');
  const verificationOverall = verificationResults.length === 0
    ? 'no_commands'
    : (allPass ? 'pass' : 'fail');

  writeJson(path.join(candidateOutDir, 'verification.json'), {
    candidate_id: candidate.id,
    commands:     verificationResults,
    overall:      verificationOverall,
  });

  // diff.patch, git-status.txt
  if (FAKE_PROVIDER) {
    writeText(path.join(candidateOutDir, 'diff.patch'),     '');
    writeText(path.join(candidateOutDir, 'git-status.txt'), '');
  } else {
    const diffResult   = spawnCmd('git', ['-C', worktreePath, 'diff', '--binary', comp.base_ref]);
    const statusResult = spawnCmd('git', ['-C', worktreePath, 'status', '--short']);
    writeText(path.join(candidateOutDir, 'diff.patch'),     diffResult.stdout);
    writeText(path.join(candidateOutDir, 'git-status.txt'), statusResult.stdout);
  }

  // state.json 완료 처리
  const finishedAt = new Date().toISOString();
  writeJson(path.join(candidateOutDir, 'state.json'), {
    ...stateInit,
    status:      phaseStatus,
    last_error:  phaseError,
    updatedAt:   finishedAt,
    duration_ms: durationMs,
  });

  // progress.json (comparison output 전용; canonical progress.json은 건드리지 않는다)
  writeJson(path.join(candidateOutDir, 'progress.json'), {
    feature:       feature,
    phase:         comp.phase,
    session_id:    null,
    turn:          0,
    tool_calls:    0,
    last_text:     '',
    cost_usd:      0,
    input_tokens:  0,
    output_tokens: 0,
    started_at:    startedAt,
    updated_at:    finishedAt,
    status:        phaseStatus,
    last_error:    phaseError,
  });

  return {
    candidate_id:  candidate.id,
    provider:      candidate.provider,
    phase_status:  phaseStatus,
    duration_ms:   durationMs,
    verification:  { overall: verificationOverall },
    worktree_path: worktreePath,
    branch,
  };
}

// ---------------------------------------------------------------------------
// report.md 생성
// ---------------------------------------------------------------------------

/**
 * candidate 결과를 취합해 report.md를 생성한다.
 * 자동 winner는 선택하지 않는다.
 */
function generateReport(baseCommit, candidateResults) {
  const now   = toKSTString(new Date());
  const lines = [
    `# Provider 비교 리포트: ${feature} ${comp.phase}`,
    '',
    `생성 시각: ${now}`,
    `base: ${baseCommit}`,
    `comparison id: ${comp.id}`,
    '',
    '## 요약',
    '',
    '자동 winner는 선택하지 않았습니다. 아래 evidence를 기준으로 사람이 판단해야 합니다.',
    '',
    '## Candidate Matrix',
    '',
    '| candidate | provider | phase status | verification |',
    '|-----------|----------|--------------|--------------|',
  ];

  for (const r of candidateResults) {
    lines.push(
      `| ${r.candidate_id} | ${r.provider.name} | ${r.phase_status} | ${r.verification.overall} |`
    );
  }

  lines.push('');
  lines.push('## 아티팩트 경로');
  lines.push('');

  for (const r of candidateResults) {
    const cOutDir = path.join(compRootDir, 'providers', r.candidate_id);
    lines.push(`### ${r.candidate_id}`);
    lines.push('');
    lines.push(`- branch: \`${r.branch}\``);
    lines.push(`- worktree: \`${r.worktree_path}\``);
    lines.push(`- result: \`${path.join(cOutDir, 'result', `${comp.phase}-result.md`)}\``);
    lines.push(`- diff: \`${path.join(cOutDir, 'diff.patch')}\``);
    lines.push(`- verification: \`${path.join(cOutDir, 'verification.json')}\``);
    lines.push('');
  }

  lines.push('## 정리 절차');
  lines.push('');
  lines.push('1. report.md와 diff.patch에서 evidence를 확인합니다.');
  lines.push('2. candidate branch가 PR로 승격되지 않았으면 worktree를 제거합니다.');
  lines.push('3. 필요 시 compare/* branch를 삭제합니다.');
  lines.push(`4. \`.built/runtime/runs/${feature}/comparisons/${comp.id}/\` 는 audit evidence로 유지합니다.`);
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------

async function main() {
  console.log(
    `[compare] feature: ${feature}, phase: ${comp.phase}, id: ${comp.id}`
  );
  if (FAKE_PROVIDER) {
    console.log('[compare] fake provider 모드 (BUILT_COMPARE_FAKE_PROVIDER=1)');
  }

  // comparison 루트 디렉토리 생성
  fs.mkdirSync(compRootDir, { recursive: true });

  // base commit 해결
  let baseCommit;
  try {
    baseCommit = resolveBaseCommit();
  } catch (e) {
    console.error(`[compare] ${e.message}`);
    process.exit(1);
  }

  // input snapshot 파일 준비
  prepareInputSnapshot(baseCommit);

  // manifest.json 초기 작성
  const manifestPath = path.join(compRootDir, 'manifest.json');
  const manifestInit = {
    comparison_id: comp.id,
    feature,
    phase:         comp.phase,
    base_ref:      comp.base_ref,
    base_commit:   baseCommit,
    candidates:    comp.candidates.map((c) => ({
      id:            c.id,
      provider:      c.provider,
      branch:        null,
      worktree_path: null,
      phase_status:  null,
    })),
    started_at:  new Date().toISOString(),
    finished_at: null,
    status:      'running',
  };
  writeJson(manifestPath, manifestInit);

  // candidate별 순차 실행
  const candidateResults = [];

  for (const candidate of comp.candidates) {
    console.log(
      `[compare] candidate: ${candidate.id} (provider: ${candidate.provider.name})`
    );

    let worktreePath, branch;
    try {
      ({ worktreePath, branch } = createCandidateWorktree(candidate));
    } catch (e) {
      console.error(
        `[compare] worktree 생성 실패 (${candidate.id}): ${e.message}`
      );
      candidateResults.push({
        candidate_id:  candidate.id,
        provider:      candidate.provider,
        phase_status:  'failed',
        duration_ms:   0,
        verification:  { overall: 'skipped' },
        worktree_path: '',
        branch:        '',
      });
      continue;
    }

    const result = runCandidate(candidate, worktreePath, branch);
    candidateResults.push(result);

    console.log(
      `[compare]   phase_status: ${result.phase_status}, ` +
      `verification: ${result.verification.overall}`
    );
  }

  // report.md 생성
  const reportContent = generateReport(baseCommit, candidateResults);
  writeText(path.join(compRootDir, 'report.md'), reportContent);

  // manifest.json 완료 처리
  const allCompleted = candidateResults.every(
    (r) => r.phase_status === 'completed'
  );
  writeJson(manifestPath, {
    ...manifestInit,
    candidates: comp.candidates.map((c, i) => ({
      id:            c.id,
      provider:      c.provider,
      branch:        candidateResults[i] ? candidateResults[i].branch        : null,
      worktree_path: candidateResults[i] ? candidateResults[i].worktree_path : null,
      phase_status:  candidateResults[i] ? candidateResults[i].phase_status  : 'unknown',
    })),
    finished_at: new Date().toISOString(),
    status:      allCompleted ? 'completed' : 'partial_failure',
  });

  console.log(`[compare] 완료: ${path.join(compRootDir, 'report.md')}`);
  return 0;
}

main().then((code) => process.exit(code || 0)).catch((e) => {
  console.error(`[compare] 예상치 못한 오류: ${e.message}`);
  process.exit(1);
});
