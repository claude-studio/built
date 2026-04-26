#!/usr/bin/env node
/**
 * test/notify.test.js
 *
 * notify.js 단위 테스트 (Node.js assert + child_process만 사용, 외부 패키지 없음)
 *
 * 1. 플랫폼 감지
 * 2. CI 환경 감지
 * 3. 알림 메시지 포맷 (pipeline hookpoint)
 * 4. 알림 메시지 포맷 (lifecycle 이벤트)
 * 5. hook 이벤트 처리 (CLI 실행)
 */

'use strict';

const assert       = require('assert');
const childProcess = require('child_process');
const path         = require('path');

const {
  isCI,
  detectPlatform,
  buildPipelineMessage,
  buildLifecycleMessage,
} = require('../scripts/notify');

const NOTIFY_SCRIPT = path.join(__dirname, '..', 'scripts', 'notify.js');

// ---------------------------------------------------------------------------
// 테스트 러너
// ---------------------------------------------------------------------------

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

function assertNoPrivateWorkspacePath(content) {
  const forbidden = [
    '2ce97239-6237-460e-b450-3893ab82fbcb',
    '~/multica_workspaces/',
    '/multica_workspaces/',
    '/workdir/',
  ];
  for (const fragment of forbidden) {
    assert.ok(!content.includes(fragment), `private path fragment 노출(${fragment}): ${content}`);
  }
}

// ---------------------------------------------------------------------------
// [1] 플랫폼 감지
// ---------------------------------------------------------------------------

console.log('\n[platform] 플랫폼 감지');

test('detectPlatform() 이 macos | linux | other 중 하나를 반환한다', () => {
  const result = detectPlatform();
  assert.ok(
    result === 'macos' || result === 'linux' || result === 'other',
    `detectPlatform() returned: ${result}`
  );
});

test('process.platform === darwin 이면 macos 반환', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  try {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    assert.strictEqual(detectPlatform(), 'macos');
  } finally {
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
  }
});

test('process.platform === linux 이면 linux 반환', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  try {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    assert.strictEqual(detectPlatform(), 'linux');
  } finally {
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
  }
});

test('process.platform === win32 이면 other 반환', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  try {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    assert.strictEqual(detectPlatform(), 'other');
  } finally {
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
  }
});

// ---------------------------------------------------------------------------
// [2] CI 환경 감지
// ---------------------------------------------------------------------------

console.log('\n[ci] CI 환경 감지');

test('CI=true 이면 isCI() === true', () => {
  const prev = process.env.CI;
  try {
    process.env.CI = 'true';
    assert.strictEqual(isCI(), true);
  } finally {
    if (prev === undefined) delete process.env.CI;
    else process.env.CI = prev;
  }
});

test('GITHUB_ACTIONS=true 이면 isCI() === true', () => {
  const prev = process.env.GITHUB_ACTIONS;
  try {
    process.env.GITHUB_ACTIONS = 'true';
    assert.strictEqual(isCI(), true);
  } finally {
    if (prev === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = prev;
  }
});

test('NO_NOTIFY 설정 시 isCI() === true', () => {
  const prev = process.env.NO_NOTIFY;
  try {
    process.env.NO_NOTIFY = '1';
    assert.strictEqual(isCI(), true);
  } finally {
    if (prev === undefined) delete process.env.NO_NOTIFY;
    else process.env.NO_NOTIFY = prev;
  }
});

test('CI 환경변수 없으면 isCI() === false', () => {
  // 테스트 환경에서 CI 관련 변수를 모두 임시 제거
  const ciVars = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'JENKINS_URL', 'NO_NOTIFY'];
  const saved = {};
  ciVars.forEach((v) => {
    saved[v] = process.env[v];
    delete process.env[v];
  });
  try {
    assert.strictEqual(isCI(), false);
  } finally {
    ciVars.forEach((v) => {
      if (saved[v] !== undefined) process.env[v] = saved[v];
    });
  }
});

// ---------------------------------------------------------------------------
// [3] 알림 메시지 포맷 — pipeline hookpoint
// ---------------------------------------------------------------------------

console.log('\n[message] pipeline hookpoint 메시지 포맷');

test('after_do — "Do 완료" 메시지 포함', () => {
  const { title, message } = buildPipelineMessage('after_do', 'user-auth');
  assert.strictEqual(title, 'built');
  assert.ok(message.includes('user-auth'), `feature 이름 포함: ${message}`);
  assert.ok(message.includes('Do') || message.includes('완료'), `"Do 완료" 포함: ${message}`);
});

