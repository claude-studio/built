#!/usr/bin/env node
/**
 * test/file-contracts.test.js
 *
 * 핵심 산출물 파일의 contract/snapshot 테스트.
 * docs/contracts/file-contracts.md 명세를 기준으로 필드 존재·타입·불변 조건을 검증한다.
 *
 * 대상 파일:
 *   - state.json        (.built/runtime/runs/<feature>/state.json)
 *   - progress.json     (.built/features/<feature>/progress.json)
 *   - do-result.md      (.built/features/<feature>/do-result.md)
 *
 * 외부 npm 패키지 없음. Node.js assert + fs만 사용.
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const { initState, updateState, readState } = require('../src/state');
const { createWriter }                      = require('../src/progress-writer');
const { createStandardWriter }              = require('../src/providers/standard-writer');
const { convert }                           = require('../src/result-to-markdown');
const { parse }                             = require('../src/frontmatter');
const { formatStatus }                      = require('../scripts/status');

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

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'contract-test-'));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function assertNoPrivateWorkspacePath(content) {
  const forbidden = [
    '2ce97239-6237-460e-b450-3893ab82fbcb',
    '~/multica_workspaces/',
    '/multica_workspaces/',
    '/workdir/',
    '/workdir/built',
  ];
  for (const fragment of forbidden) {
    assert.ok(!content.includes(fragment), `private path fragment 노출(${fragment}): ${content}`);
  }
}

// ---------------------------------------------------------------------------
// state.json contract
// ---------------------------------------------------------------------------

console.log('\n[state.json contract]');

test('initState — 필수 필드 존재', () => {
  const dir = makeTmpDir();
  try {
    const state = initState(dir, 'my-feature');
    const REQUIRED = ['feature', 'phase', 'status', 'pid', 'heartbeat', 'startedAt', 'updatedAt', 'attempt', 'last_error'];
    for (const key of REQUIRED) {
      assert.ok(key in state, `필드 누락: ${key}`);
    }
  } finally {
    rmDir(dir);
  }
});

test('initState — 초기값 타입 계약', () => {
  const dir = makeTmpDir();
  try {
    const state = initState(dir, 'my-feature');
    assert.strictEqual(typeof state.feature,   'string');
    assert.strictEqual(typeof state.phase,     'string');
    assert.strictEqual(typeof state.status,    'string');
    assert.strictEqual(state.pid,              null);
    assert.strictEqual(state.heartbeat,        null);
    assert.strictEqual(typeof state.startedAt, 'string');
    assert.strictEqual(typeof state.updatedAt, 'string');
    assert.strictEqual(typeof state.attempt,   'number');
    assert.strictEqual(state.last_error,       null);
  } finally {
    rmDir(dir);
  }
});

test('initState — ISO 타임스탬프 유효성', () => {
  const dir = makeTmpDir();
  try {
    const state = initState(dir, 'my-feature');
    assert.ok(!isNaN(Date.parse(state.startedAt)), 'startedAt이 유효한 ISO 타임스탬프여야 함');
    assert.ok(!isNaN(Date.parse(state.updatedAt)), 'updatedAt이 유효한 ISO 타임스탬프여야 함');
  } finally {
    rmDir(dir);
  }
});

test('initState — 초기 phase/status가 planned', () => {
  const dir = makeTmpDir();
  try {
    const state = initState(dir, 'my-feature');
    assert.strictEqual(state.phase,  'planned');
    assert.strictEqual(state.status, 'planned');
    assert.strictEqual(state.attempt, 0);
  } finally {
    rmDir(dir);
  }
});

test('state.json — feature는 변경되지 않는다 (불변 조건)', () => {
  const dir = makeTmpDir();
  try {
    initState(dir, 'immutable-feature');
    updateState(dir, { phase: 'do', status: 'running' });
    updateState(dir, { phase: 'check', status: 'running' });
    const state = readState(dir);
    assert.strictEqual(state.feature, 'immutable-feature');
  } finally {
    rmDir(dir);
  }
});

test('state.json — startedAt은 갱신되지 않는다 (불변 조건)', () => {
  const dir = makeTmpDir();
  try {
    const initial = initState(dir, 'my-feature');
    updateState(dir, { phase: 'do', status: 'running' });
    const after = readState(dir);
    assert.strictEqual(after.startedAt, initial.startedAt);
  } finally {
    rmDir(dir);
  }
});

test('state.json — updateState 후 updatedAt이 갱신된다', () => {
  const dir = makeTmpDir();
  try {
    const initial = initState(dir, 'my-feature');
    // 시간 차이를 만들기 위해 Date를 mock
    const origDate = global.Date;
    const fakeNow  = new origDate(initial.updatedAt).getTime() + 5000;
    global.Date = class extends origDate {
      static now()   { return fakeNow; }
      toISOString()  { return new origDate(fakeNow).toISOString(); }
      constructor(...a) { if (a.length === 0) super(fakeNow); else super(...a); }
    };
    try {
      const next = updateState(dir, { phase: 'do' });
      assert.ok(
        new origDate(next.updatedAt).getTime() > new origDate(initial.updatedAt).getTime(),
        'updatedAt이 증가해야 함'
      );
    } finally {
      global.Date = origDate;
    }
  } finally {
    rmDir(dir);
  }
});

test('state.json — do phase 전환 후 파일에 반영됨', () => {
  const dir = makeTmpDir();
  try {
    initState(dir, 'run-feature');
    updateState(dir, { phase: 'do', status: 'running', pid: 12345, heartbeat: new Date().toISOString() });

    const state = readJson(path.join(dir, 'state.json'));
    assert.strictEqual(state.phase,  'do');
    assert.strictEqual(state.status, 'running');
    assert.strictEqual(state.pid,    12345);
    assert.ok(state.heartbeat, 'heartbeat 설정되어야 함');
  } finally {
    rmDir(dir);
  }
});

test('state.json — completed 상태 기록', () => {
  const dir = makeTmpDir();
  try {
    initState(dir, 'done-feature');
    updateState(dir, { phase: 'report', status: 'completed', last_error: null });

    const state = readJson(path.join(dir, 'state.json'));
    assert.strictEqual(state.phase,      'report');
    assert.strictEqual(state.status,     'completed');
    assert.strictEqual(state.last_error, null);
  } finally {
    rmDir(dir);
  }
});

test('state.json — failed 상태 및 last_error 기록', () => {
  const dir = makeTmpDir();
  try {
    initState(dir, 'fail-feature');
    updateState(dir, { phase: 'do', status: 'failed', last_error: 'do.js exited with code 1' });

    const state = readJson(path.join(dir, 'state.json'));
    assert.strictEqual(state.status,     'failed');
    assert.strictEqual(state.last_error, 'do.js exited with code 1');
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// progress.json contract
// ---------------------------------------------------------------------------

console.log('\n[progress.json contract]');

test('createWriter + 이벤트 없이 close — progress.json 존재 및 필수 필드', () => {
  const dir = makeTmpDir();
  try {
    const writer = createWriter({ runtimeRoot: dir, phase: 'do', featureId: 'feat' });
    writer.close();

    const progressPath = path.join(dir, 'progress.json');
    assert.ok(fs.existsSync(progressPath), 'progress.json 존재해야 함');

    const progress = readJson(progressPath);
    const REQUIRED = ['feature', 'phase', 'session_id', 'turn', 'tool_calls',
                      'last_text', 'cost_usd', 'input_tokens', 'output_tokens',
                      'started_at', 'updated_at'];
    for (const key of REQUIRED) {
      assert.ok(key in progress, `필드 누락: ${key}`);
    }
  } finally {
    rmDir(dir);
  }
});

test('progress.json — 초기값 타입 계약', () => {
  const dir = makeTmpDir();
  try {
    const writer = createWriter({ runtimeRoot: dir, phase: 'do', featureId: 'feat' });
    writer.close();

    const progress = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(typeof progress.feature,       'string');
    assert.strictEqual(typeof progress.phase,         'string');
    assert.ok(progress.session_id === null || typeof progress.session_id === 'string');
    assert.strictEqual(typeof progress.turn,          'number');
    assert.strictEqual(typeof progress.tool_calls,    'number');
    assert.strictEqual(typeof progress.last_text,     'string');
    assert.strictEqual(typeof progress.cost_usd,      'number');
    assert.strictEqual(typeof progress.input_tokens,  'number');
    assert.strictEqual(typeof progress.output_tokens, 'number');
    assert.strictEqual(typeof progress.started_at,    'string');
    assert.strictEqual(typeof progress.updated_at,    'string');
  } finally {
    rmDir(dir);
  }
});

test('progress.json — feature와 phase가 writer 생성 시 고정됨', () => {
  const dir = makeTmpDir();
  try {
    const writer = createWriter({ runtimeRoot: dir, phase: 'check', featureId: 'my-feat' });
    writer.handleEvent({ type: 'system', subtype: 'init', session_id: 'sess-1' });
    writer.close();

    const progress = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(progress.feature, 'my-feat');
    assert.strictEqual(progress.phase,   'check');
  } finally {
    rmDir(dir);
  }
});

test('progress.json — system(init) 이벤트로 session_id 설정', () => {
  const dir = makeTmpDir();
  try {
    const writer = createWriter({ runtimeRoot: dir, phase: 'do', featureId: 'feat' });
    writer.handleEvent({ type: 'system', subtype: 'init', session_id: 'sess-abc-123' });
    writer.close();

    const progress = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(progress.session_id, 'sess-abc-123');
  } finally {
    rmDir(dir);
  }
});

test('progress.json — assistant 이벤트로 turn/tool_calls/last_text 갱신', () => {
  const dir = makeTmpDir();
  try {
    const writer = createWriter({ runtimeRoot: dir, phase: 'do', featureId: 'feat' });
    writer.handleEvent({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'implementing the feature...' },
          { type: 'tool_use', id: 't1', name: 'Write', input: {} },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });
    writer.close();

    const progress = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(progress.turn,       1);
    assert.strictEqual(progress.tool_calls, 1);
    assert.ok(progress.last_text.includes('implementing'), 'last_text에 내용 포함');
    assert.strictEqual(progress.input_tokens,  100);
    assert.strictEqual(progress.output_tokens, 50);
  } finally {
    rmDir(dir);
  }
});

test('progress.json — result 이벤트로 cost_usd/status/stop_reason 설정', () => {
  const dir = makeTmpDir();
  try {
    const writer = createWriter({ runtimeRoot: dir, phase: 'do', featureId: 'feat' });
    writer.handleEvent({
      type:          'result',
      result:        'All done.',
      total_cost_usd: 0.0234,
      stop_reason:   'end_turn',
      subtype:       'success',
    });
    writer.close();

    const progress = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(progress.cost_usd,    0.0234);
    assert.strictEqual(progress.status,      'completed');
    assert.strictEqual(progress.stop_reason, 'end_turn');
  } finally {
    rmDir(dir);
  }
});

test('progress.json — result(error) 이벤트로 status=failed 설정', () => {
  const dir = makeTmpDir();
  try {
    const writer = createWriter({ runtimeRoot: dir, phase: 'do', featureId: 'feat' });
    writer.handleEvent({
      type:     'result',
      subtype:  'error',
      is_error: true,
      result:   '',
      total_cost_usd: 0,
    });
    writer.close();

    const progress = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(progress.status, 'failed');
  } finally {
    rmDir(dir);
  }
});

test('progress.json — close 시 result 미수신이면 status=crashed', () => {
  const dir = makeTmpDir();
  try {
    const writer = createWriter({ runtimeRoot: dir, phase: 'do', featureId: 'feat' });
    // result 이벤트 없이 close
    writer.close();

    const progress = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(progress.status, 'crashed');
  } finally {
    rmDir(dir);
  }
});

test('progress.json — last_text는 200자로 잘린다', () => {
  const dir = makeTmpDir();
  try {
    const longText = 'x'.repeat(500);
    const writer = createWriter({ runtimeRoot: dir, phase: 'do', featureId: 'feat' });
    writer.handleEvent({
      type: 'assistant',
      message: { content: [{ type: 'text', text: longText }], usage: {} },
    });
    writer.close();

    const progress = readJson(path.join(dir, 'progress.json'));
    assert.ok(progress.last_text.length <= 200, `last_text가 ${progress.last_text.length}자: 200자 이하여야 함`);
  } finally {
    rmDir(dir);
  }
});

test('progress.json — turn은 단조 증가한다', () => {
  const dir = makeTmpDir();
  try {
    const writer = createWriter({ runtimeRoot: dir, phase: 'do', featureId: 'feat' });
    for (let i = 0; i < 3; i++) {
      writer.handleEvent({
        type: 'assistant',
        message: { content: [{ type: 'text', text: `turn ${i}` }], usage: {} },
      });
    }
    writer.close();

    const progress = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(progress.turn, 3);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// do-result.md contract
// ---------------------------------------------------------------------------

console.log('\n[do-result.md contract]');

test('convert — 파일 생성 및 YAML frontmatter 존재', () => {
  const dir = makeTmpDir();
  const outputPath = path.join(dir, 'do-result.md');
  try {
    convert({
      feature_id:  'test-feat',
      subtype:     'success',
      result:      'Feature implemented.',
      cost_usd:    0.0123,
      duration_ms: 5000,
      started_at:  '2026-04-26T00:00:00.000Z',
      updated_at:  '2026-04-26T00:01:00.000Z',
    }, outputPath);

    assert.ok(fs.existsSync(outputPath), 'do-result.md 존재해야 함');
    const content = fs.readFileSync(outputPath, 'utf8');
    assert.ok(content.startsWith('---'), 'YAML frontmatter로 시작해야 함');
    assert.ok(content.includes('---', 3), 'YAML frontmatter 닫힘 구분자 존재해야 함');
  } finally {
    rmDir(dir);
  }
});

test('do-result.md — 필수 frontmatter 필드', () => {
  const dir = makeTmpDir();
  const outputPath = path.join(dir, 'do-result.md');
  try {
    convert({
      feature_id:  'test-feat',
      subtype:     'success',
      result:      'Done.',
      cost_usd:    0.005,
      duration_ms: 3000,
      started_at:  '2026-04-26T00:00:00.000Z',
      updated_at:  '2026-04-26T00:01:00.000Z',
    }, outputPath);

    const content = fs.readFileSync(outputPath, 'utf8');
    const { data } = parse(content);

    const REQUIRED = ['feature_id', 'status', 'model', 'cost_usd', 'duration_ms', 'created_at'];
    for (const key of REQUIRED) {
      assert.ok(key in data, `frontmatter 필드 누락: ${key}`);
    }
  } finally {
    rmDir(dir);
  }
});

test('do-result.md — feature_id 계약 (null 불가)', () => {
  const dir = makeTmpDir();
  const outputPath = path.join(dir, 'do-result.md');
  try {
    convert({
      feature_id: 'my-feature',
      subtype:    'success',
      result:     '',
    }, outputPath);

    const content = fs.readFileSync(outputPath, 'utf8');
    const { data } = parse(content);
    assert.strictEqual(data.feature_id, 'my-feature');
  } finally {
    rmDir(dir);
  }
});

test('do-result.md — status는 completed 또는 failed 중 하나', () => {
  const dir = makeTmpDir();
  try {
    // success
    const pathSuccess = path.join(dir, 'result-success.md');
    convert({ feature_id: 'f', subtype: 'success', result: '' }, pathSuccess);
    const successData = parse(fs.readFileSync(pathSuccess, 'utf8')).data;
    assert.strictEqual(successData.status, 'completed');

    // error
    const pathError = path.join(dir, 'result-error.md');
    convert({ feature_id: 'f', subtype: 'error', result: '' }, pathError);
    const errorData = parse(fs.readFileSync(pathError, 'utf8')).data;
    assert.strictEqual(errorData.status, 'failed');
  } finally {
    rmDir(dir);
  }
});

test('do-result.md — cost_usd 타입 계약', () => {
  const dir = makeTmpDir();
  const outputPath = path.join(dir, 'do-result.md');
  try {
    convert({ feature_id: 'f', subtype: 'success', result: '', cost_usd: 0.0456 }, outputPath);
    const { data } = parse(fs.readFileSync(outputPath, 'utf8'));
    assert.strictEqual(typeof data.cost_usd, 'number');
    assert.strictEqual(data.cost_usd, 0.0456);
  } finally {
    rmDir(dir);
  }
});

test('do-result.md — duration_ms를 started_at/updated_at에서 계산', () => {
  const dir = makeTmpDir();
  const outputPath = path.join(dir, 'do-result.md');
  try {
    convert({
      feature_id: 'f',
      subtype:    'success',
      result:     '',
      started_at: '2026-04-26T00:00:00.000Z',
      updated_at: '2026-04-26T00:01:00.000Z',
      // duration_ms 미제공 → 계산됨
    }, outputPath);

    const { data } = parse(fs.readFileSync(outputPath, 'utf8'));
    assert.strictEqual(data.duration_ms, 60000); // 1분 = 60000ms
  } finally {
    rmDir(dir);
  }
});

test('do-result.md — 본문이 frontmatter 이후에 위치', () => {
  const dir = makeTmpDir();
  const outputPath = path.join(dir, 'do-result.md');
  try {
    const body = '# Result\nFeature is complete.';
    convert({ feature_id: 'f', subtype: 'success', result: body }, outputPath);

    const content = fs.readFileSync(outputPath, 'utf8');
    const { content: parsedBody } = parse(content);
    assert.ok(parsedBody.includes('Feature is complete.'), '본문 포함되어야 함');
  } finally {
    rmDir(dir);
  }
});

test('do-result.md — created_at이 유효한 ISO 타임스탬프', () => {
  const dir = makeTmpDir();
  const outputPath = path.join(dir, 'do-result.md');
  try {
    convert({ feature_id: 'f', subtype: 'success', result: '' }, outputPath);
    const { data } = parse(fs.readFileSync(outputPath, 'utf8'));
    assert.ok(!isNaN(Date.parse(data.created_at)), 'created_at이 유효한 ISO 타임스탬프여야 함');
  } finally {
    rmDir(dir);
  }
});

test('standard-writer error — failure.user_message를 사용자-facing last_error로 우선 기록', () => {
  const dir = makeTmpDir();
  const resultPath = path.join(dir, 'do-result.md');
  try {
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz1234567890';
    const homePath = '/Users/alice/project/.env';
    const rawMessage = `provider raw failure: ${secret} at ${homePath}`;
    const safeMessage = '인증이 필요합니다.';
    const action = 'codex login을 실행한 뒤 다시 시도하세요.';

    const writer = createStandardWriter({
      runtimeRoot: dir,
      phase: 'do',
      featureId: 'safe-error',
      resultOutputPath: resultPath,
    });

    writer.handleEvent({
      type: 'phase_start',
      provider: 'codex',
      model: 'gpt-5.5',
    });
    writer.handleEvent({
      type: 'error',
      message: rawMessage,
      failure: {
        kind: 'auth',
        code: 'codex_auth_required',
        user_message: safeMessage,
        action,
        retryable: false,
        blocked: true,
      },
    });

    const progress = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(progress.status, 'failed');
    assert.strictEqual(progress.last_error, safeMessage);
    assert.strictEqual(progress.last_failure.action, action);
    assert.ok(!progress.last_error.includes(secret), 'progress.last_error에 secret 노출');
    assert.ok(!progress.last_error.includes(homePath), 'progress.last_error에 home path 노출');

    const statusOutput = formatStatus('safe-error', progress, null);
    assert.ok(statusOutput.includes(safeMessage), 'status에 safe message 누락');
    assert.ok(statusOutput.includes(action), 'status에 next action 누락');
    assert.ok(!statusOutput.includes(secret), 'status 출력에 secret 노출');
    assert.ok(!statusOutput.includes(homePath), 'status 출력에 home path 노출');

    const resultContent = fs.readFileSync(resultPath, 'utf8');
    assert.ok(resultContent.includes(safeMessage), 'do-result.md에 safe message 누락');
    assert.ok(resultContent.includes(action), 'do-result.md에 next action 누락');
    assert.ok(!resultContent.includes(secret), 'do-result.md에 secret 노출');
    assert.ok(!resultContent.includes(homePath), 'do-result.md에 home path 노출');
  } finally {
    rmDir(dir);
  }
});

test('standard-writer success — logs/<phase>.jsonl에 표준 이벤트를 append한다', () => {
  const dir = makeTmpDir();
  const resultPath = path.join(dir, 'do-result.md');
  try {
    const writer = createStandardWriter({
      runtimeRoot: dir,
      phase: 'do',
      featureId: 'standard-log-success',
      resultOutputPath: resultPath,
    });

    writer.handleEvent({ type: 'phase_start', phase: 'do', provider: 'codex', model: 'gpt-5.5' });
    writer.handleEvent({ type: 'text_delta', phase: 'do', text: '진행 중' });
    writer.handleEvent({ type: 'phase_end', phase: 'do', status: 'completed', result: '완료', duration_ms: 1000 });

    const logPath = path.join(dir, 'logs', 'do.jsonl');
    assert.ok(fs.existsSync(logPath), 'logs/do.jsonl 존재');
    const entries = readJsonl(logPath);
    assert.deepStrictEqual(entries.map((e) => e.type), ['phase_start', 'text_delta', 'phase_end']);
    assert.strictEqual(entries[0].provider, 'codex');
    assert.strictEqual(entries[2].status, 'completed');
  } finally {
    rmDir(dir);
  }
});

test('standard-writer error — 실패 시에도 logs/<phase>.jsonl에 terminal error를 append한다', () => {
  const dir = makeTmpDir();
  const resultPath = path.join(dir, 'check-result.md');
  try {
    const writer = createStandardWriter({
      runtimeRoot: dir,
      phase: 'check',
      featureId: 'standard-log-error',
      resultOutputPath: resultPath,
    });

    writer.handleEvent({ type: 'phase_start', phase: 'check', provider: 'codex', model: 'gpt-5.5' });
    writer.handleEvent({
      type: 'error',
      phase: 'check',
      message: '실패',
      failure: {
        kind: 'model_response',
        code: 'codex_failed',
        user_message: 'Codex 실행이 실패했습니다.',
        debug_detail: 'debug detail for logs only',
        retryable: true,
        blocked: false,
      },
    });

    const logPath = path.join(dir, 'logs', 'check.jsonl');
    assert.ok(fs.existsSync(logPath), 'logs/check.jsonl 존재');
    const entries = readJsonl(logPath);
    assert.deepStrictEqual(entries.map((e) => e.type), ['phase_start', 'error']);
    assert.strictEqual(entries[1].failure.debug_detail, 'debug detail for logs only');

    const progress = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(progress.status, 'failed');
    assert.ok(!('debug_detail' in progress.last_failure), 'debug_detail은 progress.last_failure로 승격하지 않음');
  } finally {
    rmDir(dir);
  }
});

test('standard-writer error — public summary에서 raw debug/private path 후보 제거', () => {
  const dir = makeTmpDir();
  const resultPath = path.join(dir, 'do-result.md');
  try {
    const workspacePath = '~/multica_workspaces/2ce97239-6237-460e-b450-3893ab82fbcb/6658612f/workdir/built';
    const token = 'plain-public-token';

    const writer = createStandardWriter({
      runtimeRoot: dir,
      phase: 'do',
      featureId: 'public-boundary',
      resultOutputPath: resultPath,
    });

    writer.handleEvent({ type: 'phase_start', provider: 'codex' });
    writer.handleEvent({
      type: 'error',
      message: `raw error token: ${token} path: ${workspacePath}`,
      failure: {
        kind: 'unknown',
        code: 'codex_unknown',
        user_message: `사용자 요약 token: ${token}`,
        action: `로그에서 확인: ${workspacePath}`,
        debug_detail: `raw token=${token} path=${workspacePath}`,
        retryable: false,
        blocked: false,
      },
    });

    const progress = readJson(path.join(dir, 'progress.json'));
    const progressContent = JSON.stringify(progress, null, 2);
    const resultContent = fs.readFileSync(resultPath, 'utf8');
    const combined = `${progressContent}\n${resultContent}`;

    assert.ok(!combined.includes(token), `public artifact에 token 노출: ${combined}`);
    assertNoPrivateWorkspacePath(combined);
    assert.ok(!('debug_detail' in progress.last_failure), `progress.last_failure에 debug_detail 필드 노출: ${combined}`);
  } finally {
    rmDir(dir);
  }
});

test('standard-writer success — text_delta와 phase_end public artifact의 민감정보를 마스킹한다', () => {
  const dir = makeTmpDir();
  const resultPath = path.join(dir, 'do-result.md');
  try {
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz1234567890';
    const chatId = '1234567890';
    const workspacePath = '~/multica_workspaces/2ce97239-6237-460e-b450-3893ab82fbcb/6658612f/workdir/built';
    const sensitiveText = `작업 중 token=${secret} chat_id=${chatId} path=${workspacePath}`;
    const sensitiveResult = `완료 token=${secret} chat_id=${chatId} path=${workspacePath}`;

    const writer = createStandardWriter({
      runtimeRoot: dir,
      phase: 'do',
      featureId: 'standard-success-redaction',
      resultOutputPath: resultPath,
    });

    writer.handleEvent({ type: 'phase_start', provider: 'codex', model: 'gpt-5.5' });
    writer.handleEvent({ type: 'text_delta', text: sensitiveText });
    writer.handleEvent({ type: 'phase_end', status: 'completed', result: sensitiveResult, duration_ms: 1000 });

    const progressContent = fs.readFileSync(path.join(dir, 'progress.json'), 'utf8');
    const resultContent = fs.readFileSync(resultPath, 'utf8');
    const logContent = fs.readFileSync(path.join(dir, 'logs', 'do.jsonl'), 'utf8');
    const combined = `${progressContent}\n${resultContent}\n${logContent}`;

    assert.ok(!combined.includes(secret), `standard-writer public artifact에 secret 노출: ${combined}`);
    assert.ok(!combined.includes(chatId), `standard-writer public artifact에 chat_id 노출: ${combined}`);
    assertNoPrivateWorkspacePath(combined);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// 결과
// ---------------------------------------------------------------------------

console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
if (failed > 0) process.exit(1);
