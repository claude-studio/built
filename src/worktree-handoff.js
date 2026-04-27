'use strict';

const fs           = require('fs');
const path         = require('path');
const childProcess = require('child_process');

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function git(projectRoot, args, opts = {}) {
  const result = childProcess.spawnSync('git', args, {
    cwd: opts.cwd || projectRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

function isInsideGitWorktree(projectRoot) {
  const result = git(projectRoot, ['rev-parse', '--is-inside-work-tree']);
  return result.ok && result.stdout === 'true';
}

function currentBranch(projectRoot) {
  const result = git(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return result.ok ? result.stdout || null : null;
}

function worktreeDirtySummary(worktreePath) {
  if (!worktreePath || !fs.existsSync(worktreePath)) {
    return { exists: false, dirty: false, count: 0, sample: [] };
  }

  const status = git(worktreePath, ['status', '--porcelain', '--untracked-files=all'], { cwd: worktreePath });
  if (!status.ok || !status.stdout) {
    return { exists: true, dirty: false, count: 0, sample: [] };
  }

  const lines = status.stdout.split('\n').filter(Boolean);
  return {
    exists: true,
    dirty: lines.length > 0,
    count: lines.length,
    sample: lines.slice(0, 5),
  };
}

function branchMergedIntoRoot(projectRoot, branch) {
  if (!branch || !isInsideGitWorktree(projectRoot)) return null;
  const result = git(projectRoot, ['merge-base', '--is-ancestor', branch, 'HEAD']);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  return null;
}

function resolveExecutionWorktree(state, registryEntry) {
  const stateInfo = state && state.execution_worktree ? state.execution_worktree : {};
  const enabled = Boolean(stateInfo.enabled || (registryEntry && registryEntry.worktreePath));
  return {
    enabled,
    path: (registryEntry && registryEntry.worktreePath) || stateInfo.path || null,
    branch: (registryEntry && registryEntry.worktreeBranch) || stateInfo.branch || null,
    resultDir: (registryEntry && registryEntry.resultDir) || stateInfo.result_dir || null,
    cleanup: stateInfo.cleanup || null,
    fallbackReason: stateInfo.fallback_reason || null,
  };
}

function assessRootApplication(projectRoot, state, registryEntry) {
  const info = resolveExecutionWorktree(state, registryEntry);
  const rootBranch = currentBranch(projectRoot);

  if (!info.enabled) {
    return {
      mode: 'root',
      rootApplied: true,
      status: 'root_execution',
      summary: 'root working tree에서 실행되었습니다.',
      rootBranch,
      worktree: info,
      dirty: { exists: false, dirty: false, count: 0, sample: [] },
    };
  }

  const dirty = worktreeDirtySummary(info.path);
  const branchMerged = branchMergedIntoRoot(projectRoot, info.branch);
  let status = 'pending';
  let summary = 'execution worktree 변경사항이 root에 아직 적용되지 않았습니다.';
  let rootApplied = false;

  if (!dirty.exists) {
    status = branchMerged === true ? 'merged_worktree_removed' : 'worktree_missing';
    summary = branchMerged === true
      ? 'worktree는 없지만 branch commit은 현재 root HEAD에 포함되어 있습니다.'
      : 'execution worktree 경로가 없어 root 적용 여부를 확인할 수 없습니다.';
    rootApplied = branchMerged === true;
  } else if (dirty.dirty) {
    status = 'pending_uncommitted_worktree_changes';
    summary = `execution worktree에 미적용 변경 ${dirty.count}개가 있습니다. root working tree는 의도적으로 변경되지 않았습니다.`;
  } else if (branchMerged === true) {
    status = 'merged_to_root_branch';
    summary = 'execution worktree branch commit이 현재 root HEAD에 포함되어 있습니다.';
    rootApplied = true;
  } else if (branchMerged === false) {
    status = 'pending_branch_merge';
    summary = 'execution worktree branch가 현재 root HEAD에 아직 merge되지 않았습니다.';
  } else {
    status = 'unknown';
    summary = 'root 적용 상태를 git으로 확인할 수 없습니다.';
  }

  return {
    mode: 'worktree',
    rootApplied,
    status,
    summary,
    rootBranch,
    branchMerged,
    worktree: info,
    dirty,
  };
}

function formatHandoffMarkdown(feature, projectRoot, state, registryEntry) {
  const assessment = assessRootApplication(projectRoot, state, registryEntry);
  const info = assessment.worktree;
  const runDir = path.join(projectRoot, '.built', 'runtime', 'runs', feature);

  if (assessment.mode === 'root') {
    return [
      '## Root 적용 / handoff',
      '',
      '- 실행 모드: root working tree',
      `- 상태: ${assessment.summary}`,
    ].join('\n');
  }

  const worktreePath = info.path || '(unknown)';
  const resultDir = info.resultDir || '(unknown)';
  const branch = info.branch || '(unknown)';
  const patchPath = path.join(runDir, 'worktree.diff');
  const lines = [
    '## Root 적용 / handoff',
    '',
    '- 실행 모드: execution worktree-first',
    `- 상태: ${assessment.summary}`,
    `- root branch: \`${assessment.rootBranch || '-'}\``,
    `- worktree branch: \`${branch}\``,
    `- worktree path: \`${worktreePath}\``,
    `- result_dir: \`${resultDir}\``,
    '- root working tree는 run 완료 시 자동으로 변경되지 않습니다.',
    '',
    '### 다음 단계',
    '',
    `1. 변경 확인: \`git -C ${shellQuote(worktreePath)} status --short\` 및 \`git -C ${shellQuote(worktreePath)} diff\``,
    `2. patch 적용: \`git -C ${shellQuote(worktreePath)} diff --binary > ${shellQuote(patchPath)}\` 후 root에서 \`git apply ${shellQuote(patchPath)}\``,
    `3. branch merge가 필요한 경우: worktree에서 commit 후 root에서 \`git merge ${shellQuote(branch)}\``,
    `4. 정리: 적용/보존 후 \`node scripts/cleanup.js ${shellQuote(feature)} --archive\``,
  ];

  if (assessment.dirty && assessment.dirty.sample && assessment.dirty.sample.length > 0) {
    lines.push('', '### 변경 샘플');
    for (const item of assessment.dirty.sample) {
      lines.push(`- \`${item}\``);
    }
  }

  return lines.join('\n');
}

function formatHandoffConsole(feature, projectRoot, state, registryEntry) {
  return formatHandoffMarkdown(feature, projectRoot, state, registryEntry)
    .split('\n')
    .map((line) => line ? `[built:run] ${line}` : '[built:run]')
    .join('\n');
}

module.exports = {
  assessRootApplication,
  resolveExecutionWorktree,
  formatHandoffMarkdown,
  formatHandoffConsole,
  shellQuote,
};
