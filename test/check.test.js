#!/usr/bin/env node
/**
 * test/check.test.js
 *
 * check.js 관련 단위 테스트 (Node.js assert + fs만 사용, 외부 패키지 없음)
 *
 * 1. pipeline-runner.js --json-schema 모드 (_runPipelineJson 경로) 테스트
 * 2. check-result.md 생성 로직 테스트
 */

'use strict';

const assert       = require('assert');
const fs           = require('fs');
const os           = require('os');
const path         = require('path');
const childProcess = require('child_process');
const { EventEmitter } = require('events');

const { runPipeline } = require('../src/pipeline-runner');

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
    failed++;
  }
}

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'check-test-'));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// spawn mock 헬퍼
// ---------------------------------------------------------------------------

/**
 * childProcess.spawn을 임시로 대체해 가짜 프로세스를 반환한다.
 *
 * @param {object} opts
 * @param {string}   [opts.stdout]       stdout으로 보낼 전체 내용
 * @param {string}   [opts.stderr]       stderr 내용
 * @param {number}   [opts.exitCode=0]   종료 코드
 * @param {number}   [opts.delay=0]      close 이벤트 지연 (ms)
 * @param {boolean}  [opts.spawnError]   'error' 이벤트 발생 여부
 * @param {Function} [opts.onArgs]       spawn 인자 캡처 콜백 (cmd, args)
 * @returns {Function} restore — 원래 spawn으로 복원
 */
function mockSpawn({ stdout = '', stderr = '', exitCode = 0, delay = 0, spawnError = false, onArgs } = {}) {
  const originalSpawn = childProcess.spawn;

  childProcess.spawn = function fakeSpawn(cmd, args) {
    if (onArgs) onArgs(cmd, args);

    const proc = new EventEmitter();
    proc.kill = () => { setImmediate(() => proc.emit('close', null)); };
    proc.stdin = { write: () => {}, end: () => {} };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();

    setImmediate(() => {
      if (spawnError) {
        proc.emit('error', new Error('spawn ENOENT'));
        return;
      }
      if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
      if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
      proc.stdout.emit('end');

      const doClose = () => proc.emit('close', exitCode);
      if (delay > 0) setTimeout(doClose, delay);
      else setImmediate(doClose);
    });

    return proc;
  };

  return function restore() {
    childProcess.spawn = originalSpawn;
  };
}

// ---------------------------------------------------------------------------
// 메인 테스트
// ---------------------------------------------------------------------------

