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

for (const dir of tmpDirs) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

console.log(`\n총 ${passed + failed}개 중 ${passed}개 통과, ${failed}개 실패\n`);
process.exit(failed > 0 ? 1 : 0);
