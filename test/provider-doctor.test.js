#!/usr/bin/env node
/**
 * test/provider-doctor.test.js
 *
 * src/providers/doctor.js 단위 테스트.
 * 실제 Codex CLI 없이 checkAvailability/checkLogin을 spawnSync mock으로 대체해 동작을 검증한다.
 *
 * 검증 항목:
 *   - checkCodexInstall: 바이너리 없음(fail), app-server 미지원(ok/별도 항목 처리), 정상(ok)
 *   - checkAppServerSupport: app-server 미지원(fail), CLI 없음(fail), 정상(ok)
 *   - checkCodexAuth: CLI 없음(fail), 미인증(fail), 인증됨(ok)
 *   - checkBrokerState: session 없음(ok), stale pid(warn), pid 살아있고 소켓 있음(ok)
 *   - checkBrokerLock: lock 없음(ok), stale lock(warn), 파싱 실패(warn)
 *   - checkRunRequestConfig: featureId 없음(빈 배열), run-request 없음(warn), 파싱 오류(fail), 정상(ok), 설정 오류(fail)
 *   - checkRegistry: 비어있음(ok), running feature(warn)
 *   - runDoctorChecks: 통합 점검 결과 구조 검증
 *
 * 외부 npm 패키지 없음. Node.js assert + fs + path + os만 사용.
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const {
  runDoctorChecks,
  checkCodexInstall,
  checkAppServerSupport,
  checkCodexAuth,
  checkBrokerState,
  checkBrokerLock,
  checkRunRequestConfig,
  checkRootSeparation,
  checkRegistry,
} = require('../src/providers/doctor');

// ---------------------------------------------------------------------------
// 테스트 러너
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    if (e.stack) console.error(e.stack.split('\n').slice(1, 3).join('\n'));
    failed++;
  }
}

// ---------------------------------------------------------------------------
// spawnSync mock 헬퍼
// ---------------------------------------------------------------------------

/**
 * 정상 Codex 환경을 흉내내는 spawnSync mock.
 */
