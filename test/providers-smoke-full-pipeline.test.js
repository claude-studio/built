#!/usr/bin/env node
/**
 * full lifecycle real-provider smoke의 offline contract test.
 * 실제 Claude/Codex 호출은 하지 않는다.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DEFAULT_PHASE_TIMEOUT_MS,
  buildProfileRunRequest,
  classifyPipelineFailure,
  createLifecycleSummary,
  ensureWithin,
  preflightProvider,
  resolveProfile,
  runSmoke,
} = require('../scripts/smoke-full-pipeline');
const { saveSummary } = require('../scripts/smoke-artifact');

let passed = 0;
let failed = 0;
const tmpDirs = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'built-full-pipeline-test-'));
  tmpDirs.push(dir);
  return dir;
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

function readOnlySummary(root) {
  const smokeRoot = path.join(root, '.built', 'runtime', 'smoke');
  const ids = fs.readdirSync(smokeRoot);
  assert.strictEqual(ids.length, 1, `summary 디렉토리 수 불일치: ${ids.length}`);
  return JSON.parse(fs.readFileSync(path.join(smokeRoot, ids[0], 'summary.json'), 'utf8'));
}

console.log('\nprofile contract');

test('profile 기본값은 Claude', () => {
  assert.strictEqual(resolveProfile(undefined), 'claude');
  assert.strictEqual(resolveProfile(' CLAUDE '), 'claude');
  assert.strictEqual(resolveProfile('codex'), 'codex');
});

test('알 수 없는 profile은 실패', () => {
  assert.throws(() => resolveProfile('other'), /claude 또는 codex/);
});

test('Claude profile은 기본 routing을 유지하면서 plan_synthesis를 활성화', () => {
  const req = buildProfileRunRequest('claude');
  assert.strictEqual(req.plan_synthesis, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(req, 'providers'));
  assert.deepStrictEqual(req.verification.commands, ['npm test']);
  assert.ok(req.acceptance_criteria.length >= 4);
});

test('Codex profile은 phase별 sandbox 정책을 고정', () => {
  const req = buildProfileRunRequest('codex');
  assert.strictEqual(req.plan_synthesis, true);
  assert.strictEqual(req.model, 'gpt-5.5');
  assert.strictEqual(req.providers.plan_synthesis.sandbox, 'read-only');
  assert.strictEqual(req.providers.do.sandbox, 'workspace-write');
  assert.strictEqual(req.providers.check.sandbox, 'read-only');
  assert.strictEqual(req.providers.iter.sandbox, 'workspace-write');
  assert.strictEqual(req.providers.report.sandbox, 'read-only');
  for (const spec of Object.values(req.providers)) {
    assert.strictEqual(spec.name, 'codex');
    assert.strictEqual(spec.timeout_ms, DEFAULT_PHASE_TIMEOUT_MS);
  }
});

test('Claude preflight는 auth status 미로그인을 auth로 분류', () => {
  const commandRunner = (_command, args) => {
    if (args[0] === '--version') return { status: 0, stdout: '2.1.81' };
    return { status: 1, stdout: '{"loggedIn":false}' };
  };
  assert.throws(
    () => preflightProvider('claude', '/tmp', { commandRunner }),
    (err) => err.kind === 'auth' && err.stage === 'preflight'
  );
});

test('Claude preflight는 설치와 인증 성공을 구분', () => {
  const commandRunner = (_command, args) => {
    if (args[0] === '--version') return { status: 0, stdout: '2.1.81' };
    return { status: 0, stdout: '{"loggedIn":true,"authMethod":"oauth"}' };
  };
  assert.deepStrictEqual(
    preflightProvider('claude', '/tmp', { commandRunner }),
    { version: '2.1.81' }
  );
});

test('sandbox 경계는 symlink가 아닌 canonical path 기준으로 판정', () => {
  const root = makeTmpDir();
  const realRoot = path.join(root, 'real-target');
  const child = path.join(realRoot, 'worktree');
  const linkedRoot = path.join(root, 'linked-target');
  fs.mkdirSync(child, { recursive: true });
  fs.symlinkSync(realRoot, linkedRoot, 'dir');
  assert.strictEqual(ensureWithin(linkedRoot, child, 'worktree'), fs.realpathSync(child));
});

console.log('\nskip contract');

test('opt-in이 없으면 provider 호출 없이 skip summary를 저장하고 성공', () => {
  const root = makeTmpDir();
  const logs = [];
  const code = runSmoke({
    env: {},
    artifactRoot: root,
    logger: {
      log(message) { logs.push(message); },
      error(message) { logs.push(message); },
    },
  });
  assert.strictEqual(code, 0);
  assert.ok(logs.some((line) => line.includes('skip')));
  const summary = readOnlySummary(root);
  assert.strictEqual(summary.provider, 'claude');
  assert.strictEqual(summary.phase, 'full_lifecycle');
  assert.strictEqual(summary.skipped, true);
  assert.strictEqual(summary.success, true);
  assert.strictEqual(summary.failure, null);
});

console.log('\nfailure taxonomy');

test('signal 또는 null status 후보는 timeout으로 분류', () => {
  assert.strictEqual(classifyPipelineFailure({ signal: 'SIGTERM' }), 'timeout');
});

test('spawn ENOENT는 provider_unavailable로 분류', () => {
  assert.strictEqual(
    classifyPipelineFailure({ error: { code: 'ENOENT' } }),
    'provider_unavailable'
  );
});

test('state.json last_failure의 표준 taxonomy를 재사용', () => {
  for (const kind of ['provider_unavailable', 'app_server', 'auth', 'sandbox', 'timeout', 'model_response']) {
    assert.strictEqual(
      classifyPipelineFailure({ state: { last_failure: { kind } } }),
      kind
    );
  }
});

test('미분류 pipeline 종료는 model_response로 수렴', () => {
  assert.strictEqual(classifyPipelineFailure({ state: { status: 'failed' } }), 'model_response');
});

console.log('\naggregate artifact redaction');

test('aggregate verification에서도 secret, 홈 경로, workspace UUID를 redaction', () => {
  const root = makeTmpDir();
  const workspaceId = '11111111-2222-4333-8444-555555555555';
  const token = 'sk-proj-' + 'x'.repeat(30);
  const summary = createLifecycleSummary({
    provider: 'codex',
    model: 'gpt-5.5',
    duration_ms: 1234,
    skipped: false,
    success: true,
    verification: {
      implementation_changed: true,
      private_path: `/Users/alice/multica_workspaces/${workspaceId}/daemon/session`,
      token,
    },
  });
  const filePath = saveSummary(root, summary);
  const saved = fs.readFileSync(filePath, 'utf8');
  assert.ok(!saved.includes(token), 'token이 남았습니다.');
  assert.ok(!saved.includes(workspaceId), 'workspace UUID가 남았습니다.');
  assert.ok(!saved.includes('/Users/alice'), '홈 경로가 남았습니다.');
  assert.ok(saved.includes('[REDACTED]'));
  assert.ok(saved.includes('[REDACTED_WORKSPACE]'));
});

for (const dir of tmpDirs) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

console.log('');
console.log(`총 ${passed + failed}개 중 ${passed}개 통과, ${failed}개 실패`);
if (failed > 0) process.exit(1);
