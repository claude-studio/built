#!/usr/bin/env node
/**
 * check-stale-branches.js
 *
 * daemon worktree와 연결된 stale branch를 감지한다.
 * PR merge 이후 남은 원격 branch를 확인해 cleanup evidence를 생성한다.
 *
 * 감지 기준 (모두 충족 시 stale 후보):
 *   1. agent/ 또는 agent/builder/ prefix를 가진 원격 branch
 *   2. origin/main에 이미 merge된 상태
 *   3. open PR이 없음 (gh CLI 사용 가능 시 확인, 없으면 경고)
 *
 * 안전 규칙:
 *   - 자동 삭제하지 않는다. 감지 결과만 출력한다.
 *   - open PR이 있는 branch는 stale 후보에서 제외한다.
 *   - unmerged 커밋이 있는 branch는 별도 경고로 표시한다.
 *
 * 사용법:
 *   node scripts/check-stale-branches.js [--json] [--remote <remote>]
 *
 * 옵션:
 *   --json        결과를 JSON으로 출력 (기본: 텍스트)
 *   --remote      확인할 remote 이름 (기본: origin)
 *
 * Exit codes:
 *   0 — stale branch 없음 또는 감지 완료
 *   1 — 오류 (git 명령 실패 등)
 */

'use strict';

const childProcess = require('child_process');

// ---------------------------------------------------------------------------
// 내부 유틸
// ---------------------------------------------------------------------------

/**
 * 명령 실행 후 stdout 반환. 실패 시 null.
 * @param {string} cmd
 * @param {string} cwd
 * @returns {string|null}
 */
