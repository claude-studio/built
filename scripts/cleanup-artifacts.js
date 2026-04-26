#!/usr/bin/env node
/**
 * cleanup-artifacts.js
 *
 * comparison worktree/branch와 smoke 임시 디렉토리를 점검하고 정리한다.
 * comparison evidence dir(.built/runtime/runs/<feature>/comparisons/<id>/)는 보존한다.
 *
 * 사용법:
 *   node scripts/cleanup-artifacts.js [--feature <feature>] [--dry-run] [--smoke] [--json]
 *
 * 옵션:
 *   --feature <feature>  특정 feature만 처리
 *   --dry-run            후보만 출력, 실제 삭제 없음
 *   --smoke              /tmp의 smoke 임시 디렉토리도 포함
 *   --json               결과를 JSON으로 출력
 *
 * Exit codes:
 *   0 — 정상 완료 (blocked 항목이 있어도 0)
 *   1 — 오류 (git 명령 실패, 잘못된 인자 등)
 *
 * API (모듈로도 사용 가능):
 *   scanComparisonArtifacts(projectRoot, opts)    -> ComparisonScanResult
 *   cleanComparisonCandidate(projectRoot, cand, opts) -> CandidateCleanResult
 *   scanSmokeArtifacts(tmpDir)                    -> SmokeArtifact[]
 *   cleanSmokeArtifact(artifact, opts)            -> SmokeCleanResult
 *
 * @typedef {{ feature: string, comparisonId: string, candidateId: string,
 *             worktreePath: string, branch: string, evidenceDir: string }} ComparisonCandidate
 * @typedef {{ candidates: ComparisonCandidate[], blocked: BlockedCandidate[], warnings: string[] }} ComparisonScanResult
 * @typedef {{ candidate: ComparisonCandidate, blocked: boolean, reason?: string, actions: string[] }} CandidateCleanResult
 * @typedef {{ path: string, ageDays: number, keep: boolean }} SmokeArtifact
 * @typedef {{ artifact: SmokeArtifact, blocked: boolean, reason?: string, actions: string[] }} SmokeCleanResult
 * @typedef {{ branch: string, worktreePath: string, reason: string }} BlockedCandidate
 */

'use strict';

const fs           = require('fs');
const path         = require('path');
const os           = require('os');
const childProcess = require('child_process');

// ---------------------------------------------------------------------------
// 내부 유틸
// ---------------------------------------------------------------------------

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * 명령 실행 후 stdout 반환. 실패 시 null.
 */
