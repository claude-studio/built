#!/usr/bin/env node
/**
 * 완료된 execution worktree 결과를 control root에 명시적으로 적용한다.
 *
 * provider와 분리된 control-plane helper이며 state.json은 updateState를 통해서만 갱신한다.
 */

'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { updateState } = require('./state');

const MAX_GIT_OUTPUT = 64 * 1024 * 1024;

function git(cwd, args, opts = {}) {
  const result = childProcess.spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    input: opts.input,
    env: Object.assign({}, process.env, opts.env || {}),
    maxBuffer: MAX_GIT_OUTPUT,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || '').trim(),
    error: result.error || null,
  };
}

function failure(code, message, recovery, details = {}) {
  return {
    ok: false,
    code,
    message,
    recovery: recovery || null,
    details,
  };
}

function isValidFeature(feature) {
  return typeof feature === 'string' &&
    feature.length > 0 &&
    feature !== '.' &&
    feature !== '..' &&
    /^[A-Za-z0-9._-]+$/.test(feature);
}

function readJson(filePath, missingCode, invalidCode) {
  if (!fs.existsSync(filePath)) {
    return { error: failure(missingCode, `필수 파일이 없습니다: ${filePath}`, '완료된 /built:run의 control-plane state를 확인하세요.') };
  }
  try {
    return { value: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (err) {
    return { error: failure(invalidCode, `JSON을 읽을 수 없습니다: ${filePath}`, '손상된 control-plane 파일을 복구한 뒤 다시 실행하세요.', { cause: err.message }) };
  }
}

function samePath(a, b) {
  if (!a || !b) return false;
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch (_) {
    return path.resolve(a) === path.resolve(b);
  }
}

function isPathInside(candidate, parent) {
  const rel = path.relative(parent, candidate);
  return rel === '' || (rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function expectedWorktreeRoots(projectRoot) {
  const projectName = path.basename(projectRoot);
  return [
    path.join(projectRoot, '.claude', 'worktrees'),
    path.join(path.dirname(projectRoot), `${projectName}-worktrees`),
  ];
}

function canonicalExistingPath(candidate) {
  try {
    return fs.realpathSync(candidate);
  } catch (_) {
    return null;
  }
}

function gitAbsolutePath(cwd, value) {
  if (!value) return null;
  const resolved = path.isAbsolute(value) ? value : path.resolve(cwd, value);
  return canonicalExistingPath(resolved) || path.resolve(resolved);
}

function hashPatch(patch) {
  return crypto.createHash('sha256').update(patch, 'utf8').digest('hex');
}

/**
 * worktree의 tracked/staged/untracked 변경을 하나의 binary patch로 만든다.
 * untracked 파일은 임시 index에 intent-to-add로만 올려 실제 worktree index는 바꾸지 않는다.
 */
function buildWorktreePatch(worktreePath) {
  const untrackedResult = git(worktreePath, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (!untrackedResult.ok) {
    return failure(
      'git_inspection_failed',
      'worktree의 untracked 파일을 확인하지 못했습니다.',
      `git -C ${worktreePath} status --short를 확인하세요.`,
      { stderr: untrackedResult.stderr }
    );
  }

  const untracked = untrackedResult.stdout.split('\0').filter(Boolean);
  let tempDir = null;
  let env = null;

  try {
    if (untracked.length > 0) {
      const indexResult = git(worktreePath, ['rev-parse', '--git-path', 'index']);
      if (!indexResult.ok || !indexResult.stdout.trim()) {
        return failure('git_inspection_failed', 'worktree index 경로를 확인하지 못했습니다.', 'worktree Git metadata를 복구한 뒤 다시 실행하세요.');
      }

      const sourceIndex = path.isAbsolute(indexResult.stdout.trim())
        ? indexResult.stdout.trim()
        : path.resolve(worktreePath, indexResult.stdout.trim());
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'built-apply-index-'));
      const tempIndex = path.join(tempDir, 'index');
      fs.copyFileSync(sourceIndex, tempIndex);
      env = { GIT_INDEX_FILE: tempIndex };

      const intentResult = git(worktreePath, ['add', '-N', '--', ...untracked], { env });
      if (!intentResult.ok) {
        return failure(
          'unsupported_worktree_changes',
          'untracked 변경을 안전한 patch 입력으로 만들지 못했습니다.',
          'untracked 파일을 commit하거나 수동으로 보존한 뒤 다시 실행하세요.',
          { stderr: intentResult.stderr }
        );
      }
    }

    const diffResult = git(
      worktreePath,
      ['diff', '--binary', '--full-index', '--ita-visible-in-index', 'HEAD', '--'],
      env ? { env } : {}
    );
    if (!diffResult.ok) {
      return failure(
        'git_inspection_failed',
        'worktree binary patch를 생성하지 못했습니다.',
        `git -C ${worktreePath} diff --binary HEAD를 확인하세요.`,
        { stderr: diffResult.stderr }
      );
    }

    return {
      ok: true,
      patch: diffResult.stdout,
      patchSha256: hashPatch(diffResult.stdout),
      untracked,
    };
  } finally {
    if (tempDir) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

function resolvePointers(projectRoot, feature, state, registryEntry) {
  const stateInfo = state && state.execution_worktree;
  if (!state || state.feature !== feature || (registryEntry && registryEntry.featureId !== feature)) {
    return failure('stale_pointer', 'state/registry feature identity가 요청한 feature와 다릅니다.', '올바른 feature의 control-plane state를 확인하세요.', { pointer: 'feature_mismatch' });
  }
  if (!stateInfo || stateInfo.enabled !== true) {
    return failure('not_worktree_run', 'execution worktree run이 아닙니다.', 'root 실행 결과에는 /built:apply가 필요하지 않습니다.');
  }
  if (!registryEntry) {
    return failure('stale_pointer', 'registry에 canonical worktree pointer가 없습니다.', 'state.json과 registry.json을 복구하거나 run을 다시 수행하세요.', { pointer: 'registry_entry' });
  }

  const statePath = stateInfo.path;
  const registryPath = registryEntry.worktreePath;
  const stateBranch = stateInfo.branch;
  const registryBranch = registryEntry.worktreeBranch;
  const stateResultDir = stateInfo.result_dir;
  const registryResultDir = registryEntry.resultDir;
  const values = [statePath, registryPath, stateBranch, registryBranch, stateResultDir, registryResultDir];
  if (values.some((value) => typeof value !== 'string' || value.length === 0)) {
    return failure('stale_pointer', 'state/registry worktree pointer가 누락되었습니다.', 'state.json과 registry.json의 path, branch, resultDir을 확인하세요.', { pointer: 'missing_value' });
  }
  if (![statePath, registryPath, stateResultDir, registryResultDir].every(path.isAbsolute)) {
    return failure('stale_pointer', 'state/registry path pointer는 절대 경로여야 합니다.', '완료된 run의 canonical pointer를 복구하세요.', { pointer: 'relative_path' });
  }
  if (!samePath(statePath, registryPath) || stateBranch !== registryBranch || !samePath(stateResultDir, registryResultDir)) {
    return failure('stale_pointer', 'state.json과 registry.json의 canonical pointer가 서로 다릅니다.', '두 control-plane pointer를 같은 completed run 기준으로 복구하세요.', { pointer: 'mismatch' });
  }

  const worktreePath = canonicalExistingPath(statePath);
  const resultDir = canonicalExistingPath(stateResultDir);
  if (!worktreePath || !fs.statSync(worktreePath).isDirectory()) {
    return failure('stale_pointer', 'execution worktree 경로가 없거나 읽을 수 없습니다.', 'worktree를 복구하거나 run을 다시 수행하세요.', { pointer: 'worktree_missing' });
  }
  if (!resultDir || !fs.statSync(resultDir).isDirectory()) {
    return failure('stale_pointer', 'canonical resultDir 경로가 없거나 읽을 수 없습니다.', 'run 산출물 pointer를 복구한 뒤 다시 실행하세요.', { pointer: 'result_dir_missing' });
  }

  const canonicalRoot = canonicalExistingPath(projectRoot) || path.resolve(projectRoot);
  const allowed = expectedWorktreeRoots(canonicalRoot)
    .map(canonicalExistingPath)
    .filter(Boolean);
  if (!allowed.some((root) => isPathInside(worktreePath, root))) {
    return failure('worktree_outside_allowed_root', 'execution worktree가 허용된 root 밖에 있습니다.', 'state/registry pointer를 확인하고 임의 경로는 수동으로 검토하세요.', { worktreePath });
  }
  if (!isPathInside(resultDir, worktreePath)) {
    return failure('stale_pointer', 'canonical resultDir이 execution worktree 밖을 가리킵니다.', 'state/registry resultDir pointer를 복구하세요.', { pointer: 'result_dir_outside_worktree' });
  }

  const expectedResultDir = path.join(worktreePath, '.built', 'features', feature);
  if (!samePath(resultDir, expectedResultDir)) {
    return failure('stale_pointer', 'canonical resultDir이 feature의 예상 경로와 다릅니다.', 'state/registry resultDir pointer를 확인하세요.', { pointer: 'unexpected_result_dir' });
  }

  return {
    ok: true,
    worktreePath,
    branch: stateBranch,
    resultDir,
  };
}

function inspectRepository(projectRoot, pointers) {
  const rootTop = git(projectRoot, ['rev-parse', '--show-toplevel']);
  if (!rootTop.ok || !samePath(rootTop.stdout.trim(), projectRoot)) {
    return failure('root_not_git_repository', '현재 디렉토리가 control root Git worktree가 아닙니다.', '대상 프로젝트 root에서 /built:apply를 실행하세요.');
  }

  const worktreeTop = git(pointers.worktreePath, ['rev-parse', '--show-toplevel']);
  if (!worktreeTop.ok || !samePath(worktreeTop.stdout.trim(), pointers.worktreePath)) {
    return failure('stale_pointer', 'pointer 경로가 유효한 Git worktree가 아닙니다.', 'execution worktree를 복구하거나 run을 다시 수행하세요.', { pointer: 'not_git_worktree' });
  }

  const rootCommon = git(projectRoot, ['rev-parse', '--git-common-dir']);
  const worktreeCommon = git(pointers.worktreePath, ['rev-parse', '--git-common-dir']);
  if (!rootCommon.ok || !worktreeCommon.ok ||
      !samePath(gitAbsolutePath(projectRoot, rootCommon.stdout.trim()), gitAbsolutePath(pointers.worktreePath, worktreeCommon.stdout.trim()))) {
    return failure('stale_pointer', 'execution worktree가 control root와 같은 Git repository에 속하지 않습니다.', 'state/registry pointer를 확인하세요.', { pointer: 'repository_mismatch' });
  }

  const branch = git(pointers.worktreePath, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!branch.ok || branch.stdout.trim() !== pointers.branch) {
    return failure('branch_mismatch', `worktree branch가 expected branch와 다릅니다. expected=${pointers.branch}, actual=${branch.stdout.trim() || '-'}`, '올바른 worktree branch를 checkout하거나 pointer를 복구하세요.');
  }

  const rootStatus = git(projectRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (!rootStatus.ok) {
    return failure('git_inspection_failed', 'root working tree 상태를 확인하지 못했습니다.', 'git status를 확인하세요.', { stderr: rootStatus.stderr });
  }
  if (rootStatus.stdout.length > 0) {
    return failure('dirty_root', 'root working tree가 clean하지 않아 적용을 중단했습니다.', 'root 변경을 commit, stash 또는 별도 보존한 뒤 다시 실행하세요.');
  }

  const worktreeStatus = git(pointers.worktreePath, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const rootHead = git(projectRoot, ['rev-parse', 'HEAD']);
  const worktreeHead = git(pointers.worktreePath, ['rev-parse', 'HEAD']);
  if (!worktreeStatus.ok || !rootHead.ok || !worktreeHead.ok) {
    return failure('git_inspection_failed', 'root/worktree Git 상태를 확인하지 못했습니다.', '두 worktree에서 git status와 git rev-parse HEAD를 확인하세요.');
  }

  const ahead = git(projectRoot, ['rev-list', '--count', `${rootHead.stdout.trim()}..${worktreeHead.stdout.trim()}`]);
  const behind = git(projectRoot, ['rev-list', '--count', `${worktreeHead.stdout.trim()}..${rootHead.stdout.trim()}`]);
  if (!ahead.ok || !behind.ok) {
    return failure('git_inspection_failed', 'root와 worktree commit 관계를 확인하지 못했습니다.', 'git merge-base 결과를 확인하세요.');
  }

  return {
    ok: true,
    rootHead: rootHead.stdout.trim(),
    worktreeHead: worktreeHead.stdout.trim(),
    dirty: worktreeStatus.stdout.length > 0,
    ahead: Number(ahead.stdout.trim() || 0),
    behind: Number(behind.stdout.trim() || 0),
  };
}

function planApplication(projectRoot, pointers, repo) {
  if (repo.dirty && repo.ahead > 0) {
    return failure('mixed_worktree', 'worktree에 미적용 commit과 uncommitted 변경이 함께 있습니다.', 'worktree 변경을 한 방식으로 정리하세요: 모두 commit하거나 commit 없는 patch 상태로 만드세요.');
  }

  if (repo.dirty) {
    const patchResult = buildWorktreePatch(pointers.worktreePath);
    if (!patchResult.ok) return patchResult;
    if (!patchResult.patch) {
      return failure('unsupported_worktree_changes', 'worktree 변경을 binary patch로 표현할 수 없습니다.', '변경을 commit한 뒤 fast-forward 적용을 사용하세요.');
    }

    const check = git(projectRoot, ['apply', '--check', '--binary', '-'], { input: patchResult.patch });
    if (!check.ok) {
      const reverse = git(projectRoot, ['apply', '--reverse', '--check', '--binary', '-'], { input: patchResult.patch });
      if (reverse.ok) {
        return {
          ok: true,
          method: 'noop',
          code: 'already_present',
          summary: '동일한 worktree patch가 root에 이미 존재합니다.',
          patch: patchResult.patch,
          patchSha256: patchResult.patchSha256,
        };
      }
      return failure('apply_conflict', 'worktree binary patch가 현재 root에 clean하게 적용되지 않습니다.', 'root/worktree diff를 inspect하고 충돌을 수동으로 해결하세요.', { stderr: check.stderr });
    }

    return {
      ok: true,
      method: 'patch',
      code: 'ready_patch',
      summary: '검증된 binary patch를 root working tree에 적용할 수 있습니다.',
      patch: patchResult.patch,
      patchSha256: patchResult.patchSha256,
    };
  }

  if (repo.ahead > 0 && repo.behind > 0) {
    return failure('non_fast_forward', 'worktree branch와 root HEAD가 분기되어 fast-forward할 수 없습니다.', 'worktree branch를 최신 root 기준으로 정리한 뒤 다시 실행하세요.');
  }
  if (repo.ahead > 0) {
    return {
      ok: true,
      method: 'fast_forward',
      code: 'ready_fast_forward',
      summary: 'worktree branch를 --ff-only로 root에 적용할 수 있습니다.',
    };
  }

  return {
    ok: true,
    method: 'noop',
    code: 'already_present',
    summary: repo.behind > 0
      ? 'worktree HEAD가 이미 현재 root HEAD에 포함되어 있습니다.'
      : 'root와 worktree HEAD가 같고 적용할 변경이 없습니다.',
  };
}

function persistAppliedState(runDir, state, repo, plan, rootHeadAfter) {
  const now = new Date().toISOString();
  const status = plan.method === 'patch'
    ? 'applied_patch'
    : plan.method === 'fast_forward'
      ? 'applied_fast_forward'
      : 'applied_noop';
  const summary = plan.method === 'patch'
    ? 'execution worktree의 미커밋 변경을 검증된 binary patch로 root에 적용했습니다.'
    : plan.method === 'fast_forward'
      ? 'execution worktree branch를 --ff-only로 root에 적용했습니다.'
      : plan.summary;

  const executionWorktree = Object.assign({}, state.execution_worktree, {
    root_applied: true,
    root_apply_status: status,
    root_apply_summary: summary,
    root_applied_at: now,
    root_apply_method: plan.method,
    root_apply_root_head_before: repo.rootHead,
    root_apply_root_head_after: rootHeadAfter,
    root_apply_worktree_head: repo.worktreeHead,
  });
  if (plan.patchSha256) executionWorktree.root_apply_patch_sha256 = plan.patchSha256;

  return updateState(runDir, { execution_worktree: executionWorktree });
}

function applyFeature(projectRoot, feature, opts = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  if (!isValidFeature(feature)) {
    return failure('invalid_feature', 'feature 이름이 비어 있거나 안전하지 않습니다.', 'kebab-case feature 이름을 지정하세요.');
  }

  const runtimeDir = path.join(root, '.built', 'runtime');
  const runDir = path.join(runtimeDir, 'runs', feature);
  const stateRead = readJson(path.join(runDir, 'state.json'), 'state_missing', 'state_invalid');
  if (stateRead.error) return stateRead.error;
  const state = stateRead.value;

  if (state.status !== 'completed') {
    return failure('run_not_completed', `run status가 completed가 아닙니다: ${state.status || '-'}`, 'run을 완료한 뒤 다시 실행하세요.');
  }
  if (state.execution_worktree && state.execution_worktree.root_applied === true) {
    return {
      ok: true,
      code: 'already_applied',
      method: state.execution_worktree.root_apply_method || 'noop',
      dryRun: !!opts.dryRun,
      noOp: true,
      message: state.execution_worktree.root_apply_summary || '이미 root에 적용된 feature입니다.',
      state,
    };
  }
  if (!state.execution_worktree || state.execution_worktree.root_applied !== false) {
    return failure('apply_state_missing', 'state.execution_worktree.root_applied가 false가 아닙니다.', 'completed run의 handoff state를 확인하거나 run을 다시 수행하세요.');
  }

  const registryRead = readJson(path.join(runtimeDir, 'registry.json'), 'stale_pointer', 'stale_pointer');
  if (registryRead.error) return registryRead.error;
  const registryEntry = registryRead.value && registryRead.value.features
    ? registryRead.value.features[feature]
    : null;
  const pointers = resolvePointers(root, feature, state, registryEntry);
  if (!pointers.ok) return pointers;

  const repo = inspectRepository(root, pointers);
  if (!repo.ok) return repo;
  const plan = planApplication(root, pointers, repo);
  if (!plan.ok) return plan;

  if (opts.dryRun) {
    return {
      ok: true,
      code: 'dry_run_ready',
      method: plan.method,
      dryRun: true,
      noOp: plan.method === 'noop',
      message: plan.summary,
      pointers,
      repo,
    };
  }

  let rootHeadAfter = repo.rootHead;
  if (plan.method === 'patch') {
    const rootStatus = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    const check = git(root, ['apply', '--check', '--binary', '-'], { input: plan.patch });
    if (!rootStatus.ok || rootStatus.stdout.length > 0 || !check.ok) {
      return failure('root_changed', 'preflight 이후 root 상태가 바뀌어 적용을 중단했습니다.', 'root를 clean 상태로 만든 뒤 다시 실행하세요.');
    }
    const applied = git(root, ['apply', '--binary', '-'], { input: plan.patch });
    if (!applied.ok) {
      return failure('apply_failed', '검증 후 binary patch 적용에 실패했습니다.', 'root 상태를 확인하고 다시 preflight하세요.', { stderr: applied.stderr });
    }
  } else if (plan.method === 'fast_forward') {
    const currentHead = git(root, ['rev-parse', 'HEAD']);
    const rootStatus = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    if (!currentHead.ok || currentHead.stdout.trim() !== repo.rootHead || !rootStatus.ok || rootStatus.stdout.length > 0) {
      return failure('root_changed', 'preflight 이후 root HEAD 또는 working tree가 바뀌어 적용을 중단했습니다.', 'root를 다시 확인한 뒤 apply를 재실행하세요.');
    }
    const merged = git(root, ['merge', '--ff-only', pointers.branch]);
    if (!merged.ok) {
      return failure('non_fast_forward', 'git merge --ff-only가 실패했습니다.', 'root/worktree commit 관계를 다시 확인하세요.', { stderr: merged.stderr });
    }
    const after = git(root, ['rev-parse', 'HEAD']);
    rootHeadAfter = after.ok ? after.stdout.trim() : repo.worktreeHead;
  }

  let nextState;
  try {
    nextState = persistAppliedState(runDir, state, repo, plan, rootHeadAfter);
  } catch (err) {
    return failure(
      'state_update_failed',
      'root 적용은 완료됐지만 state.json 기록에 실패했습니다.',
      'root 변경을 되돌리지 말고 state.json의 root_apply_* 필드를 복구하세요.',
      { cause: err.message, rootApplied: true, method: plan.method }
    );
  }

  return {
    ok: true,
    code: nextState.execution_worktree.root_apply_status,
    method: plan.method,
    dryRun: false,
    noOp: plan.method === 'noop',
    message: nextState.execution_worktree.root_apply_summary,
    state: nextState,
    pointers,
    repo: Object.assign({}, repo, { rootHeadAfter }),
  };
}

module.exports = {
  applyFeature,
  buildWorktreePatch,
  expectedWorktreeRoots,
  hashPatch,
  inspectRepository,
  isPathInside,
  planApplication,
  resolvePointers,
};
