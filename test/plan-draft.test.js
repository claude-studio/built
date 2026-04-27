#!/usr/bin/env node
/**
 * test/plan-draft.test.js
 *
 * plan-draft.js target project root 회귀 테스트.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const planDraft = require('../scripts/plan-draft');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n[plan-draft]');

test('plugin 외부 target cwd에 plan draft를 저장한다', () => {
  const targetRoot = makeTmpDir('plan-draft-target-');
  const pluginRoot = path.resolve(__dirname, '..');
  const previousCwd = process.cwd();
  const feature = `target-feature-${process.pid}`;

  try {
    process.chdir(targetRoot);
    planDraft.write(feature, 'draft from target cwd\n');

    const targetPath = path.join(targetRoot, '.built', 'runs', feature, 'plan-draft.md');
    const rootContextPath = path.join(targetRoot, '.built', 'runs', feature, 'root-context.json');
    const pluginPath = path.join(pluginRoot, '.built', 'runs', feature, 'plan-draft.md');

    assert.strictEqual(fs.readFileSync(targetPath, 'utf8'), 'draft from target cwd\n');
    const rootContext = JSON.parse(fs.readFileSync(rootContextPath, 'utf8'));
    assert.strictEqual(rootContext.phase, 'plan');
    assert.strictEqual(fs.realpathSync(rootContext.project_root), fs.realpathSync(targetRoot));
    assert.strictEqual(
      fs.realpathSync(rootContext.artifact_paths.plan_draft),
      fs.realpathSync(targetPath),
    );
    assert.strictEqual(fs.existsSync(pluginPath), false, 'plugin repo root에 draft가 생기면 안 됨');
    assert.strictEqual(planDraft.read(feature), 'draft from target cwd\n');
  } finally {
    process.chdir(previousCwd);
    rmDir(targetRoot);
  }
});

test('명시 projectRoot 옵션이 cwd보다 우선한다', () => {
  const cwdRoot = makeTmpDir('plan-draft-cwd-');
  const targetRoot = makeTmpDir('plan-draft-explicit-');
  const previousCwd = process.cwd();
  const feature = `explicit-feature-${process.pid}`;

  try {
    process.chdir(cwdRoot);
    planDraft.write(feature, 'draft from explicit root\n', { projectRoot: targetRoot });

    const cwdPath = path.join(cwdRoot, '.built', 'runs', feature, 'plan-draft.md');
    const targetPath = path.join(targetRoot, '.built', 'runs', feature, 'plan-draft.md');

    assert.strictEqual(fs.existsSync(cwdPath), false, 'cwd root에 draft가 생기면 안 됨');
    assert.strictEqual(fs.readFileSync(targetPath, 'utf8'), 'draft from explicit root\n');
    assert.ok(fs.existsSync(path.join(targetRoot, '.built', 'runs', feature, 'root-context.json')));
    assert.strictEqual(planDraft.exists(feature, targetRoot), true);
  } finally {
    process.chdir(previousCwd);
    rmDir(cwdRoot);
    rmDir(targetRoot);
  }
});

test('remove가 plan draft root-context artifact도 삭제한다', () => {
  const targetRoot = makeTmpDir('plan-draft-remove-');
  const feature = `remove-feature-${process.pid}`;

  try {
    planDraft.write(feature, 'draft\n', { projectRoot: targetRoot });
    const ctxPath = planDraft.rootContextPath(feature, { projectRoot: targetRoot });
    assert.strictEqual(fs.existsSync(ctxPath), true, 'root-context.json이 있어야 함');
    planDraft.remove(feature, { projectRoot: targetRoot });
    assert.strictEqual(fs.existsSync(planDraft.draftPath(feature, { projectRoot: targetRoot })), false);
    assert.strictEqual(fs.existsSync(ctxPath), false, 'root-context.json도 삭제되어야 함');
  } finally {
    rmDir(targetRoot);
  }
});

test('argv --project-root가 cwd보다 우선한다', () => {
  const cwdRoot = makeTmpDir('plan-draft-argv-cwd-');
  const targetRoot = makeTmpDir('plan-draft-argv-target-');
  const previousCwd = process.cwd();
  const previousArgv = process.argv.slice();
  const feature = `argv-feature-${process.pid}`;

  try {
    process.chdir(cwdRoot);
    process.argv = [process.argv[0], '--project-root', targetRoot];
    planDraft.write(feature, 'draft from argv root\n');

    const cwdPath = path.join(cwdRoot, '.built', 'runs', feature, 'plan-draft.md');
    const targetPath = path.join(targetRoot, '.built', 'runs', feature, 'plan-draft.md');

    assert.strictEqual(fs.existsSync(cwdPath), false, 'cwd root에 draft가 생기면 안 됨');
    assert.strictEqual(fs.readFileSync(targetPath, 'utf8'), 'draft from argv root\n');
    assert.strictEqual(planDraft.exists(feature), true);
  } finally {
    process.argv = previousArgv;
    process.chdir(previousCwd);
    rmDir(cwdRoot);
    rmDir(targetRoot);
  }
});

if (failed > 0) {
  console.error(`\n[plan-draft] ${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`[plan-draft] ${passed} passed, ${failed} failed`);