test('after_check — "Check 완료" 메시지 포함', () => {
  const { title, message } = buildPipelineMessage('after_check', 'payment-flow');
  assert.strictEqual(title, 'built');
  assert.ok(message.includes('payment-flow'), `feature 이름 포함: ${message}`);
  assert.ok(message.includes('Check') || message.includes('완료'), `"Check 완료" 포함: ${message}`);
});

test('after_report — "Report 완료" 및 "파이프라인 종료" 메시지 포함', () => {
  const { title, message } = buildPipelineMessage('after_report', 'onboarding');
  assert.strictEqual(title, 'built');
  assert.ok(message.includes('onboarding'), `feature 이름 포함: ${message}`);
  assert.ok(message.includes('Report') || message.includes('완료'), `"Report" 포함: ${message}`);
});

test('before_do — feature 이름 포함', () => {
  const { title, message } = buildPipelineMessage('before_do', 'my-feature');
  assert.strictEqual(title, 'built');
  assert.ok(message.includes('my-feature'), `feature 이름 포함: ${message}`);
});

test('알 수 없는 hookpoint — hookpoint 이름 그대로 포함', () => {
  const { title, message } = buildPipelineMessage('custom_hook', 'test-feature');
  assert.strictEqual(title, 'built');
  assert.ok(message.includes('test-feature'), `feature 이름 포함: ${message}`);
  assert.ok(message.includes('custom_hook'), `hookpoint 이름 포함: ${message}`);
});

test('feature 이름에 특수문자 포함 시 오류 없이 처리', () => {
  assert.doesNotThrow(() => {
    buildPipelineMessage('after_do', 'my-feature-v2.0');
  });
  const { message } = buildPipelineMessage('after_do', 'my-feature-v2.0');
  assert.ok(message.includes('my-feature-v2.0'));
});

test('pipeline 알림 메시지에서 token 후보를 redact', () => {
  const { message } = buildPipelineMessage('after_do', 'token: plain-secret-token');
  assert.ok(!message.includes('plain-secret-token'), `token 값이 남아있음: ${message}`);
  assert.ok(message.includes('[REDACTED]'), `redaction 토큰이 없음: ${message}`);
});

// ---------------------------------------------------------------------------
// [4] 알림 메시지 포맷 — lifecycle 이벤트
// ---------------------------------------------------------------------------

console.log('\n[lifecycle] lifecycle 이벤트 메시지 포맷');

test('WorktreeCreate — worktree 이름 포함', () => {
  const { title, message } = buildLifecycleMessage(
    'WorktreeCreate',
    { worktree_path: '/repo/.claude/worktrees/user-auth-runner' }
  );
  assert.strictEqual(title, 'built');
  assert.ok(message.includes('user-auth-runner'), `worktree 이름 포함: ${message}`);
  assert.ok(message.includes('생성') || message.includes('Create'), `"생성" 포함: ${message}`);
});

test('WorktreeRemove — worktree 이름 포함', () => {
  const { title, message } = buildLifecycleMessage(
    'WorktreeRemove',
    { worktree_path: '/repo/.claude/worktrees/payment-runner' }
  );
  assert.strictEqual(title, 'built');
  assert.ok(message.includes('payment-runner'), `worktree 이름 포함: ${message}`);
  assert.ok(message.includes('제거') || message.includes('Remove'), `"제거" 포함: ${message}`);
});

test('WorktreeCreate — worktree_path 없을 때 오류 없이 처리', () => {
  assert.doesNotThrow(() => {
    buildLifecycleMessage('WorktreeCreate', {});
  });
  const { message } = buildLifecycleMessage('WorktreeCreate', {});
  assert.ok(typeof message === 'string' && message.length > 0);
});

test('worktree_path 끝 슬래시 있어도 이름 추출 정상', () => {
  const { message } = buildLifecycleMessage(
    'WorktreeCreate',
    { worktree_path: '/repo/.claude/worktrees/my-runner/' }
  );
  // filter(Boolean)으로 빈 문자열 제거 후 pop이므로 my-runner가 나와야 함
  assert.ok(message.includes('my-runner'), `worktree 이름 포함: ${message}`);
});

test('lifecycle 알림 메시지에서 private workspace path 후보를 redact', () => {
  const { message } = buildLifecycleMessage(
    'UnknownEvent',
    { worktree_path: '~/multica_workspaces/2ce97239-6237-460e-b450-3893ab82fbcb/6658612f/workdir' }
  );
  assertNoPrivateWorkspacePath(message);
});

test('알 수 없는 lifecycle 이벤트 — 오류 없이 처리', () => {
  assert.doesNotThrow(() => {
    buildLifecycleMessage('UnknownEvent', {});
  });
});

// ---------------------------------------------------------------------------
// [5] hook 이벤트 처리 — CLI 실행 (child_process)
// ---------------------------------------------------------------------------