function execSafe(cmd, cwd) {
  try {
    return childProcess.execSync(cmd, {
      cwd: cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString().trim();
  } catch (_) {
    return null;
  }
}

/**
 * branch가 origin/main에 완전히 merge되었는지 확인.
 * @param {string} branch
 * @param {string} cwd
 * @returns {boolean}
 */
function isBranchMergedIntoMain(branch, cwd) {
  // git merge-base --is-ancestor: exit 0이면 ancestor (merged)
  try {
    childProcess.execSync(
      `git merge-base --is-ancestor "origin/${branch}" "origin/main"`,
      { cwd, stdio: 'pipe' }
    );
    return true;
  } catch (_) {}

  // fallback: refs/remotes 직접 참조
  try {
    childProcess.execSync(
      `git merge-base --is-ancestor "refs/remotes/origin/${branch}" "refs/remotes/origin/main"`,
      { cwd, stdio: 'pipe' }
    );
    return true;
  } catch (_) {}

  return false;
}

/**
 * branch에 연결된 open PR이 있는지 확인 (gh CLI 필요).
 * @param {string} branch
 * @returns {'open'|'merged'|'closed'|'none'|'unknown'}
 */
function getPrState(branch) {
  const result = execSafe(
    `gh pr list --head "${branch}" --state all --json state --jq '.[0].state // "none"'`,
    process.cwd()
  );
  if (result === null) return 'unknown';
  const state = result.toLowerCase().replace(/"/g, '');
  if (state === 'open') return 'open';
  if (state === 'merged') return 'merged';
  if (state === 'closed') return 'closed';
  return 'none';
}

/**
 * worktree에 uncommitted 변경이 있는지 확인.
 * @param {string} worktreePath
 * @returns {boolean} 변경이 있으면 true
 */
function hasUncommittedChanges(worktreePath) {
  if (!fs.existsSync(worktreePath)) return false;
  const result = execSafe('git status --porcelain', worktreePath);
  return result !== null && result.length > 0;
}

/**
 * git worktree remove 실행.
 * @param {string} projectRoot
 * @param {string} worktreePath
 * @returns {{ success: boolean, message: string }}
 */
function removeWorktree(projectRoot, worktreePath) {
  if (!fs.existsSync(worktreePath)) {
    return { success: true, message: `worktree not found (already removed): ${worktreePath}` };
  }
  try {
    childProcess.execSync(
      `git worktree remove "${worktreePath}" --force`,
      { cwd: projectRoot, stdio: 'pipe' }
    );
    return { success: true, message: `worktree removed: ${worktreePath}` };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    // worktree가 git에 등록되지 않은 경우 직접 삭제
    try {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    } catch (_) {}
    return {
      success: true,
      message: `worktree force-deleted (git error: ${stderr.trim()}): ${worktreePath}`,
    };
  }
}

/**
 * 원격 branch 삭제.
 * @param {string} branch
 * @param {string} cwd
 * @returns {{ success: boolean, message: string }}
 */
function deleteRemoteBranch(branch, cwd) {
  const result = execSafe(`git push origin --delete "${branch}"`, cwd);
  if (result !== null) {
    return { success: true, message: `remote branch deleted: ${branch}` };
  }
  return { success: false, message: `remote branch delete failed (may not exist): ${branch}` };
}

/**
 * 로컬 branch 삭제 (있으면).
 * @param {string} branch
 * @param {string} cwd
 * @returns {string} action message
 */
function deleteLocalBranch(branch, cwd) {
  const result = execSafe(`git branch -d "${branch}"`, cwd);
  if (result !== null) {
    return `local branch deleted: ${branch}`;
  }
  return `local branch not found (skipped): ${branch}`;
}

// ---------------------------------------------------------------------------
// comparison artifact 스캔
// ---------------------------------------------------------------------------

/**
 * .built/runtime/runs/ 하위 comparison 디렉토리를 스캔한다.
 *
 * @param {string} projectRoot
 * @param {{ feature?: string, _ghAvailable?: boolean, _mergeCheck?: Function, _prCheck?: Function }} opts
 * @returns {ComparisonScanResult}
 */
function scanComparisonArtifacts(projectRoot, opts = {}) {
  const featureFilter = opts.feature || null;
  const runsDir = path.join(projectRoot, '.built', 'runtime', 'runs');

  const candidates = [];
  const blocked    = [];
  const warnings   = [];

  if (!fs.existsSync(runsDir)) {
    return { candidates, blocked, warnings };
  }

  // gh CLI 가용 여부 (테스트 override 가능)
  const ghAvailable = opts._ghAvailable !== undefined
    ? opts._ghAvailable
    : execSafe('gh --version', projectRoot) !== null;

  if (!ghAvailable) {
    warnings.push('gh CLI를 찾을 수 없습니다. PR 상태 확인이 제한됩니다. open PR 여부를 수동으로 확인하세요.');
  }

  // merge 체크 함수 (테스트 override 가능)
  const mergeCheck = opts._mergeCheck || isBranchMergedIntoMain;
  // PR 상태 체크 함수 (테스트 override 가능)
  const prCheck = opts._prCheck || getPrState;

  const features = featureFilter
    ? [featureFilter]
    : fs.readdirSync(runsDir).filter((f) => {
        return fs.statSync(path.join(runsDir, f)).isDirectory();
      });

  for (const feature of features) {
    const comparisonsDir = path.join(runsDir, feature, 'comparisons');
    if (!fs.existsSync(comparisonsDir)) continue;

    const compIds = fs.readdirSync(comparisonsDir).filter((c) => {
      return fs.statSync(path.join(comparisonsDir, c)).isDirectory();
    });

    for (const compId of compIds) {
      const compDir      = path.join(comparisonsDir, compId);
      const manifestPath = path.join(compDir, 'manifest.json');
      const manifest     = readJsonSafe(manifestPath);

      if (!manifest) {
        warnings.push(`manifest.json 없음: ${compDir} (스킵)`);
        continue;
      }

      const candidatesFromManifest = manifest.candidates || [];

      for (const cEntry of candidatesFromManifest) {
        const candidateId = cEntry.id || cEntry.candidate_id;
        if (!candidateId) continue;

        const worktreePath = cEntry.worktree_path || path.join(
          projectRoot, '.claude', 'worktrees',
          `${feature}-compare-${compId}-${candidateId}`
        );
        const branch = cEntry.branch || `compare/${feature}/${compId}/${candidateId}`;
        const evidenceDir = path.join(compDir, 'providers', candidateId);

        // 안전 조건 체크
        // 1. uncommitted 변경
        if (hasUncommittedChanges(worktreePath)) {
          blocked.push({
            feature, comparisonId: compId, candidateId,
            worktreePath, branch, evidenceDir,
            reason: 'worktree에 uncommitted 변경이 있습니다. 변경을 보존하거나 커밋 후 재시도하세요.',
          });
          continue;
        }

        // 2. PR 상태
        const prState = ghAvailable ? prCheck(branch) : 'unknown';
        if (prState === 'open') {
          blocked.push({
            feature, comparisonId: compId, candidateId,
            worktreePath, branch, evidenceDir,
            reason: `open PR이 있습니다 (branch: ${branch}). PR을 닫거나 merge 후 재시도하세요.`,
          });
          continue;
        }
        if (prState === 'unknown') {
          warnings.push(`branch '${branch}': PR 상태를 확인할 수 없습니다. 수동 확인이 필요합니다.`);
        }

        // 3. merge 여부 (PR이 closed/merged면 merge 체크 생략 가능)
        const isMerged = mergeCheck(branch, projectRoot);
        if (!isMerged && prState !== 'merged' && prState !== 'closed') {
          blocked.push({
            feature, comparisonId: compId, candidateId,
            worktreePath, branch, evidenceDir,
            reason: `branch '${branch}'에 main에 없는 커밋이 있습니다. merge 또는 확인 후 재시도하세요.`,
          });
          continue;
        }

        candidates.push({
          feature, comparisonId: compId, candidateId,
          worktreePath, branch, evidenceDir,
        });
      }
    }
  }

  return { candidates, blocked, warnings };
}

// ---------------------------------------------------------------------------
// comparison candidate cleanup
// ---------------------------------------------------------------------------

/**
 * 단일 candidate worktree/branch를 정리한다. evidence dir는 유지한다.
 *
 * @param {string} projectRoot
 * @param {ComparisonCandidate} candidate
 * @param {{ dryRun?: boolean }} opts
 * @returns {CandidateCleanResult}
 */
function cleanComparisonCandidate(projectRoot, candidate, opts = {}) {
  const dryRun  = !!opts.dryRun;
  const actions = [];

  if (dryRun) {
    if (fs.existsSync(candidate.worktreePath)) {
      actions.push(`[dry-run] would remove worktree: ${candidate.worktreePath}`);
    }
    actions.push(`[dry-run] would delete remote branch: ${candidate.branch}`);
    actions.push(`[dry-run] would delete local branch: ${candidate.branch}`);
    actions.push(`[dry-run] evidence dir preserved: ${candidate.evidenceDir}`);
    return { candidate, blocked: false, actions };
  }

  // 1. worktree 제거
  const wtResult = removeWorktree(projectRoot, candidate.worktreePath);
  actions.push(wtResult.message);

  // 2. 원격 branch 삭제
  const remoteResult = deleteRemoteBranch(candidate.branch, projectRoot);
  actions.push(remoteResult.message);

  // 3. 로컬 branch 삭제
  actions.push(deleteLocalBranch(candidate.branch, projectRoot));

  // 4. evidence dir 보존 확인
  actions.push(`evidence dir preserved: ${candidate.evidenceDir}`);

  return { candidate, blocked: false, actions };
}

// ---------------------------------------------------------------------------
// smoke artifact 스캔
// ---------------------------------------------------------------------------

const SMOKE_DIR_PATTERN = /^built-codex-.+-smoke-/;
const SMOKE_MAX_AGE_HOURS = 24;

/**
 * /tmp 하위 smoke 임시 디렉토리를 스캔한다.
 *
 * @param {string} [tmpDir] 기본값: os.tmpdir()
 * @returns {SmokeArtifact[]}
 */
function scanSmokeArtifacts(tmpDir) {
  const base = tmpDir || os.tmpdir();
  const artifacts = [];

  let entries;
  try {
    entries = fs.readdirSync(base);
  } catch (_) {
    return artifacts;
  }

  const now = Date.now();

  for (const entry of entries) {
    if (!SMOKE_DIR_PATTERN.test(entry)) continue;

    const fullPath = path.join(base, entry);
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch (_) {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const ageDays  = (now - stat.mtimeMs) / (1000 * 60 * 60 * 24);
    const ageHours = ageDays * 24;
    const keep     = ageHours < SMOKE_MAX_AGE_HOURS;

    artifacts.push({ path: fullPath, ageDays, keep });
  }

  return artifacts;
}

/**
 * 단일 smoke artifact 정리.
 *
 * @param {SmokeArtifact} artifact
 * @param {{ dryRun?: boolean }} opts
 * @returns {SmokeCleanResult}
 */
function cleanSmokeArtifact(artifact, opts = {}) {
  const dryRun  = !!opts.dryRun;
  const actions = [];

  if (artifact.keep) {
    return {
      artifact,
      blocked: true,
      reason: `24시간 이내 생성 (${(artifact.ageDays * 24).toFixed(1)}시간 경과). 보존합니다.`,
      actions: [],
    };
  }

  if (dryRun) {
    actions.push(`[dry-run] would remove smoke dir: ${artifact.path} (${artifact.ageDays.toFixed(1)}일 경과)`);
    return { artifact, blocked: false, actions };
  }

  try {
    fs.rmSync(artifact.path, { recursive: true, force: true });
    actions.push(`smoke dir removed: ${artifact.path} (${artifact.ageDays.toFixed(1)}일 경과)`);
  } catch (err) {
    actions.push(`smoke dir remove failed: ${artifact.path} — ${err.message}`);
  }

  return { artifact, blocked: false, actions };
}

// ---------------------------------------------------------------------------
// 메인 cleanup 함수
// ---------------------------------------------------------------------------

/**
 * comparison artifact와 (옵션) smoke artifact를 점검/정리한다.
 *
 * @param {string} projectRoot
 * @param {{
 *   feature?: string,
 *   dryRun?: boolean,
 *   smoke?: boolean,
 *   _ghAvailable?: boolean,
 *   _mergeCheck?: Function,
 *   _prCheck?: Function,
 *   _tmpDir?: string,
 * }} opts
 * @returns {{
 *   comparison: { cleaned: CandidateCleanResult[], blocked: BlockedCandidate[], warnings: string[] },
 *   smoke: { cleaned: SmokeCleanResult[], blocked: SmokeCleanResult[] },
 * }}
 */
function cleanupArtifacts(projectRoot, opts = {}) {
  const dryRun = !!opts.dryRun;

  // 1. comparison artifact 스캔
  const scanResult = scanComparisonArtifacts(projectRoot, opts);

  const compCleaned = [];
  for (const cand of scanResult.candidates) {
    const result = cleanComparisonCandidate(projectRoot, cand, { dryRun });
    compCleaned.push(result);
  }

  // 2. smoke artifact (옵션)
  const smokeCleaned  = [];
  const smokeBlocked  = [];

  if (opts.smoke) {
    const smokeArtifacts = scanSmokeArtifacts(opts._tmpDir);
    for (const art of smokeArtifacts) {
      const result = cleanSmokeArtifact(art, { dryRun });
      if (result.blocked) {
        smokeBlocked.push(result);
      } else {
        smokeCleaned.push(result);
      }
    }
  }

  return {
    comparison: {
      cleaned:  compCleaned,
      blocked:  scanResult.blocked,
      warnings: scanResult.warnings,
    },
    smoke: {
      cleaned: smokeCleaned,
      blocked: smokeBlocked,
    },
  };
}

// ---------------------------------------------------------------------------
// CLI 출력 헬퍼
// ---------------------------------------------------------------------------

function printText(result, dryRun) {
  const { comparison, smoke } = result;
  const mode = dryRun ? '[dry-run] ' : '';

  if (comparison.warnings.length > 0) {
    console.log('[경고]');
    for (const w of comparison.warnings) console.log(`  - ${w}`);
    console.log('');
  }

  // comparison
  if (comparison.cleaned.length === 0 && comparison.blocked.length === 0) {
    console.log('comparison artifact: 정리 대상 없음.');
  } else {
    if (comparison.cleaned.length > 0) {
      console.log(`${mode}[comparison — 정리 완료] (${comparison.cleaned.length}개 candidate)`);
      for (const r of comparison.cleaned) {
        const c = r.candidate;
        console.log(`  - ${c.feature} / ${c.comparisonId} / ${c.candidateId}`);
        for (const a of r.actions) console.log(`      ${a}`);
      }
      console.log('');
    }
    if (comparison.blocked.length > 0) {
      console.log(`[comparison — blocked (수동 확인 필요)] (${comparison.blocked.length}개)`);
      for (const b of comparison.blocked) {
        console.log(`  - ${b.feature} / ${b.comparisonId} / ${b.candidateId}`);
        console.log(`      branch:      ${b.branch}`);
        console.log(`      worktree:    ${b.worktreePath}`);
        console.log(`      사유:        ${b.reason}`);
      }
      console.log('');
    }
  }

  // smoke
  if (smoke.cleaned.length > 0 || smoke.blocked.length > 0) {
    if (smoke.cleaned.length > 0) {
      console.log(`${mode}[smoke — 정리 완료] (${smoke.cleaned.length}개)`);
      for (const r of smoke.cleaned) {
        for (const a of r.actions) console.log(`  ${a}`);
      }
      console.log('');
    }
    if (smoke.blocked.length > 0) {
      console.log(`[smoke — blocked (보존)] (${smoke.blocked.length}개)`);
      for (const r of smoke.blocked) {
        console.log(`  - ${r.artifact.path}: ${r.reason}`);
      }
      console.log('');
    }
  }

  const totalCleaned = comparison.cleaned.length + smoke.cleaned.length;
  const totalBlocked = comparison.blocked.length + smoke.blocked.length;
  console.log(`완료: ${totalCleaned} 정리, ${totalBlocked} blocked`);
}

// ---------------------------------------------------------------------------
// CLI 진입점
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args      = process.argv.slice(2);
  const dryRun    = args.includes('--dry-run');
  const withSmoke = args.includes('--smoke');
  const jsonOut   = args.includes('--json');

  const featIdx = args.indexOf('--feature');
  const feature = featIdx >= 0 ? args[featIdx + 1] : undefined;

  if (featIdx >= 0 && !feature) {
    console.error('오류: --feature 뒤에 feature 이름이 필요합니다.');
    process.exit(1);
  }

  const projectRoot = process.cwd();

  try {
    const result = cleanupArtifacts(projectRoot, { feature, dryRun, smoke: withSmoke });

    if (jsonOut) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printText(result, dryRun);
    }

    process.exit(0);
  } catch (err) {
    console.error('error: ' + err.message);
    process.exit(1);
  }
}

module.exports = {
  scanComparisonArtifacts,
  cleanComparisonCandidate,
  scanSmokeArtifacts,
  cleanSmokeArtifact,
  cleanupArtifacts,
};
