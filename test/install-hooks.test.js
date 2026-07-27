#!/usr/bin/env node
/**
 * scripts/install-hooks.js 설치 및 staged sanitize 회귀 테스트.
 */

'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  installHook,
  runStagedSanitize,
  resolveGitHooksDir,
} = require('../scripts/install-hooks');

let passed = 0;
let failed = 0;
const tmpDirs = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.stack || err.message}`);
    failed++;
  }
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'built-hook-test-'));
  tmpDirs.push(root);
  git(root, ['init', '--quiet']);
  git(root, ['config', 'core.hooksPath', '.git/hooks']);
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '..', 'scripts', 'sanitize.js'),
    path.join(root, 'scripts', 'sanitize.js')
  );
  fs.copyFileSync(
    path.join(__dirname, '..', 'scripts', 'install-hooks.js'),
    path.join(root, 'scripts', 'install-hooks.js')
  );
  return root;
}

function git(root, args, opts) {
  const options = opts || {};
  const result = childProcess.spawnSync('git', ['-C', root, ...args], {
    encoding: options.encoding === undefined ? 'utf8' : options.encoding,
    input: options.input,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args[0]} failed`).toString());
  }
  return result.stdout;
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function stagedContent(root, relativePath) {
  return git(root, ['show', `:${relativePath}`]);
}

console.log('\ninstall-hooks staged sanitize');

test('설치된 hook이 runs/features staged artifact와 공백 파일명을 정확히 sanitize', () => {
  const root = makeRepo();
  const files = {
    runs: '.built/runs/feature a/root context.json',
    result: '.built/features/feature a/do result.md',
    progress: '.built/features/feature a/progress.json',
    log: '.built/features/feature a/logs/do log.jsonl',
    clean: '.built/features/feature a/check-result.md',
    outside: 'notes.json',
  };

  writeFile(root, files.runs, '{"token":"runs-secret"}\n');
  writeFile(root, files.result, 'authorization: result-secret\n');
  writeFile(root, files.progress, '{"chat_id":1234567890,"token":false}\n');
  writeFile(root, files.log, '{"token":true,"secret":42}\n');
  writeFile(root, files.clean, '# clean\n');
  writeFile(root, files.outside, '{"token":"outside-secret"}\n');
  git(root, ['add', '--', ...Object.values(files)]);

  const installed = installHook(root);
  assert.strictEqual(installed.installed, true);
  const hookPath = path.join(resolveGitHooksDir(root), 'pre-commit');
  const result = childProcess.spawnSync(hookPath, [], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('4/5 file(s) changed'), result.stdout);

  const forbiddenByPath = {
    [files.runs]: 'runs-secret',
    [files.result]: 'result-secret',
    [files.progress]: '1234567890',
    [files.log]: '"token":true',
  };
  for (const relativePath of [files.runs, files.result, files.progress, files.log]) {
    const staged = stagedContent(root, relativePath);
    const working = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.ok(
      !staged.includes(forbiddenByPath[relativePath]),
      `staged 민감 값 노출: ${relativePath}`
    );
    assert.strictEqual(working, staged, `working tree와 index 불일치: ${relativePath}`);
  }
  const stagedProgress = JSON.parse(stagedContent(root, files.progress));
  assert.strictEqual(stagedProgress.chat_id, '[REDACTED]');
  assert.strictEqual(stagedProgress.token, '[REDACTED]');
  const stagedLog = stagedContent(root, files.log).trim().split('\n').map(line => JSON.parse(line));
  assert.strictEqual(stagedLog[0].token, '[REDACTED]');
  assert.strictEqual(stagedLog[0].secret, '[REDACTED]');
  assert.ok(stagedContent(root, files.outside).includes('outside-secret'));
});

test('부분 stage 파일은 index만 sanitize하고 unstaged 변경은 stage하지 않음', () => {
  const root = makeRepo();
  const relativePath = '.built/features/feature-b/report with spaces.md';
  const filePath = writeFile(root, relativePath, 'token: staged-secret\n');
  git(root, ['add', '--', relativePath]);
  fs.appendFileSync(filePath, 'UNSTAGED_ONLY\n', 'utf8');

  const result = runStagedSanitize(root);

  assert.deepStrictEqual(result.changedFiles, [relativePath]);
  const staged = stagedContent(root, relativePath);
  const working = fs.readFileSync(filePath, 'utf8');
  assert.ok(!staged.includes('staged-secret'));
  assert.ok(!staged.includes('UNSTAGED_ONLY'), 'unstaged 변경이 index에 포함됨');
  assert.ok(working.includes('UNSTAGED_ONLY'), 'unstaged 변경이 working tree에서 사라짐');
});

test('staged 대상이 없으면 index를 변경하지 않음', () => {
  const root = makeRepo();
  writeFile(root, 'src/example.json', '{"token":"not-an-artifact"}\n');
  git(root, ['add', '--', 'src/example.json']);

  const result = runStagedSanitize(root);

  assert.deepStrictEqual(result.stagedFiles, []);
  assert.deepStrictEqual(result.changedFiles, []);
  assert.ok(stagedContent(root, 'src/example.json').includes('not-an-artifact'));
});

for (const dir of tmpDirs) {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('');
console.log(`총 ${passed + failed}개 중 ${passed}개 통과, ${failed}개 실패`);
if (failed > 0) {
  process.exit(1);
}