console.log('\n[cli] CLI 실행 — hook 이벤트 처리');

test('after_do 인자로 실행 시 exit code 0', () => {
  const result = childProcess.spawnSync(
    'node',
    [NOTIFY_SCRIPT, 'after_do', 'test-feature'],
    { env: { ...process.env, NO_NOTIFY: '1' }, encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 0, `exit code: ${result.status}, stderr: ${result.stderr}`);
});

test('after_check 인자로 실행 시 exit code 0', () => {
  const result = childProcess.spawnSync(
    'node',
    [NOTIFY_SCRIPT, 'after_check', 'my-feature'],
    { env: { ...process.env, NO_NOTIFY: '1' }, encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 0, `exit code: ${result.status}`);
});

test('after_report 인자로 실행 시 exit code 0', () => {
  const result = childProcess.spawnSync(
    'node',
    [NOTIFY_SCRIPT, 'after_report', 'report-feature'],
    { env: { ...process.env, NO_NOTIFY: '1' }, encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 0, `exit code: ${result.status}`);
});

test('환경변수 BUILT_HOOK_POINT + BUILT_FEATURE 로 실행 시 exit code 0', () => {
  const result = childProcess.spawnSync(
    'node',
    [NOTIFY_SCRIPT],
    {
      env: {
        ...process.env,
        BUILT_HOOK_POINT: 'after_do',
        BUILT_FEATURE: 'env-feature',
        NO_NOTIFY: '1',
      },
      encoding: 'utf8',
    }
  );
  assert.strictEqual(result.status, 0, `exit code: ${result.status}, stderr: ${result.stderr}`);
});

test('WorktreeCreate CLI 인자로 실행 시 exit code 0', () => {
  const result = childProcess.spawnSync(
    'node',
    [NOTIFY_SCRIPT, 'WorktreeCreate', 'my-feature-runner'],
    { env: { ...process.env, NO_NOTIFY: '1' }, encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 0, `exit code: ${result.status}`);
});

test('WorktreeRemove CLI 인자로 실행 시 exit code 0', () => {
  const result = childProcess.spawnSync(
    'node',
    [NOTIFY_SCRIPT, 'WorktreeRemove', 'old-feature-runner'],
    { env: { ...process.env, NO_NOTIFY: '1' }, encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 0, `exit code: ${result.status}`);
});

test('stdin JSON (Claude Code lifecycle hook) 으로 WorktreeCreate 처리 시 exit code 0', () => {
  const payload = JSON.stringify({
    hook_event_name: 'WorktreeCreate',
    worktree_path: '/repo/.claude/worktrees/stdin-runner',
  });

  const result = childProcess.spawnSync(
    'node',
    [NOTIFY_SCRIPT],
    {
      input: payload,
      env: { ...process.env, NO_NOTIFY: '1' },
      encoding: 'utf8',
    }
  );
  assert.strictEqual(result.status, 0, `exit code: ${result.status}, stderr: ${result.stderr}`);
});

test('stdin JSON WorktreeRemove 처리 시 exit code 0', () => {
  const payload = JSON.stringify({
    hook_event_name: 'WorktreeRemove',
    worktree_path: '/repo/.claude/worktrees/removed-runner',
  });

  const result = childProcess.spawnSync(
    'node',
    [NOTIFY_SCRIPT],
    {
      input: payload,
      env: { ...process.env, NO_NOTIFY: '1' },
      encoding: 'utf8',
    }
  );
  assert.strictEqual(result.status, 0, `exit code: ${result.status}`);
});

test('인자 없고 환경변수도 없으면 exit code 1', () => {
  const env = { ...process.env };
  delete env.BUILT_HOOK_POINT;
  delete env.BUILT_FEATURE;

  const result = childProcess.spawnSync(
    'node',
    [NOTIFY_SCRIPT],
    { env, encoding: 'utf8', input: '' }
  );
  assert.strictEqual(result.status, 1, `exit code: ${result.status}`);
});

test('NO_NOTIFY=1 환경에서 stdout에 fallback 출력 포함', () => {
  const result = childProcess.spawnSync(
    'node',
    [NOTIFY_SCRIPT, 'after_do', 'fallback-feature'],
    { env: { ...process.env, NO_NOTIFY: '1' }, encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 0);
  assert.ok(
    result.stdout.includes('[built notify]'),
    `stdout에 [built notify] 포함: ${result.stdout}`
  );
});

// ---------------------------------------------------------------------------
// 결과
// ---------------------------------------------------------------------------

console.log(`\n결과: ${passed} 통과, ${failed} 실패\n`);
if (failed > 0) process.exit(1);
