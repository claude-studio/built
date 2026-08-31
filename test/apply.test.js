#!/usr/bin/env node
/** scripts/apply.js / src/worktree-apply.js 회귀 테스트. */

'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyFeature } = require('../src/worktree-apply');
const { applyCommand } = require('../scripts/apply');

const tmpDirs = [];
let passed = 0;
let failed = 0;

function git(cwd, args) {
  return childProcess.execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function makeProject(feature = 'apply-feature') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'built-apply-test-'));
  tmpDirs.push(root);
  git(root, ['init']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Built Test']);
  fs.writeFileSync(path.join(root, '.gitignore'), '.built/\n.claude/worktrees/\n', 'utf8');
  fs.writeFileSync(path.join(root, 'README.md'), '# base\n', 'utf8');
  git(root, ['add', '.gitignore', 'README.md']);
  git(root, ['commit', '-m', '초기 테스트 커밋']);

  const branch = `built/worktree/${feature}`;
  const worktreePath = path.join(root, '.claude', 'worktrees', feature);
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  git(root, ['worktree', 'add', '-b', branch, worktreePath, 'HEAD']);
  git(worktreePath, ['config', 'user.email', 'test@example.com']);
  git(worktreePath, ['config', 'user.name', 'Built Test']);

  const resultDir = path.join(worktreePath, '.built', 'features', feature);
  fs.mkdirSync(resultDir, { recursive: true });
  fs.writeFileSync(path.join(resultDir, 'report.md'), '# report\n', 'utf8');

  const runtimeDir = path.join(root, '.built', 'runtime');
  const runDir = path.join(runtimeDir, 'runs', feature);
  const statePath = path.join(runDir, 'state.json');
  const state = {
    feature,
    phase: 'report',
    status: 'completed',
    pid: null,
    heartbeat: null,
    startedAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    attempt: 1,
    last_error: null,
    execution_worktree: {
      enabled: true,
      path: worktreePath,
      branch,
      result_dir: resultDir,
      root_applied: false,
      root_apply_status: 'pending',
      root_apply_summary: 'pending',
    },
  };
  writeJson(statePath, state);
  writeJson(path.join(runtimeDir, 'registry.json'), {
    version: 1,
    features: {
      [feature]: {
        featureId: feature,
        status: 'completed',
        worktreePath,
        worktreeBranch: branch,
        resultDir,
      },
    },
  });

  return { root, feature, branch, worktreePath, resultDir, runDir, statePath };
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.stack || err.message}`);
    failed++;
  }
}

console.log('\n[apply.js 단위 테스트]\n');

test('clean root + uncommitted binary patch를 적용하고 state를 기록', () => {
  const ctx = makeProject('patch-success');
  fs.writeFileSync(path.join(ctx.worktreePath, 'README.md'), '# patched\n', 'utf8');
  fs.mkdirSync(path.join(ctx.worktreePath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(ctx.worktreePath, 'src', 'new-file.txt'), 'new\n', 'utf8');
  fs.writeFileSync(path.join(ctx.worktreePath, 'src', 'asset.bin'), Buffer.from([0, 1, 2, 255, 0, 128]));

  const result = applyFeature(ctx.root, ctx.feature);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, 'applied_patch');
  assert.strictEqual(result.method, 'patch');
  assert.strictEqual(fs.readFileSync(path.join(ctx.root, 'README.md'), 'utf8'), '# patched\n');
  assert.strictEqual(fs.readFileSync(path.join(ctx.root, 'src', 'new-file.txt'), 'utf8'), 'new\n');
  assert.deepStrictEqual(
    fs.readFileSync(path.join(ctx.root, 'src', 'asset.bin')),
    Buffer.from([0, 1, 2, 255, 0, 128])
  );

  const state = readJson(ctx.statePath);
  assert.strictEqual(state.execution_worktree.root_applied, true);
  assert.strictEqual(state.execution_worktree.root_apply_method, 'patch');
  assert.match(state.execution_worktree.root_apply_patch_sha256, /^[a-f0-9]{64}$/);
  assert.ok(state.execution_worktree.root_applied_at);
});

test('clean root + fast-forward 가능한 committed branch를 --ff-only로 적용', () => {
  const ctx = makeProject('ff-success');
  fs.writeFileSync(path.join(ctx.worktreePath, 'README.md'), '# committed\n', 'utf8');
  git(ctx.worktreePath, ['add', 'README.md']);
  git(ctx.worktreePath, ['commit', '-m', 'worktree 변경 커밋']);
  const expectedHead = git(ctx.worktreePath, ['rev-parse', 'HEAD']);

  const result = applyFeature(ctx.root, ctx.feature);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, 'applied_fast_forward');
  assert.strictEqual(result.method, 'fast_forward');
  assert.strictEqual(git(ctx.root, ['rev-parse', 'HEAD']), expectedHead);
  assert.strictEqual(readJson(ctx.statePath).execution_worktree.root_apply_method, 'fast_forward');
});

test('patch 적용 뒤 state write 실패를 exact binary diff로 복구', () => {
  const ctx = makeProject('recover-patch');
  fs.writeFileSync(path.join(ctx.worktreePath, 'README.md'), '# recovered patch\n', 'utf8');
  fs.mkdirSync(path.join(ctx.worktreePath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(ctx.worktreePath, 'src', 'untracked.bin'), Buffer.from([0, 255, 1, 128]));
  git(ctx.worktreePath, ['add', 'README.md']);
  const beforeState = fs.readFileSync(ctx.statePath, 'utf8');

  const failedWrite = applyFeature(ctx.root, ctx.feature, {
    stateWriter() { throw new Error('주입된 state write 실패'); },
  });
  assert.strictEqual(failedWrite.ok, false);
  assert.strictEqual(failedWrite.code, 'state_update_failed');
  assert.strictEqual(fs.readFileSync(ctx.statePath, 'utf8'), beforeState);
  assert.strictEqual(fs.readFileSync(path.join(ctx.root, 'README.md'), 'utf8'), '# recovered patch\n');

  const recovered = applyFeature(ctx.root, ctx.feature, { recoverState: true });
  assert.strictEqual(recovered.ok, true);
  assert.strictEqual(recovered.code, 'recovered_patch');
  assert.strictEqual(recovered.method, 'patch');
  const state = readJson(ctx.statePath).execution_worktree;
  assert.strictEqual(state.root_applied, true);
  assert.strictEqual(state.root_apply_recovered, true);
  assert.strictEqual(state.root_apply_original_applied_at_known, false);
  assert.strictEqual(state.root_applied_at, undefined);
  assert.strictEqual(state.root_apply_root_head_before, state.root_apply_root_head_after);
  assert.match(state.root_apply_patch_sha256, /^[a-f0-9]{64}$/);
  assert.strictEqual(state.root_apply_evidence_scope, 'current_git_heads_and_binary_diff');
});

test('fast-forward 뒤 state write 실패를 clean HEAD와 reflog로 복구', () => {
  const ctx = makeProject('recover-fast-forward');
  const rootHeadBefore = git(ctx.root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(ctx.worktreePath, 'README.md'), '# recovered ff\n', 'utf8');
  git(ctx.worktreePath, ['add', 'README.md']);
  git(ctx.worktreePath, ['commit', '-m', '복구할 fast-forward 커밋']);
  const expectedHead = git(ctx.worktreePath, ['rev-parse', 'HEAD']);

  const failedWrite = applyFeature(ctx.root, ctx.feature, {
    stateWriter() { throw new Error('주입된 state write 실패'); },
  });
  assert.strictEqual(failedWrite.code, 'state_update_failed');
  assert.strictEqual(git(ctx.root, ['rev-parse', 'HEAD']), expectedHead);

  const recovered = applyFeature(ctx.root, ctx.feature, { recoverState: true });
  assert.strictEqual(recovered.ok, true);
  assert.strictEqual(recovered.code, 'recovered_fast_forward');
  assert.strictEqual(recovered.method, 'fast_forward');
  const state = readJson(ctx.statePath).execution_worktree;
  assert.strictEqual(state.root_applied, true);
  assert.strictEqual(state.root_apply_root_head_before, rootHeadBefore);
  assert.strictEqual(state.root_apply_root_head_after, expectedHead);
  assert.strictEqual(state.root_applied_at, undefined);
  assert.strictEqual(state.root_apply_evidence_scope, 'current_git_state_and_reflog');
});

test('no-op 뒤 state write 실패는 동일 clean evidence로 복구', () => {
  const ctx = makeProject('recover-noop');
  const failedWrite = applyFeature(ctx.root, ctx.feature, {
    stateWriter() { throw new Error('주입된 state write 실패'); },
  });
  assert.strictEqual(failedWrite.code, 'state_update_failed');

  const recovered = applyFeature(ctx.root, ctx.feature, { recoverState: true });
  assert.strictEqual(recovered.ok, true);
  assert.strictEqual(recovered.code, 'recovered_noop');
  assert.strictEqual(recovered.method, 'noop');
  const state = readJson(ctx.statePath).execution_worktree;
  assert.strictEqual(state.root_applied, true);
  assert.strictEqual(state.root_apply_root_head_before, undefined);
  assert.strictEqual(state.root_apply_root_head_after, state.root_apply_worktree_head);
  assert.strictEqual(state.root_applied_at, undefined);
});

test('state recovery write 자체가 실패하면 root와 기존 state를 유지', () => {
  const ctx = makeProject('recover-write-failure');
  const beforeState = fs.readFileSync(ctx.statePath, 'utf8');
  const beforeHead = git(ctx.root, ['rev-parse', 'HEAD']);

  const result = applyFeature(ctx.root, ctx.feature, {
    recoverState: true,
    stateWriter() { throw new Error('주입된 recovery write 실패'); },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'state_recovery_write_failed');
  assert.strictEqual(result.details.rootChanged, false);
  assert.strictEqual(git(ctx.root, ['rev-parse', 'HEAD']), beforeHead);
  assert.strictEqual(fs.readFileSync(ctx.statePath, 'utf8'), beforeState);
});

test('patch 적용 뒤 unrelated root 변경은 state 복구를 거부', () => {
  const ctx = makeProject('recover-unrelated-root');
  fs.writeFileSync(path.join(ctx.worktreePath, 'README.md'), '# expected patch\n', 'utf8');
  const failedWrite = applyFeature(ctx.root, ctx.feature, {
    stateWriter() { throw new Error('주입된 state write 실패'); },
  });
  assert.strictEqual(failedWrite.code, 'state_update_failed');
  fs.writeFileSync(path.join(ctx.root, 'unrelated.txt'), 'user change\n', 'utf8');
  const beforeState = fs.readFileSync(ctx.statePath, 'utf8');

  const recovered = applyFeature(ctx.root, ctx.feature, { recoverState: true });
  assert.strictEqual(recovered.ok, false);
  assert.strictEqual(recovered.code, 'state_recovery_ambiguous');
  assert.strictEqual(recovered.details.evidence, 'patch_mismatch');
  assert.strictEqual(fs.readFileSync(ctx.statePath, 'utf8'), beforeState);
  assert.strictEqual(fs.readFileSync(path.join(ctx.root, 'unrelated.txt'), 'utf8'), 'user change\n');
});

test('patch 적용 뒤 root patch 변경은 hash mismatch로 복구를 거부', () => {
  const ctx = makeProject('recover-patch-mismatch');
  fs.writeFileSync(path.join(ctx.worktreePath, 'README.md'), '# expected patch\n', 'utf8');
  assert.strictEqual(applyFeature(ctx.root, ctx.feature, {
    stateWriter() { throw new Error('주입된 state write 실패'); },
  }).code, 'state_update_failed');
  fs.writeFileSync(path.join(ctx.root, 'README.md'), '# different patch\n', 'utf8');
  const beforeState = fs.readFileSync(ctx.statePath, 'utf8');

  const recovered = applyFeature(ctx.root, ctx.feature, { recoverState: true });
  assert.strictEqual(recovered.ok, false);
  assert.strictEqual(recovered.code, 'state_recovery_ambiguous');
  assert.notStrictEqual(recovered.details.rootPatchSha256, recovered.details.worktreePatchSha256);
  assert.strictEqual(fs.readFileSync(ctx.statePath, 'utf8'), beforeState);
});

test('fast-forward 복구 전 worktree가 다시 dirty해지면 mixed evidence로 거부', () => {
  const ctx = makeProject('recover-mixed');
  fs.writeFileSync(path.join(ctx.worktreePath, 'committed.txt'), 'committed\n', 'utf8');
  git(ctx.worktreePath, ['add', 'committed.txt']);
  git(ctx.worktreePath, ['commit', '-m', '복구 전용 커밋']);
  assert.strictEqual(applyFeature(ctx.root, ctx.feature, {
    stateWriter() { throw new Error('주입된 state write 실패'); },
  }).code, 'state_update_failed');
  fs.writeFileSync(path.join(ctx.worktreePath, 'later.txt'), 'later\n', 'utf8');
  const beforeState = fs.readFileSync(ctx.statePath, 'utf8');

  const recovered = applyFeature(ctx.root, ctx.feature, { recoverState: true });
  assert.strictEqual(recovered.ok, false);
  assert.strictEqual(recovered.code, 'state_recovery_ambiguous');
  assert.strictEqual(recovered.details.evidence, 'working_tree_mismatch');
  assert.strictEqual(fs.readFileSync(ctx.statePath, 'utf8'), beforeState);
});

test('복구 mode에서도 branch mismatch와 stale pointer를 먼저 거부', () => {
  const branchCtx = makeProject('recover-branch-mismatch');
  const branchState = readJson(branchCtx.statePath);
  branchState.execution_worktree.branch = 'built/worktree/wrong';
  writeJson(branchCtx.statePath, branchState);
  const branchRegistryPath = path.join(branchCtx.root, '.built', 'runtime', 'registry.json');
  const branchRegistry = readJson(branchRegistryPath);
  branchRegistry.features[branchCtx.feature].worktreeBranch = 'built/worktree/wrong';
  writeJson(branchRegistryPath, branchRegistry);
  const branchBefore = fs.readFileSync(branchCtx.statePath, 'utf8');
  const branchResult = applyFeature(branchCtx.root, branchCtx.feature, { recoverState: true });
  assert.strictEqual(branchResult.code, 'branch_mismatch');
  assert.strictEqual(fs.readFileSync(branchCtx.statePath, 'utf8'), branchBefore);

  const pointerCtx = makeProject('recover-stale-pointer');
  const pointerRegistryPath = path.join(pointerCtx.root, '.built', 'runtime', 'registry.json');
  const pointerRegistry = readJson(pointerRegistryPath);
  pointerRegistry.features[pointerCtx.feature].resultDir = path.join(pointerCtx.worktreePath, 'wrong-result');
  writeJson(pointerRegistryPath, pointerRegistry);
  const pointerBefore = fs.readFileSync(pointerCtx.statePath, 'utf8');
  const pointerResult = applyFeature(pointerCtx.root, pointerCtx.feature, { recoverState: true });
  assert.strictEqual(pointerResult.code, 'stale_pointer');
  assert.strictEqual(fs.readFileSync(pointerCtx.statePath, 'utf8'), pointerBefore);
});

test('--dry-run은 예정 patch만 반환하고 root/state를 바꾸지 않음', () => {
  const ctx = makeProject('dry-run');
  fs.writeFileSync(path.join(ctx.worktreePath, 'README.md'), '# dry-run\n', 'utf8');
  const beforeState = fs.readFileSync(ctx.statePath, 'utf8');

  const result = applyFeature(ctx.root, ctx.feature, { dryRun: true });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, 'dry_run_ready');
  assert.strictEqual(result.method, 'patch');
  assert.strictEqual(fs.readFileSync(path.join(ctx.root, 'README.md'), 'utf8'), '# base\n');
  assert.strictEqual(fs.readFileSync(ctx.statePath, 'utf8'), beforeState);
});

test('dirty root는 root/state 부분 변경 없이 거부', () => {
  const ctx = makeProject('dirty-root');
  fs.writeFileSync(path.join(ctx.worktreePath, 'README.md'), '# worktree\n', 'utf8');
  fs.writeFileSync(path.join(ctx.root, 'local.txt'), 'local\n', 'utf8');
  const beforeState = fs.readFileSync(ctx.statePath, 'utf8');

  const result = applyFeature(ctx.root, ctx.feature);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'dirty_root');
  assert.strictEqual(fs.readFileSync(path.join(ctx.root, 'README.md'), 'utf8'), '# base\n');
  assert.strictEqual(fs.readFileSync(ctx.statePath, 'utf8'), beforeState);
});

test('conflicting patch는 root/state 부분 변경 없이 거부', () => {
  const ctx = makeProject('patch-conflict');
  fs.writeFileSync(path.join(ctx.worktreePath, 'README.md'), '# worktree\n', 'utf8');
  fs.writeFileSync(path.join(ctx.root, 'README.md'), '# root\n', 'utf8');
  git(ctx.root, ['add', 'README.md']);
  git(ctx.root, ['commit', '-m', 'root 변경 커밋']);
  const beforeState = fs.readFileSync(ctx.statePath, 'utf8');

  const result = applyFeature(ctx.root, ctx.feature);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'apply_conflict');
  assert.strictEqual(fs.readFileSync(path.join(ctx.root, 'README.md'), 'utf8'), '# root\n');
  assert.strictEqual(fs.readFileSync(ctx.statePath, 'utf8'), beforeState);
});

test('diverged committed branch는 non-fast-forward로 거부', () => {
  const ctx = makeProject('non-ff');
  fs.writeFileSync(path.join(ctx.worktreePath, 'worktree.txt'), 'worktree\n', 'utf8');
  git(ctx.worktreePath, ['add', 'worktree.txt']);
  git(ctx.worktreePath, ['commit', '-m', 'worktree 커밋']);
  fs.writeFileSync(path.join(ctx.root, 'root.txt'), 'root\n', 'utf8');
  git(ctx.root, ['add', 'root.txt']);
  git(ctx.root, ['commit', '-m', 'root 커밋']);
  const beforeState = fs.readFileSync(ctx.statePath, 'utf8');

  const result = applyFeature(ctx.root, ctx.feature);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'non_fast_forward');
  assert.strictEqual(fs.readFileSync(ctx.statePath, 'utf8'), beforeState);
});

test('committed + uncommitted mixed worktree는 거부', () => {
  const ctx = makeProject('mixed');
  fs.writeFileSync(path.join(ctx.worktreePath, 'committed.txt'), 'committed\n', 'utf8');
  git(ctx.worktreePath, ['add', 'committed.txt']);
  git(ctx.worktreePath, ['commit', '-m', 'worktree 커밋']);
  fs.writeFileSync(path.join(ctx.worktreePath, 'README.md'), '# dirty\n', 'utf8');
  const beforeState = fs.readFileSync(ctx.statePath, 'utf8');

  const result = applyFeature(ctx.root, ctx.feature);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'mixed_worktree');
  assert.strictEqual(fs.readFileSync(ctx.statePath, 'utf8'), beforeState);
});

test('stale registry pointer는 root/state 부분 변경 없이 거부', () => {
  const ctx = makeProject('stale-pointer');
  fs.writeFileSync(path.join(ctx.worktreePath, 'README.md'), '# pending\n', 'utf8');
  const registryPath = path.join(ctx.root, '.built', 'runtime', 'registry.json');
  const registry = readJson(registryPath);
  registry.features[ctx.feature].resultDir = path.join(ctx.worktreePath, 'missing');
  writeJson(registryPath, registry);
  const beforeState = fs.readFileSync(ctx.statePath, 'utf8');

  const result = applyFeature(ctx.root, ctx.feature);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'stale_pointer');
  assert.strictEqual(fs.readFileSync(ctx.statePath, 'utf8'), beforeState);
});

test('expected branch와 실제 worktree branch가 다르면 거부', () => {
  const ctx = makeProject('branch-mismatch');
  const state = readJson(ctx.statePath);
  state.execution_worktree.branch = 'built/worktree/wrong';
  writeJson(ctx.statePath, state);
  const registryPath = path.join(ctx.root, '.built', 'runtime', 'registry.json');
  const registry = readJson(registryPath);
  registry.features[ctx.feature].worktreeBranch = 'built/worktree/wrong';
  writeJson(registryPath, registry);

  const result = applyFeature(ctx.root, ctx.feature);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'branch_mismatch');
});

test('변경 없는 completed worktree는 applied_noop으로 상태를 수렴', () => {
  const ctx = makeProject('empty-noop');
  const result = applyFeature(ctx.root, ctx.feature);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, 'applied_noop');
  assert.strictEqual(result.noOp, true);
  assert.strictEqual(readJson(ctx.statePath).execution_worktree.root_applied, true);
});

test('이미 적용된 feature 재실행은 명확한 no-op', () => {
  const ctx = makeProject('idempotent');
  fs.writeFileSync(path.join(ctx.worktreePath, 'README.md'), '# once\n', 'utf8');
  const first = applyFeature(ctx.root, ctx.feature);
  assert.strictEqual(first.ok, true);
  const stateAfterFirst = fs.readFileSync(ctx.statePath, 'utf8');

  const second = applyFeature(ctx.root, ctx.feature);
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.code, 'already_applied');
  assert.strictEqual(second.noOp, true);
  assert.strictEqual(fs.readFileSync(ctx.statePath, 'utf8'), stateAfterFirst);
});

test('CLI helper는 machine-readable code와 dry-run을 출력', () => {
  const ctx = makeProject('cli-dry-run');
  fs.writeFileSync(path.join(ctx.worktreePath, 'README.md'), '# cli\n', 'utf8');
  const { result, output } = applyCommand(ctx.root, [ctx.feature, '--dry-run']);
  assert.strictEqual(result.ok, true);
  assert.ok(output.includes('code: dry_run_ready'));
  assert.ok(output.includes('method: patch'));
  assert.ok(output.includes('dry-run'));
});

test('CLI helper는 일반 apply, dry-run, state recovery mode를 상호 배타적으로 검증', () => {
  const ctx = makeProject('cli-exclusive');
  const invalid = applyCommand(ctx.root, [ctx.feature, '--dry-run', '--recover-state']);
  assert.strictEqual(invalid.result.ok, false);
  assert.strictEqual(invalid.result.code, 'invalid_arguments');
  assert.ok(invalid.result.recovery.includes('하나만 선택'));

  const tooManyFeatures = applyCommand(ctx.root, [ctx.feature, 'another-feature']);
  assert.strictEqual(tooManyFeatures.result.code, 'invalid_arguments');

  const recovered = applyCommand(ctx.root, [ctx.feature, '--recover-state']);
  assert.strictEqual(recovered.result.code, 'recovered_noop');
  assert.ok(recovered.output.includes('recovered:'));
});

test('apply skill은 dry-run과 실제 apply를 상호 배타적으로 안내', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'apply', 'SKILL.md'), 'utf8');
  assert.match(skill, /`--dry-run`이 있는 경우/);
  assert.match(skill, /dry-run 명령 하나만 실행하고 skill을 종료/);
  assert.match(skill, /mode 옵션이 없는 경우/);
  assert.match(skill, /`--recover-state`가 있는 경우/);
  assert.match(skill, /실제 적용은 mode 옵션이 없는 별도의 명시 호출에서만 수행/);

  const bashBlocks = [...skill.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]);
  const applyBlocks = bashBlocks.filter((block) => block.includes('node "$SCRIPT_DIR/apply.js" <FEATURE>'));
  assert.strictEqual(applyBlocks.length, 3);
  assert.ok(applyBlocks.some((block) => block.includes('<FEATURE> --dry-run')));
  assert.ok(applyBlocks.some((block) => block.includes('<FEATURE> --recover-state')));
  assert.ok(applyBlocks.some((block) => block.includes('<FEATURE>\n')));
  assert.ok(applyBlocks.every((block) => {
    const commands = block.split('\n').filter((line) => line.startsWith('node "$SCRIPT_DIR/apply.js"'));
    const modes = new Set(commands.map((line) => line.endsWith('--dry-run')
      ? 'dry-run'
      : line.endsWith('--recover-state') ? 'recover-state' : 'apply'));
    return modes.size === 1;
  }), '한 bash 블록에서 dry-run 뒤 실제 apply를 연속 실행하면 안 됨');
});

for (const dir of tmpDirs) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

console.log(`\n총 ${passed + failed}개 중 ${passed}개 통과, ${failed}개 실패\n`);
process.exit(failed > 0 ? 1 : 0);
