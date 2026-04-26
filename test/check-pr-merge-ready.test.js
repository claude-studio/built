#!/usr/bin/env node
/**
 * test/check-pr-merge-ready.test.js
 *
 * scripts/check-pr-merge-ready.js의 BUI 중복 PR gate 단위 테스트.
 */

'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check-pr-merge-ready.js');

let passed = 0;
let failed = 0;
let tmpDirs = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'built-check-pr-test-'));
  tmpDirs.push(dir);
  return dir;
}

function cleanupTmp() {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  tmpDirs = [];
}

function test(name, fn) {
  try {
    fn();
    console.log(`  [pass] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    failed++;
  } finally {
    cleanupTmp();
  }
}

function makeFakeBin(mode) {
  const dir = makeTmpDir();
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  const ghPath = path.join(binDir, 'gh');
  fs.writeFileSync(ghPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
const mode = process.env.FAKE_GH_LIST_MODE || 'one';
if (args[0] === 'pr' && args[1] === 'view') {
  console.log(JSON.stringify({
    number: 12,
    title: '[BUI-186] 중복 PR 방지',
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    headRefName: 'agent/builder/BUI-186-pr-policy',
    headRefOid: 'abc123',
    baseRefName: 'main',
    baseRefOid: 'def456',
    reviewDecision: 'APPROVED',
    reviews: [{ state: 'APPROVED', author: { login: 'reviewer' } }],
    statusCheckRollup: [],
    url: 'https://github.com/claude-studio/built/pull/12'
  }));
  process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'list') {
  if (mode === 'duplicate') {
    console.log(JSON.stringify([
      { number: 12, title: '[BUI-186] 중복 PR 방지', headRefName: 'agent/builder/BUI-186-pr-policy', url: 'https://github.com/claude-studio/built/pull/12', createdAt: '2026-04-26T00:00:00Z' },
      { number: 13, title: '[BUI-186] 다른 PR', headRefName: 'agent/builder/BUI-186-other', url: 'https://github.com/claude-studio/built/pull/13', createdAt: '2026-04-26T00:01:00Z' }
    ]));
  } else if (mode === 'none') {
    console.log(JSON.stringify([]));
  } else {
    console.log(JSON.stringify([
      { number: 12, title: '[BUI-186] 중복 PR 방지', headRefName: 'agent/builder/BUI-186-pr-policy', url: 'https://github.com/claude-studio/built/pull/12', createdAt: '2026-04-26T00:00:00Z' }
    ]));
  }
  process.exit(0);
}
console.error('unexpected gh args: ' + args.join(' '));
process.exit(1);
`, 'utf8');
  fs.chmodSync(ghPath, 0o755);

  const gitPath = path.join(binDir, 'git');
  fs.writeFileSync(gitPath, `#!/usr/bin/env node
process.exit(0);
`, 'utf8');
  fs.chmodSync(gitPath, 0o755);

  return { binDir, env: { FAKE_GH_LIST_MODE: mode } };
}

function runCheck(mode) {
  const { binDir, env } = makeFakeBin(mode);
  const result = childProcess.spawnSync(process.execPath, [
    SCRIPT,
    '--pr',
    '12',
    '--issue',
    'BUI-186',
    '--json',
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    env: Object.assign({}, process.env, env, {
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    }),
  });
  const output = result.stdout.trim();
  return {
    status: result.status,
    stderr: result.stderr,
    json: output ? JSON.parse(output) : null,
  };
}

console.log('\ncheck-pr-merge-ready duplicate PR gate');

test('같은 BUI 번호의 open PR이 하나면 MERGE_OK로 통과한다', () => {
  const result = runCheck('one');
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.json.verdict, 'MERGE_OK');
  assert.strictEqual(result.json.gates.G1.status, 'PASS');
  assert.strictEqual(result.json.gates.G2.status, 'PASS');
});

test('같은 BUI 번호의 open PR이 여러 개이면 COORDINATOR로 차단한다', () => {
  const result = runCheck('duplicate');
  assert.strictEqual(result.status, 4, result.stderr);
  assert.strictEqual(result.json.verdict, 'COORDINATOR');
  assert.strictEqual(result.json.gates.G2.status, 'FAIL');
  assert.ok(result.json.gates.G2.detail.includes('open PR 2개'));
});

test('PR 제목에서 BUI 번호를 찾지 못하면 COORDINATOR로 차단한다', () => {
  const result = runCheck('none');
  assert.strictEqual(result.status, 4, result.stderr);
  assert.strictEqual(result.json.verdict, 'COORDINATOR');
  assert.strictEqual(result.json.gates.G2.status, 'FAIL');
  assert.ok(result.json.messages.some((message) => message.includes('canonical PR 판단')));
});

console.log(`\n결과: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