function execSafe(cmd, cwd) {
  try {
    return childProcess.execSync(cmd, { cwd, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  } catch (_) {
    return null;
  }
}

/**
 * gh CLI 사용 가능 여부 확인.
 * @returns {boolean}
 */
function isGhAvailable() {
  return execSafe('gh --version', process.cwd()) !== null;
}

/**
 * branch에 연결된 open PR이 있는지 확인 (gh CLI 필요).
 * @param {string} branch
 * @returns {'open'|'merged'|'closed'|'unknown'}
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
  return 'none'; // PR 자체가 없음
}

/**
 * branch가 origin/main에 완전히 merge되었는지 확인.
 * @param {string} remote
 * @param {string} branch branch의 full remote ref (예: origin/agent/builder/xxxx)
 * @param {string} cwd
 * @returns {boolean}
 */
function isMergedIntoMain(remote, branch, cwd) {
  const result = execSafe(
    `git merge-base --is-ancestor "${remote}/${branch}" "${remote}/main"`,
    cwd
  );
  // exit 0 = ancestor (merged), exit 1 = not ancestor
  // execSafe returns null on non-zero exit
  return result !== null || execSafe(
    `git merge-base --is-ancestor "refs/remotes/${remote}/${branch}" "refs/remotes/${remote}/main"`,
    cwd
  ) !== null;
}

/**
 * branch의 마지막 커밋 날짜 반환 (ISO 형식).
 * @param {string} remote
 * @param {string} branch
 * @param {string} cwd
 * @returns {string}
 */
function getBranchDate(remote, branch, cwd) {
  return execSafe(
    `git log -1 --format="%ci" "${remote}/${branch}"`,
    cwd
  ) || 'unknown';
}

// ---------------------------------------------------------------------------
// 핵심 함수
// ---------------------------------------------------------------------------

/**
 * stale branch 목록 감지.
 *
 * @param {{ remote?: string, cwd?: string }} opts
 * @returns {{ stale: BranchInfo[], blocked: BranchInfo[], warnings: string[] }}
 *
 * @typedef {{ branch: string, lastCommit: string, prState: string, reason: string }} BranchInfo
 */
function detectStaleBranches(opts = {}) {
  const remote = opts.remote || 'origin';
  const cwd = opts.cwd || process.cwd();

  const warnings = [];
  const stale = [];
  const blocked = [];

  // 원격 branch 목록 fetch
  const fetchResult = execSafe(`git fetch ${remote} --prune 2>&1`, cwd);
  if (fetchResult === null) {
    warnings.push(`git fetch ${remote} 실패. 원격 정보가 최신이 아닐 수 있습니다.`);
  }

  // agent/ prefix를 가진 원격 branch 목록
  const remoteBranchesRaw = execSafe(
    `git branch -r --list "${remote}/agent/*"`,
    cwd
  );

  if (!remoteBranchesRaw) {
    return { stale: [], blocked: [], warnings: ['agent/ prefix 원격 branch가 없습니다.'] };
  }

  const remoteBranches = remoteBranchesRaw
    .split('\n')
    .map((b) => b.trim().replace(`${remote}/`, ''))
    .filter((b) => b.length > 0 && b !== 'HEAD');

  const ghAvailable = isGhAvailable();
  if (!ghAvailable) {
    warnings.push('gh CLI를 찾을 수 없습니다. PR 상태 확인이 제한됩니다. open PR 여부를 수동으로 확인하세요.');
  }

  for (const branch of remoteBranches) {
    const lastCommit = getBranchDate(remote, branch, cwd);

    // merge 여부 확인
    const merged = isMergedIntoMain(remote, branch, cwd);

    if (!merged) {
      // main에 없는 커밋이 있는 branch — 별도 blocked 표시
      const prState = ghAvailable ? getPrState(branch) : 'unknown';
      blocked.push({
        branch,
        lastCommit,
        prState,
        reason: 'unmerged: origin/main에 없는 커밋 있음',
      });
      continue;
    }

    // PR 상태 확인
    const prState = ghAvailable ? getPrState(branch) : 'unknown';

    if (prState === 'open') {
      // open PR이 있음 — 자동 삭제 금지
      blocked.push({
        branch,
        lastCommit,
        prState,
        reason: 'open PR 있음 — 삭제 금지',
      });
      continue;
    }

    if (prState === 'unknown') {
      warnings.push(`branch '${branch}': PR 상태를 확인할 수 없습니다. gh CLI 없이는 수동 확인 필요.`);
    }

    // stale 후보 (merged + PR closed/merged/none)
    stale.push({
      branch,
      lastCommit,
      prState,
      reason: 'merged into main, PR closed/merged/none',
    });
  }

  return { stale, blocked, warnings };
}

// ---------------------------------------------------------------------------
// 출력 형식
// ---------------------------------------------------------------------------

function printText(result) {
  const { stale, blocked, warnings } = result;

  if (warnings.length > 0) {
    console.log('[경고]');
    for (const w of warnings) console.log(`  - ${w}`);
    console.log('');
  }

  if (stale.length === 0 && blocked.length === 0) {
    console.log('stale branch 없음. 정리 대상이 없습니다.');
    return;
  }

  if (stale.length > 0) {
    console.log(`[stale 후보 — 안전하게 삭제 가능] (${stale.length}개)`);
    console.log('  삭제 명령: git push origin --delete <branch>');
    for (const b of stale) {
      console.log(`  - ${b.branch}`);
      console.log(`      최종 커밋: ${b.lastCommit}`);
      console.log(`      PR 상태:   ${b.prState}`);
    }
    console.log('');
  }

  if (blocked.length > 0) {
    console.log(`[blocked — 수동 확인 필요] (${blocked.length}개)`);
    for (const b of blocked) {
      console.log(`  - ${b.branch}`);
      console.log(`      최종 커밋: ${b.lastCommit}`);
      console.log(`      PR 상태:   ${b.prState}`);
      console.log(`      사유:      ${b.reason}`);
    }
    console.log('');
  }

  console.log(`완료: stale ${stale.length}개, blocked ${blocked.length}개, 경고 ${warnings.length}개`);
}

// ---------------------------------------------------------------------------
// CLI 진입점
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  const jsonFlag = args.includes('--json');
  const remoteIdx = args.indexOf('--remote');
  const remote = remoteIdx >= 0 ? args[remoteIdx + 1] : 'origin';

  try {
    const result = detectStaleBranches({ remote, cwd: process.cwd() });

    if (jsonFlag) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printText(result);
    }

    process.exit(0);
  } catch (err) {
    console.error('error: ' + err.message);
    process.exit(1);
  }
}

module.exports = { detectStaleBranches };