function makeSpawnSync({ version = '0 ok', appServerStatus = 0, loginStatus = 0 } = {}) {
  return function spawnSync(cmd, cmdArgs, _opts) {
    if (cmd !== 'codex') return { status: 127, error: { code: 'ENOENT', message: 'not found' } };
    if (cmdArgs[0] === '--version') {
      return { status: 0, stdout: version, stderr: '' };
    }
    if (cmdArgs[0] === 'app-server' && cmdArgs[1] === '--help') {
      return { status: appServerStatus, stdout: 'help', stderr: '' };
    }
    if (cmdArgs[0] === 'login' && cmdArgs[1] === 'status') {
      return { status: loginStatus, stdout: loginStatus === 0 ? 'authenticated' : '', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
}

/**
 * CLI 미설치 환경 mock.
 */
function makeSpawnSyncMissing() {
  return function spawnSync(_cmd, _args, _opts) {
    return { status: 1, error: { code: 'ENOENT', message: 'not found' } };
  };
}

/**
 * app-server 미지원 환경 mock (CLI는 있지만 app-server --help 실패).
 */
function makeSpawnSyncNoAppServer() {
  return function spawnSync(cmd, cmdArgs, _opts) {
    if (cmd !== 'codex') return { status: 127, error: { code: 'ENOENT', message: 'not found' } };
    if (cmdArgs[0] === '--version') {
      return { status: 0, stdout: '0.9.0', stderr: '' };
    }
    if (cmdArgs[0] === 'app-server') {
      return { status: 1, stdout: '', stderr: 'unknown command' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
}

// ---------------------------------------------------------------------------
// 임시 디렉토리 유틸
// ---------------------------------------------------------------------------

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'built-doctor-test-'));
}

function cleanupDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

// ---------------------------------------------------------------------------
// checkCodexInstall 테스트
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n[provider-doctor] checkCodexInstall');

  await test('CLI 미설치 → fail', () => {
    const r = checkCodexInstall('/tmp', { _spawnSyncFn: makeSpawnSyncMissing() });
    assert.strictEqual(r.status, 'fail');
    assert.strictEqual(r.id, 'codex_install');
    assert.ok(r.action, 'action이 있어야 함');
  });

  await test('app-server 미지원(CLI는 설치됨) → ok (install 점검에서는 ok)', () => {
    const r = checkCodexInstall('/tmp', { _spawnSyncFn: makeSpawnSyncNoAppServer() });
    assert.strictEqual(r.status, 'ok');
    assert.strictEqual(r.id, 'codex_install');
  });

  await test('정상 설치 → ok', () => {
    const r = checkCodexInstall('/tmp', { _spawnSyncFn: makeSpawnSync() });
    assert.strictEqual(r.status, 'ok');
    assert.ok(r.message.includes('설치됨'));
  });

  // ---------------------------------------------------------------------------
  console.log('\n[provider-doctor] checkAppServerSupport');

  await test('CLI 미설치 → fail', () => {
    const r = checkAppServerSupport('/tmp', { _spawnSyncFn: makeSpawnSyncMissing() });
    assert.strictEqual(r.status, 'fail');
    assert.strictEqual(r.id, 'codex_app_server');
  });

  await test('app-server 미지원 → fail', () => {
    const r = checkAppServerSupport('/tmp', { _spawnSyncFn: makeSpawnSyncNoAppServer() });
    assert.strictEqual(r.status, 'fail');
    assert.ok(r.action, 'action이 있어야 함');
  });

  await test('app-server 지원됨 → ok', () => {
    const r = checkAppServerSupport('/tmp', { _spawnSyncFn: makeSpawnSync() });
    assert.strictEqual(r.status, 'ok');
  });

  // ---------------------------------------------------------------------------
  console.log('\n[provider-doctor] checkCodexAuth');

  await test('CLI 미설치 → fail', () => {
    const r = checkCodexAuth('/tmp', { _spawnSyncFn: makeSpawnSyncMissing() });
    assert.strictEqual(r.status, 'fail');
    assert.strictEqual(r.id, 'codex_auth');
  });

  await test('미인증 → fail', () => {
    const r = checkCodexAuth('/tmp', { _spawnSyncFn: makeSpawnSync({ loginStatus: 1 }) });
    assert.strictEqual(r.status, 'fail');
    assert.ok(r.action, 'action이 있어야 함');
  });

  await test('인증됨 → ok', () => {
    const r = checkCodexAuth('/tmp', { _spawnSyncFn: makeSpawnSync() });
    assert.strictEqual(r.status, 'ok');
    assert.ok(r.message.includes('인증됨'));
  });

  // ---------------------------------------------------------------------------
  console.log('\n[provider-doctor] checkBrokerState');

  await test('broker session 없음 → ok', () => {
    const tmpDir = mkTmpDir();
    try {
      const results = checkBrokerState(tmpDir);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].status, 'ok');
      assert.ok(results[0].message.includes('없습니다'));
    } finally {
      cleanupDir(tmpDir);
    }
  });

  await test('stale pid broker session → warn', () => {
    const tmpDir = mkTmpDir();
    try {
      const runtimeDir = path.join(tmpDir, '.built', 'runtime');
      fs.mkdirSync(runtimeDir, { recursive: true });
      // 존재할 수 없는 pid (999999999) 사용
      const session = { endpoint: 'unix:/tmp/fake.sock', pid: 999999999, startedAt: new Date().toISOString() };
      fs.writeFileSync(path.join(runtimeDir, 'codex-broker.json'), JSON.stringify(session), 'utf8');

      const results = checkBrokerState(tmpDir);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].status, 'warn');
      assert.ok(results[0].message.includes('Stale broker'));
    } finally {
      cleanupDir(tmpDir);
    }
  });

  // ---------------------------------------------------------------------------
  console.log('\n[provider-doctor] checkBrokerLock');

  await test('lock 없음 → ok', () => {
    const tmpDir = mkTmpDir();
    try {
      const r = checkBrokerLock(tmpDir);
      assert.strictEqual(r.status, 'ok');
    } finally {
      cleanupDir(tmpDir);
    }
  });

  await test('파싱 불가 lock 파일 → warn', () => {
    const tmpDir = mkTmpDir();
    try {
      const runtimeDir = path.join(tmpDir, '.built', 'runtime');
      fs.mkdirSync(runtimeDir, { recursive: true });
      fs.writeFileSync(path.join(runtimeDir, 'codex-broker.lock'), 'INVALID_JSON', 'utf8');
      const r = checkBrokerLock(tmpDir);
      assert.strictEqual(r.status, 'warn');
    } finally {
      cleanupDir(tmpDir);
    }
  });

  await test('stale pid lock → warn', () => {
    const tmpDir = mkTmpDir();
    try {
      const runtimeDir = path.join(tmpDir, '.built', 'runtime');
      fs.mkdirSync(runtimeDir, { recursive: true });
      const lock = { pid: 999999999, created_at: new Date().toISOString(), created_ms: Date.now() };
      fs.writeFileSync(path.join(runtimeDir, 'codex-broker.lock'), JSON.stringify(lock), 'utf8');
      const r = checkBrokerLock(tmpDir);
      assert.strictEqual(r.status, 'warn');
      assert.ok(r.message.includes('stale'));
    } finally {
      cleanupDir(tmpDir);
    }
  });

  await test('시간 초과 lock → warn', () => {
    const tmpDir = mkTmpDir();
    try {
      const runtimeDir = path.join(tmpDir, '.built', 'runtime');
      fs.mkdirSync(runtimeDir, { recursive: true });
      // 1분 전 timestamp, 살아있을 수 없는 pid
      const oldMs = Date.now() - 60000;
      const lock = { pid: 1, created_at: new Date(oldMs).toISOString(), created_ms: oldMs };
      fs.writeFileSync(path.join(runtimeDir, 'codex-broker.lock'), JSON.stringify(lock), 'utf8');
      const r = checkBrokerLock(tmpDir);
      assert.strictEqual(r.status, 'warn');
    } finally {
      cleanupDir(tmpDir);
    }
  });

  // ---------------------------------------------------------------------------
  console.log('\n[provider-doctor] checkRunRequestConfig');

  await test('featureId 없음 → 빈 배열', () => {
    const results = checkRunRequestConfig('/tmp', null);
    assert.strictEqual(results.length, 0);
  });

  await test('run-request.json 없음 → warn', () => {
    const tmpDir = mkTmpDir();
    try {
      const results = checkRunRequestConfig(tmpDir, 'my-feature');
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].status, 'warn');
    } finally {
      cleanupDir(tmpDir);
    }
  });

  await test('run-request.json JSON 파싱 오류 → fail', () => {
    const tmpDir = mkTmpDir();
    try {
      const runDir = path.join(tmpDir, '.built', 'runtime', 'runs', 'bad-feature');
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'run-request.json'), 'NOT_JSON', 'utf8');
      const results = checkRunRequestConfig(tmpDir, 'bad-feature');
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].status, 'fail');
    } finally {
      cleanupDir(tmpDir);
    }
  });

  await test('run-request.json providers 없음 → ok (기본값)', () => {
    const tmpDir = mkTmpDir();
    try {
      const runDir = path.join(tmpDir, '.built', 'runtime', 'runs', 'no-providers');
      fs.mkdirSync(runDir, { recursive: true });
      const req = { featureId: 'no-providers', planPath: '.built/features/no-providers.md', createdAt: new Date().toISOString() };
      fs.writeFileSync(path.join(runDir, 'run-request.json'), JSON.stringify(req), 'utf8');
      const results = checkRunRequestConfig(tmpDir, 'no-providers');
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].status, 'ok');
      assert.ok(results[0].message.includes('기본값'));
    } finally {
      cleanupDir(tmpDir);
    }
  });

  await test('run-request.json 유효한 providers → ok (phase별 결과)', () => {
    const tmpDir = mkTmpDir();
    try {
      const featureId = 'valid-feature';
      const runDir = path.join(tmpDir, '.built', 'runtime', 'runs', featureId);
      fs.mkdirSync(runDir, { recursive: true });
      const req = {
        featureId,
        planPath: `.built/features/${featureId}.md`,
        createdAt: new Date().toISOString(),
        providers: {
          do: { name: 'codex', sandbox: 'workspace-write', timeout_ms: 1800000 },
          check: 'claude',
        },
      };
      fs.writeFileSync(path.join(runDir, 'run-request.json'), JSON.stringify(req), 'utf8');
      const results = checkRunRequestConfig(tmpDir, featureId);
      assert.ok(results.length >= 2);
      assert.ok(results.every((r) => r.status === 'ok'));
      const doResult = results.find((r) => r.id.includes('_do'));
      assert.ok(doResult, 'do phase 결과가 있어야 함');
      assert.ok(doResult.message.includes('codex'));
      assert.ok(doResult.message.includes('workspace-write'));
    } finally {
      cleanupDir(tmpDir);
    }
  });

  await test('run-request.json 잘못된 provider 이름 → fail', () => {
    const tmpDir = mkTmpDir();
    try {
      const featureId = 'bad-provider';
      const runDir = path.join(tmpDir, '.built', 'runtime', 'runs', featureId);
      fs.mkdirSync(runDir, { recursive: true });
      const req = {
        featureId,
        providers: { do: 'gpt4' },
      };
      fs.writeFileSync(path.join(runDir, 'run-request.json'), JSON.stringify(req), 'utf8');
      const results = checkRunRequestConfig(tmpDir, featureId);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].status, 'fail');
    } finally {
      cleanupDir(tmpDir);
    }
  });

  await test('run-request.json sandbox 설정 오류 (do phase + read-only) → fail', () => {
    const tmpDir = mkTmpDir();
    try {
      const featureId = 'bad-sandbox';
      const runDir = path.join(tmpDir, '.built', 'runtime', 'runs', featureId);
      fs.mkdirSync(runDir, { recursive: true });
      const req = {
        featureId,
        providers: { do: { name: 'codex', sandbox: 'read-only' } },
      };
      fs.writeFileSync(path.join(runDir, 'run-request.json'), JSON.stringify(req), 'utf8');
      const results = checkRunRequestConfig(tmpDir, featureId);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].status, 'fail');
      assert.ok(results[0].message.includes('workspace-write'));
    } finally {
      cleanupDir(tmpDir);
    }
  });

  // ---------------------------------------------------------------------------
  console.log('\n[provider-doctor] checkRegistry');

  await test('registry 없음 → ok', () => {
    const tmpDir = mkTmpDir();
    try {
      const r = checkRegistry(tmpDir);
      assert.strictEqual(r.status, 'ok');
    } finally {
      cleanupDir(tmpDir);
    }
  });

  await test('running feature 있음 → warn', () => {
    const tmpDir = mkTmpDir();
    try {
      const runtimeDir = path.join(tmpDir, '.built', 'runtime');
      fs.mkdirSync(runtimeDir, { recursive: true });
      const registry = {
        version: 1,
        features: {
          'my-feature': { featureId: 'my-feature', status: 'running', startedAt: new Date().toISOString(), worktreePath: null, pid: null },
        },
      };
      fs.writeFileSync(path.join(runtimeDir, 'registry.json'), JSON.stringify(registry), 'utf8');
      const r = checkRegistry(tmpDir);
      assert.strictEqual(r.status, 'warn');
      assert.ok(r.message.includes('my-feature'));
    } finally {
      cleanupDir(tmpDir);
    }
  });

  await test('completed feature만 있음 → ok', () => {
    const tmpDir = mkTmpDir();
    try {
      const runtimeDir = path.join(tmpDir, '.built', 'runtime');
      fs.mkdirSync(runtimeDir, { recursive: true });
      const registry = {
        version: 1,
        features: {
          'done-feature': { featureId: 'done-feature', status: 'completed', startedAt: new Date().toISOString(), worktreePath: null, pid: null },
        },
      };
      fs.writeFileSync(path.join(runtimeDir, 'registry.json'), JSON.stringify(registry), 'utf8');
      const r = checkRegistry(tmpDir);
      assert.strictEqual(r.status, 'ok');
    } finally {
      cleanupDir(tmpDir);
    }
  });

  // ---------------------------------------------------------------------------
  console.log('\n[provider-doctor] checkRootSeparation');

  await test('feature 지정 + plugin root cwd + target spec 없음 → fail', () => {
    const tmpDir = mkTmpDir();
    try {
      fs.mkdirSync(path.join(tmpDir, '.claude-plugin'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'scripts'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'skills'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.claude-plugin', 'plugin.json'), '{"name":"built"}', 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"built"}', 'utf8');
      const r = checkRootSeparation(tmpDir, 'missing-feature');
      assert.strictEqual(r.status, 'fail');
      assert.strictEqual(r.id, 'root_separation');
      assert.ok(r.message.includes('target feature spec'));
    } finally {
      cleanupDir(tmpDir);
    }
  });

  await test('target project feature spec 존재 → ok', () => {
    const tmpDir = mkTmpDir();
    try {
      const feature = 'target-feature';
      const featuresDir = path.join(tmpDir, '.built', 'features');
      fs.mkdirSync(featuresDir, { recursive: true });
      fs.writeFileSync(path.join(featuresDir, `${feature}.md`), '# spec\n', 'utf8');
      const r = checkRootSeparation(tmpDir, feature);
      assert.strictEqual(r.status, 'ok');
    } finally {
      cleanupDir(tmpDir);
    }
  });

  // ---------------------------------------------------------------------------
  console.log('\n[provider-doctor] runDoctorChecks (통합)');

  await test('정상 환경 → overall ok, 각 항목 id 포함', () => {
    const tmpDir = mkTmpDir();
    try {
      const checks = runDoctorChecks({
        cwd: tmpDir,
        _spawnSyncFn: makeSpawnSync(),
      });
      assert.ok(Array.isArray(checks));
      assert.ok(checks.length >= 5, '최소 5개 점검 항목');
      const ids = checks.map((c) => c.id);
      assert.ok(ids.includes('codex_install'), 'codex_install 항목 포함');
      assert.ok(ids.includes('codex_app_server'), 'codex_app_server 항목 포함');
      assert.ok(ids.includes('codex_auth'), 'codex_auth 항목 포함');
      assert.ok(ids.includes('broker_state'), 'broker_state 항목 포함');
      assert.ok(ids.includes('broker_lock'), 'broker_lock 항목 포함');
      assert.ok(ids.includes('root_separation'), 'root_separation 항목 포함');
      assert.ok(ids.includes('registry'), 'registry 항목 포함');

      const overall = checks.some((c) => c.status === 'fail') ? 'fail'
        : checks.some((c) => c.status === 'warn') ? 'warn'
        : 'ok';
      assert.strictEqual(overall, 'ok');
    } finally {
      cleanupDir(tmpDir);
    }
  });

  await test('CLI 미설치 → fail 항목 포함', () => {
    const tmpDir = mkTmpDir();
    try {
      const checks = runDoctorChecks({
        cwd: tmpDir,
        _spawnSyncFn: makeSpawnSyncMissing(),
      });
      assert.ok(checks.some((c) => c.status === 'fail'));
      const installCheck = checks.find((c) => c.id === 'codex_install');
      assert.ok(installCheck, 'codex_install 항목 존재');
      assert.strictEqual(installCheck.status, 'fail');
    } finally {
      cleanupDir(tmpDir);
    }
  });

  await test('featureId 지정 → run_request_config 항목 포함', () => {
    const tmpDir = mkTmpDir();
    try {
      const checks = runDoctorChecks({
        cwd: tmpDir,
        featureId: 'test-feature',
        _spawnSyncFn: makeSpawnSync(),
      });
      const configCheck = checks.find((c) => c.id.startsWith('run_request_config'));
      assert.ok(configCheck, 'run_request_config 항목이 있어야 함');
    } finally {
      cleanupDir(tmpDir);
    }
  });

  await test('모든 CheckResult에 id, status, label, message 필드 존재', () => {
    const tmpDir = mkTmpDir();
    try {
      const checks = runDoctorChecks({
        cwd: tmpDir,
        _spawnSyncFn: makeSpawnSync(),
      });
      for (const c of checks) {
        assert.ok(typeof c.id === 'string' && c.id.length > 0, `${c.id}: id 필드`);
        assert.ok(['ok', 'warn', 'fail'].includes(c.status), `${c.id}: status 유효값`);
        assert.ok(typeof c.label === 'string' && c.label.length > 0, `${c.id}: label 필드`);
        assert.ok(typeof c.message === 'string' && c.message.length > 0, `${c.id}: message 필드`);
      }
    } finally {
      cleanupDir(tmpDir);
    }
  });

  // ---------------------------------------------------------------------------
  // 결과
  // ---------------------------------------------------------------------------

  console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
