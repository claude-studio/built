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
const { parseProviderConfig, getProviderForPhase } = require('../src/providers/config');

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

  await test('jsonSchema 제공 시 --output-format json, --json-schema 플래그 포함 (--bare 미포함)', async () => {
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
      assert.ok(!capturedArgs.includes('--bare'),           '--bare 미포함 (multica 에이전트 인증 상속)');
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
      assert.ok(result.error && result.error.includes('JSON'), `error: ${result.error}`);
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
      assert.ok(result.error && result.error.includes('Claude 프로세스를 시작하지 못했습니다'), `error: ${result.error}`);
      assert.ok(!result.error.includes('spawn ENOENT'), `error: ${result.error}`);
      assert.ok(result.failure.debug_detail.includes('spawn ENOENT'), `debug_detail: ${result.failure.debug_detail}`);
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
      assert.ok(result.error && result.error.includes('타임아웃'), `error: ${result.error}`);
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
  // [check-result.md] acceptance_criteria_results 섹션
  // =========================================================================

  console.log('\n[check-result.md] acceptance_criteria_results 섹션');

  await test('acResults 있을 때 완료 기준 충족 여부 섹션 포함', () => {
    const dir = makeTmpDir();
    try {
      const featureDir      = path.join(dir, 'features', 'my-feature');
      const checkResultPath = path.join(featureDir, 'check-result.md');
      fs.mkdirSync(featureDir, { recursive: true });

      const acResults = [
        { criterion: 'API endpoint 구현', passed: true },
        { criterion: '유닛 테스트 작성', passed: false },
      ];

      let acSection = '';
      if (acResults.length > 0) {
        acSection = '\n## 완료 기준 충족 여부\n\n' +
          acResults.map((r) => `- [${r.passed ? 'x' : ' '}] ${r.criterion}`).join('\n') + '\n';
      }

      const content = [
        '---',
        'feature: my-feature',
        'status: needs_changes',
        `checked_at: ${new Date().toISOString()}`,
        '---',
        '',
        '## 검토 결과',
        '',
        'Some criteria not met.',
        acSection,
      ].join('\n');

      fs.writeFileSync(checkResultPath, content, 'utf8');

      const written = fs.readFileSync(checkResultPath, 'utf8');
      assert.ok(written.includes('## 완료 기준 충족 여부'),            '섹션 헤더 포함');
      assert.ok(written.includes('[x] API endpoint 구현'),           'passed 항목 체크 표시');
      assert.ok(written.includes('[ ] 유닛 테스트 작성'),             'failed 항목 빈 체크 표시');
    } finally {
      rmDir(dir);
    }
  });

  await test('acResults 빈 배열이면 완료 기준 섹션 없음', () => {
    const acResults = [];
    let acSection = '';
    if (acResults.length > 0) {
      acSection = '\n## 완료 기준 충족 여부\n\n' +
        acResults.map((r) => `- [${r.passed ? 'x' : ' '}] ${r.criterion}`).join('\n') + '\n';
    }
    assert.strictEqual(acSection, '');
  });

  await test('acceptance_criteria_results가 배열이 아닐 때 빈 배열로 폴백', () => {
    const output = { status: 'approved', issues: [], summary: 'ok', acceptance_criteria_results: null };
    const acResults = Array.isArray(output.acceptance_criteria_results)
      ? output.acceptance_criteria_results.filter(
          (r) => r && typeof r.criterion === 'string' && typeof r.passed === 'boolean'
        )
      : [];
    assert.deepStrictEqual(acResults, []);
  });

  await test('acceptance_criteria_results 항목 유효성 필터링 — criterion/passed 없는 항목 제외', () => {
    const output = {
      status: 'approved',
      issues: [],
      summary: 'ok',
      acceptance_criteria_results: [
        { criterion: 'valid', passed: true },
        { criterion: 'no-passed' },
        null,
        { passed: true },
      ],
    };
    const acResults = Array.isArray(output.acceptance_criteria_results)
      ? output.acceptance_criteria_results.filter(
          (r) => r && typeof r.criterion === 'string' && typeof r.passed === 'boolean'
        )
      : [];
    assert.strictEqual(acResults.length, 1);
    assert.strictEqual(acResults[0].criterion, 'valid');
  });

  await test('CHECK_SCHEMA 소스에 acceptance_criteria_results 필드 포함 확인', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'check.js'), 'utf8');
    assert.ok(src.includes('acceptance_criteria_results'), 'acceptance_criteria_results 필드 존재');
    assert.ok(src.includes('"criterion"') || src.includes("'criterion'"), 'criterion 프로퍼티 존재');
    assert.ok(src.includes('"passed"') || src.includes("'passed'"), 'passed 프로퍼티 존재');
  });

  // =========================================================================
  // [providers.check] provider routing — parseProviderConfig/getProviderForPhase
  // =========================================================================

  console.log('\n[providers.check] provider routing');

  await test('providers.check 없으면 기본값 claude 반환', () => {
    const config = parseProviderConfig({});
    const spec = getProviderForPhase(config, 'check');
    assert.strictEqual(spec.name, 'claude');
  });

  await test('providers.check: "codex" 단축형 → name=codex', () => {
    const config = parseProviderConfig({ providers: { check: 'codex' } });
    const spec = getProviderForPhase(config, 'check');
    assert.strictEqual(spec.name, 'codex');
  });

  await test('providers.check 상세형 — name/model/sandbox/effort 적용', () => {
    const config = parseProviderConfig({
      providers: {
        check: { name: 'codex', model: 'gpt-5.5', effort: 'medium', sandbox: 'read-only', timeout_ms: 900000 },
      },
    });
    const spec = getProviderForPhase(config, 'check');
    assert.strictEqual(spec.name, 'codex');
    assert.strictEqual(spec.model, 'gpt-5.5');
    assert.strictEqual(spec.effort, 'medium');
    assert.strictEqual(spec.sandbox, 'read-only');
    assert.strictEqual(spec.timeout_ms, 900000);
  });

  await test('providers.check codex + read-only sandbox — 허용 (check는 파일 변경 불필요)', () => {
    // check phase는 WRITE_REQUIRED_PHASES에 포함되지 않으므로 read-only 허용
    assert.doesNotThrow(() => {
      parseProviderConfig({ providers: { check: { name: 'codex', sandbox: 'read-only' } } });
    });
  });

  await test('providers.check 잘못된 provider 이름 → 오류', () => {
    assert.throws(
      () => parseProviderConfig({ providers: { check: { name: 'openai' } } }),
      /알 수 없는 provider/,
    );
  });

  await test('providers.check claude 상세형 — model 필드 적용', () => {
    const config = parseProviderConfig({
      providers: { check: { name: 'claude', model: 'claude-opus-4-5', timeout_ms: 600000 } },
    });
    const spec = getProviderForPhase(config, 'check');
    assert.strictEqual(spec.name, 'claude');
    assert.strictEqual(spec.model, 'claude-opus-4-5');
    assert.strictEqual(spec.timeout_ms, 600000);
  });

  await test('check.js 소스에 parseProviderConfig/getProviderForPhase 사용 확인', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'check.js'), 'utf8');
    assert.ok(src.includes('parseProviderConfig'), 'parseProviderConfig 사용');
    assert.ok(src.includes('getProviderForPhase'), 'getProviderForPhase 사용');
    assert.ok(src.includes("'check'"), "phase 'check' 전달");
    assert.ok(src.includes('providerSpec'), 'providerSpec 변수 존재');
  });

  await test('check.js 소스에 check-result.md frontmatter provider/model/duration_ms 포함 확인', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'check.js'), 'utf8');
    assert.ok(src.includes('provider:'), 'frontmatter provider 필드 포함');
    assert.ok(src.includes('duration_ms:'), 'frontmatter duration_ms 필드 포함');
  });

  // =========================================================================
  // [providers.check] Codex provider — runPipeline providerSpec 전달 확인
  // =========================================================================

  console.log('\n[providers.check] Codex runPipeline providerSpec 전달');

  await test('providerSpec={name:codex} 전달 시 Codex 경로 진입 — codex 없으면 success:false', async () => {
    // Codex CLI 없는 환경에서는 checkAvailability 실패 → success:false
    const childProcessSync = require('child_process');
    const origSpawnSync = childProcessSync.spawnSync;
    childProcessSync.spawnSync = () => ({ status: 1, stdout: '', stderr: 'not found', error: new Error('ENOENT') });

    const dir = makeTmpDir();
    try {
      const schema = JSON.stringify({ type: 'object', additionalProperties: false });
      const result = await runPipeline({
        prompt: 'review this',
        runtimeRoot: dir,
        featureId: 'f',
        jsonSchema: schema,
        providerSpec: { name: 'codex', sandbox: 'read-only' },
      });
      assert.strictEqual(result.success, false, 'Codex 없으면 success:false');
    } finally {
      childProcessSync.spawnSync = origSpawnSync;
      rmDir(dir);
    }
  });

  await test('providerSpec={name:claude} 전달 시 Claude 경로 — structured_output 반환', async () => {
    const schema = JSON.stringify({ type: 'object' });
    const payload = { status: 'approved', summary: 'ok', issues: [] };
    const responseJson = JSON.stringify({ structured_output: payload });

    const restore = mockSpawn({ stdout: responseJson, exitCode: 0 });
    const dir = makeTmpDir();
    try {
      const result = await runPipeline({
        prompt: 'review this',
        runtimeRoot: dir,
        featureId: 'f',
        jsonSchema: schema,
        providerSpec: { name: 'claude' },
      });
      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.structuredOutput, payload);
    } finally {
      restore();
      rmDir(dir);
    }
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