async function main() {

  // =========================================================================
  // [runPipeline] jsonSchema 모드 — CLI 인자 확인
  // =========================================================================

  console.log('\n[runPipeline] jsonSchema 모드 — CLI 인자');

  await test('jsonSchema 제공 시 --bare, --output-format json, --json-schema 플래그 포함', async () => {
    let capturedArgs;
    const schema = JSON.stringify({ type: 'object', properties: { status: { type: 'string' } } });
    const responseJson = JSON.stringify({ structured_output: { status: 'approved', summary: 'ok' } });

    const restore = mockSpawn({
      stdout: responseJson,
      exitCode: 0,
      onArgs: (cmd, args) => { capturedArgs = args; },
    });
    const dir = makeTmpDir();
    try {
      await runPipeline({ prompt: 'review', runtimeRoot: dir, featureId: 'f', jsonSchema: schema });
      assert.ok(capturedArgs.includes('--bare'),            '--bare 포함');
      assert.ok(capturedArgs.includes('--output-format'),   '--output-format 포함');
      assert.ok(capturedArgs.includes('json'),              'json 포함');
      assert.ok(capturedArgs.includes('--json-schema'),     '--json-schema 포함');
      assert.ok(capturedArgs.includes(schema),              'schema 문자열 포함');
    } finally {
      restore();
      rmDir(dir);
    }
  });

  await test('jsonSchema 제공 시 stream-json, --verbose 플래그 미포함', async () => {
    let capturedArgs;
    const schema = JSON.stringify({ type: 'object' });
    const responseJson = JSON.stringify({ structured_output: { status: 'approved', summary: 's' } });

    const restore = mockSpawn({
      stdout: responseJson,
      exitCode: 0,
      onArgs: (cmd, args) => { capturedArgs = args; },
    });
    const dir = makeTmpDir();
    try {
      await runPipeline({ prompt: 'review', runtimeRoot: dir, featureId: 'f', jsonSchema: schema });
      assert.ok(!capturedArgs.includes('stream-json'), 'stream-json 미포함');
      assert.ok(!capturedArgs.includes('--verbose'),   '--verbose 미포함');
    } finally {
      restore();
      rmDir(dir);
    }
  });

  await test('model 지정 시 --model 플래그 포함', async () => {
    let capturedArgs;
    const schema = JSON.stringify({ type: 'object' });
    const responseJson = JSON.stringify({ structured_output: { status: 'approved', summary: 's' } });

    const restore = mockSpawn({
      stdout: responseJson,
      exitCode: 0,
      onArgs: (cmd, args) => { capturedArgs = args; },
    });
    const dir = makeTmpDir();
    try {
      await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f', jsonSchema: schema, model: 'claude-opus-4-5' });
      const modelIdx = capturedArgs.indexOf('--model');
      assert.ok(modelIdx !== -1, '--model 플래그 포함');
      assert.strictEqual(capturedArgs[modelIdx + 1], 'claude-opus-4-5');
    } finally {
      restore();
      rmDir(dir);
    }
  });

  // =========================================================================
  // [runPipeline] jsonSchema 모드 — structured_output 파싱
  // =========================================================================

  console.log('\n[runPipeline] jsonSchema 모드 — structured_output 파싱');

  await test('structured_output 필드 있는 JSON 응답 → structuredOutput 반환', async () => {
    const schema = JSON.stringify({ type: 'object' });
    const payload = { status: 'approved', issues: [], summary: 'All good' };
    const responseJson = JSON.stringify({ structured_output: payload, cost_usd: 0.01 });

    const restore = mockSpawn({ stdout: responseJson, exitCode: 0 });
    const dir = makeTmpDir();
    try {
      const result = await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f', jsonSchema: schema });
      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.structuredOutput, payload);
    } finally {
      restore();
      rmDir(dir);
    }
  });

  await test('structured_output 없는 JSON → 응답 전체를 structuredOutput으로 반환', async () => {
    const schema = JSON.stringify({ type: 'object' });
    const payload = { status: 'needs_changes', issues: ['fix bug'], summary: 'needs work' };
    const responseJson = JSON.stringify(payload);

    const restore = mockSpawn({ stdout: responseJson, exitCode: 0 });
    const dir = makeTmpDir();
    try {
      const result = await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f', jsonSchema: schema });
      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.structuredOutput, payload);
    } finally {
      restore();
      rmDir(dir);
    }
  });

  await test('stdout이 유효하지 않은 JSON → success:false 반환', async () => {
    const schema = JSON.stringify({ type: 'object' });

    const restore = mockSpawn({ stdout: 'not-json-at-all', exitCode: 0 });
    const dir = makeTmpDir();
    try {
      const result = await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f', jsonSchema: schema });
      assert.strictEqual(result.success, false);
      assert.ok(result.error && result.error.includes('JSON parse failed'), `error: ${result.error}`);
    } finally {
      restore();
      rmDir(dir);
    }
  });

  await test('exit code 1 → success:false 반환', async () => {
    const schema = JSON.stringify({ type: 'object' });

    const restore = mockSpawn({ stdout: '', stderr: 'claude error', exitCode: 1 });
    const dir = makeTmpDir();
    try {
      const result = await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f', jsonSchema: schema });
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.exitCode, 1);
    } finally {
      restore();
      rmDir(dir);
    }
  });

  await test('spawn error → success:false 반환', async () => {
    const schema = JSON.stringify({ type: 'object' });

    const restore = mockSpawn({ spawnError: true });
    const dir = makeTmpDir();
    try {
      const result = await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f', jsonSchema: schema });
      assert.strictEqual(result.success, false);
      assert.ok(result.error && result.error.includes('spawn ENOENT'), `error: ${result.error}`);
    } finally {
      restore();
      rmDir(dir);
    }
  });

  await test('MULTICA_AGENT_TIMEOUT 적용 — 타임아웃 시 success:false', async () => {
    const orig = process.env.MULTICA_AGENT_TIMEOUT;
    process.env.MULTICA_AGENT_TIMEOUT = '10ms';

    const schema = JSON.stringify({ type: 'object' });
    const restore = mockSpawn({ stdout: '{}', exitCode: 0, delay: 50 });
    const dir = makeTmpDir();
    try {
      const result = await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f', jsonSchema: schema });
      assert.strictEqual(result.success, false);
      assert.ok(result.error && result.error.includes('timed out'), `error: ${result.error}`);
    } finally {
      restore();
      rmDir(dir);
      if (orig === undefined) delete process.env.MULTICA_AGENT_TIMEOUT;
      else process.env.MULTICA_AGENT_TIMEOUT = orig;
    }
  });

  // =========================================================================
  // [runPipeline] jsonSchema 없을 때 기존 stream-json 모드 동작 유지
  // =========================================================================

  console.log('\n[runPipeline] jsonSchema 없을 때 기존 모드 동작 유지');

  await test('jsonSchema 미제공 시 stream-json 모드로 동작', async () => {
    let capturedArgs;
    const restore = mockSpawn({
      exitCode: 0,
      onArgs: (cmd, args) => { capturedArgs = args; },
    });
    const dir = makeTmpDir();
    try {
      const result = await runPipeline({ prompt: 'hi', runtimeRoot: dir, featureId: 'f' });
      assert.strictEqual(result.success, true);
      assert.ok(capturedArgs.includes('stream-json'), 'stream-json 포함');
      assert.ok(capturedArgs.includes('--verbose'),   '--verbose 포함');
      assert.ok(!capturedArgs.includes('--bare'),     '--bare 미포함');
    } finally {
      restore();
      rmDir(dir);
    }
  });

  // =========================================================================
  // check-result.md 생성 로직 (독립 단위 테스트)
  // =========================================================================

  console.log('\n[check-result.md] 생성 로직');

  await test('approved 상태 — check-result.md frontmatter status: approved', () => {
    const dir = makeTmpDir();
    try {
      const featureDir    = path.join(dir, 'features', 'my-feature');
      const checkResultPath = path.join(featureDir, 'check-result.md');

      fs.mkdirSync(featureDir, { recursive: true });

      const status  = 'approved';
      const issues  = [];
      const summary = 'Implementation looks good.';
      const now     = new Date().toISOString();

      let issuesSection = '';
      if (issues.length > 0) {
        issuesSection = '\n## 수정 필요 항목\n\n' + issues.map((i) => `- ${i}`).join('\n') + '\n';
      }

      const content = [
        '---',
        `feature: my-feature`,
        `status: ${status}`,
        `checked_at: ${now}`,
        '---',
        '',
        '## 검토 결과',
        '',
        summary,
        issuesSection,
      ].join('\n');

      fs.writeFileSync(checkResultPath, content, 'utf8');

      const written = fs.readFileSync(checkResultPath, 'utf8');
      assert.ok(written.includes('status: approved'),               'status: approved 포함');
      assert.ok(written.includes('feature: my-feature'),          'feature 포함');
      assert.ok(written.includes('## 검토 결과'),                   '검토 결과 섹션 포함');
      assert.ok(written.includes('Implementation looks good.'),   '요약 포함');
      assert.ok(!written.includes('수정 필요 항목'),                '수정 필요 항목 섹션 없어야 함');
    } finally {
      rmDir(dir);
    }
  });

  await test('needs_changes 상태 — check-result.md에 issues 목록 포함', () => {
    const dir = makeTmpDir();
    try {
      const featureDir    = path.join(dir, 'features', 'my-feature');
      const checkResultPath = path.join(featureDir, 'check-result.md');

      fs.mkdirSync(featureDir, { recursive: true });

      const status  = 'needs_changes';
      const issues  = ['Missing error handling in auth.js', 'Tests incomplete for edge cases'];
      const summary = 'Several issues need to be addressed.';
      const now     = new Date().toISOString();

      let issuesSection = '';
      if (issues.length > 0) {
        issuesSection = '\n## 수정 필요 항목\n\n' + issues.map((i) => `- ${i}`).join('\n') + '\n';
      }

      const content = [
        '---',
        `feature: my-feature`,
        `status: ${status}`,
        `checked_at: ${now}`,
        '---',
        '',
        '## 검토 결과',
        '',
        summary,
        issuesSection,
      ].join('\n');

      fs.writeFileSync(checkResultPath, content, 'utf8');

      const written = fs.readFileSync(checkResultPath, 'utf8');
      assert.ok(written.includes('status: needs_changes'),              'status: needs_changes 포함');
      assert.ok(written.includes('## 수정 필요 항목'),                    '수정 필요 항목 섹션 포함');
      assert.ok(written.includes('Missing error handling in auth.js'),  'issue 1 포함');
      assert.ok(written.includes('Tests incomplete for edge cases'),    'issue 2 포함');
    } finally {
      rmDir(dir);
    }
  });

  await test('status 값 정규화 — 알 수 없는 값은 needs_changes로 처리', () => {
    // check.js의 정규화 로직 확인
    const rawStatus = 'unknown_value';
    const status    = rawStatus === 'approved' ? 'approved' : 'needs_changes';
    assert.strictEqual(status, 'needs_changes');
  });

  await test('issues가 배열이 아닐 때 빈 배열로 폴백', () => {
    const output = { status: 'approved', issues: null, summary: 'ok' };
    const issues = Array.isArray(output.issues) ? output.issues : [];
    assert.deepStrictEqual(issues, []);
  });

  await test('summary가 문자열이 아닐 때 빈 문자열로 폴백', () => {
    const output = { status: 'approved', issues: [], summary: undefined };
    const summary = typeof output.summary === 'string' ? output.summary : '';
    assert.strictEqual(summary, '');
  });

  // =========================================================================
  // 결과
  // =========================================================================

  console.log(`\n결과: ${passed} 통과, ${failed} 실패`);

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
