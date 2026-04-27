#!/usr/bin/env node
/**
 * standalone phase run-request.json parse contract tests.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

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
    if (process.env.VERBOSE) console.error(e.stack);
    failed++;
  }
}

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'standalone-run-request-test-'));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFeatureSpec(projectRoot, feature) {
  const featuresDir = path.join(projectRoot, '.built', 'features');
  fs.mkdirSync(featuresDir, { recursive: true });
  fs.writeFileSync(path.join(featuresDir, `${feature}.md`), `# ${feature}\n`, 'utf8');
}

function writeRunRequestRaw(projectRoot, feature, raw) {
  const runDir = path.join(projectRoot, '.built', 'runtime', 'runs', feature);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-request.json'), raw, 'utf8');
}

function writeDoResult(projectRoot, feature) {
  const featureDir = path.join(projectRoot, '.built', 'features', feature);
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(path.join(featureDir, 'do-result.md'), '# Do result\n', 'utf8');
}

function writeCheckResult(projectRoot, feature, status) {
  const featureDir = path.join(projectRoot, '.built', 'features', feature);
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(
    path.join(featureDir, 'check-result.md'),
    ['---', `status: ${status}`, '---', '', '## 검토 결과', ''].join('\n'),
    'utf8'
  );
}

function runScript(scriptName, feature, cwd) {
  const scriptPath = path.join(__dirname, '..', 'scripts', scriptName);
  const result = childProcess.spawnSync(process.execPath, [scriptPath, feature], {
    cwd,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { NO_NOTIFY: '1' }),
  });
  return {
    exitCode: result.status === null ? 1 : result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function assertMalformedFails(scriptName, feature, setup) {
  const dir = makeTmpDir();
  try {
    setup(dir, feature);
    writeRunRequestRaw(dir, feature, '{ "providers": { "do": "codex", }');
    const result = runScript(scriptName, feature, dir);
    assert.strictEqual(result.exitCode, 1, `${scriptName} exit 1 예상, stdout: ${result.stdout}, stderr: ${result.stderr}`);
    assert.ok(result.stderr.includes('run-request.json 파싱 실패'), `parse failure 메시지 필요, got: ${result.stderr}`);
    assert.ok(result.stderr.includes(path.join('.built', 'runtime', 'runs', feature, 'run-request.json')) ||
      result.stderr.includes('run-request.json'), `run-request path 필요, got: ${result.stderr}`);
    assert.ok(result.stderr.includes('JSON 형식과 provider 설정'), `공통 안내 필요, got: ${result.stderr}`);
  } finally {
    rmDir(dir);
  }
}

console.log('\n[standalone run-request parse contract]');

test('do: malformed run-request.json은 silent fallback 없이 실패', () => {
  assertMalformedFails('do.js', 'bad-do', (dir, feature) => {
    writeFeatureSpec(dir, feature);
  });
});

test('check: malformed run-request.json은 silent fallback 없이 실패', () => {
  assertMalformedFails('check.js', 'bad-check', (dir, feature) => {
    writeFeatureSpec(dir, feature);
    writeDoResult(dir, feature);
  });
});

test('iter: malformed run-request.json은 approved 상태여도 먼저 실패', () => {
  assertMalformedFails('iter.js', 'bad-iter', (dir, feature) => {
    writeFeatureSpec(dir, feature);
    writeCheckResult(dir, feature, 'approved');
  });
});

test('report: malformed run-request.json은 silent fallback 없이 실패', () => {
  assertMalformedFails('report.js', 'bad-report', (dir, feature) => {
    writeFeatureSpec(dir, feature);
    writeDoResult(dir, feature);
  });
});

test('plan-synthesis: malformed run-request.json은 silent fallback 없이 실패', () => {
  assertMalformedFails('plan-synthesis.js', 'bad-plan', () => {});
});

test('iter: missing run-request.json은 기존 허용 fallback을 유지', () => {
  const dir = makeTmpDir();
  try {
    const feature = 'missing-iter';
    writeFeatureSpec(dir, feature);
    writeCheckResult(dir, feature, 'approved');
    const result = runScript('iter.js', feature, dir);
    assert.strictEqual(result.exitCode, 0, `exit 0 예상, stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('이미 승인됨'), `approved fallback 메시지 필요, got: ${result.stdout}`);
  } finally {
    rmDir(dir);
  }
});

console.log(`\n[standalone-run-request.test] ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
