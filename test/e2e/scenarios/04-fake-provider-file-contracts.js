#!/usr/bin/env node
/**
 * test/e2e/scenarios/04-fake-provider-file-contracts.js
 *
 * E2E 시나리오 4: fake provider 기반 file contract 검증
 *
 * 검증 내용:
 *   - fake-claude 이벤트 시퀀스(Claude raw → normalizeClaude → standard-writer) 실행
 *   - fake-codex 이벤트 시퀀스(표준 이벤트 → normalizeCodex → standard-writer) 실행
 *   - 두 provider 모두 progress.json / do-result.md 필수 키/파일 위치 동일 확인
 *   - tool_call/tool_result ordering 및 error 후 종료 규칙 검증
 *
 * 오프라인 실행 가능: 실제 Claude/Codex 호출 없음.
 * 외부 npm 패키지 없음 (Node.js 내장 fs/os/path/assert만 사용).
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const BUILT_ROOT = path.join(__dirname, '..', '..', '..');

const { normalizeClaude: nClaude, normalizeCodex: nCodex,
        checkOrderingRules, checkToolPairing } =
  require(path.join(BUILT_ROOT, 'src', 'providers', 'event-normalizer'));

const { createStandardWriter: createWriter } =
  require(path.join(BUILT_ROOT, 'src', 'providers', 'standard-writer'));

const { parse: parseFrontmatter } =
  require(path.join(BUILT_ROOT, 'src', 'frontmatter'));

// ---------------------------------------------------------------------------
// 테스트 러너
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL ${name}`);
    console.log(`       ${e.message}`);
    failed++;
  }
}

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), (prefix || 'e2e') + '-'));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ---------------------------------------------------------------------------
// fake provider 이벤트 시퀀스
// ---------------------------------------------------------------------------

/**
 * fake Claude raw 이벤트 시퀀스.
 * 실제 Claude CLI 없이 정상 do phase 흐름을 시뮬레이션한다.
 */
const FAKE_CLAUDE_RAW_EVENTS = [
  { type: 'system', subtype: 'init', session_id: 'sess-claude-001', model: 'claude-opus-4-5' },
  {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: '기능 구현을 시작합니다.' }],
      usage:   { input_tokens: 200, output_tokens: 50 },
    },
  },
  {
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: 'tu_write_1', name: 'Write', input: { path: 'src/auth.js' } },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
    },
  },
  { type: 'tool_result', tool_use_id: 'tu_write_1' },
  {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: '구현이 완료되었습니다.' }],
      usage:   { input_tokens: 50, output_tokens: 30 },
    },
  },
  {
    type:           'result',
    subtype:        'success',
    result:         '# 구현 완료\n\nsrc/auth.js 파일 생성 완료.',
    total_cost_usd: 0.0042,
    duration_ms:    12000,
  },
];

/**
 * fake Codex 표준 이벤트 시퀀스.
 * 동일한 논리적 흐름을 Codex 표준 이벤트로 표현한다.
 */
const FAKE_CODEX_STANDARD_EVENTS = [
  {
    type:      'phase_start',
    provider:  'codex',
    model:     'gpt-5.5',
    timestamp: '2026-04-26T00:00:00.000Z',
  },
  {
    type:      'text_delta',
    text:      '기능 구현을 시작합니다.',
    timestamp: '2026-04-26T00:00:01.000Z',
  },
  {
    type:      'tool_call',
    id:        'cmd_1',
    name:      'commandExecution',
    summary:   'src/auth.js 파일 생성',
    timestamp: '2026-04-26T00:00:02.000Z',
  },
  {
    type:      'tool_result',
    id:        'cmd_1',
    name:      'commandExecution',
    status:    'completed',
    exit_code: 0,
    timestamp: '2026-04-26T00:00:08.000Z',
  },
  {
    type:          'usage',
    input_tokens:  260,
    output_tokens: 100,
    cost_usd:      null,
    timestamp:     '2026-04-26T00:01:00.000Z',
  },
  {
    type:      'text_delta',
    text:      '구현이 완료되었습니다.',
    timestamp: '2026-04-26T00:01:01.000Z',
  },
  {
    type:        'phase_end',
    status:      'completed',
    duration_ms: 12000,
    result:      '# 구현 완료\n\nsrc/auth.js 파일 생성 완료.',
    timestamp:   '2026-04-26T00:01:02.000Z',
  },
];

// ---------------------------------------------------------------------------
// 표준 이벤트 파이프라인 실행 헬퍼
// ---------------------------------------------------------------------------

/**
 * 이벤트 배열을 standard-writer로 처리하고 progress.json + do-result.md를 기록한다.
 *
 * @param {string} tmpDir          임시 디렉토리
 * @param {string} providerName    'fake-claude' | 'fake-codex'
 * @param {Array}  standardEvents  normalize된 표준 이벤트 배열
 * @returns {{ progressPath: string, resultPath: string, logPath: string }}
 */
function runWithStandardWriter(tmpDir, providerName, standardEvents) {
  const runtimeRoot      = path.join(tmpDir, providerName);
  const resultOutputPath = path.join(runtimeRoot, 'do-result.md');

  fs.mkdirSync(runtimeRoot, { recursive: true });

  const writer = createWriter({
    runtimeRoot,
    phase:        'do',
    featureId:    'user-auth',
    resultOutputPath,
  });

  for (const event of standardEvents) {
    writer.handleEvent(event);
  }
  writer.close();

  return {
    progressPath: path.join(runtimeRoot, 'progress.json'),
    resultPath:   resultOutputPath,
    logPath:      path.join(runtimeRoot, 'logs', 'do.jsonl'),
  };
}

// ---------------------------------------------------------------------------
// 시나리오
// ---------------------------------------------------------------------------

console.log('\n[E2E] 시나리오 4: fake provider 기반 file contract 검증\n');

async function main() {

  // -------------------------------------------------------------------------
  // 1. fake-claude: raw events → normalizeClaude → standard-writer
  // -------------------------------------------------------------------------

  await test('fake-claude: progress.json 필수 필드 존재', async () => {
    const dir = makeTmpDir('e2e-fake-claude');
    try {
      const standardEvents = FAKE_CLAUDE_RAW_EVENTS.flatMap(nClaude);

      const violations = checkOrderingRules(standardEvents);
      assert.strictEqual(violations.length, 0, `순서 규칙 위반: ${violations}`);

      const { progressPath } = runWithStandardWriter(dir, 'fake-claude', standardEvents);

      assert.ok(fs.existsSync(progressPath), 'progress.json 존재');
      const progress = readJson(progressPath);

      const REQUIRED = ['feature', 'phase', 'session_id', 'turn', 'tool_calls',
                        'last_text', 'cost_usd', 'input_tokens', 'output_tokens',
                        'started_at', 'updated_at'];
      for (const key of REQUIRED) {
        assert.ok(key in progress, `progress.json 필드 누락: ${key}`);
      }
    } finally {
      rmDir(dir);
    }
  });

  await test('fake-claude: progress.json 값 계약 (session_id, turn, tool_calls, status)', async () => {
    const dir = makeTmpDir('e2e-fake-claude-val');
    try {
      const standardEvents = FAKE_CLAUDE_RAW_EVENTS.flatMap(nClaude);
      const { progressPath } = runWithStandardWriter(dir, 'fake-claude', standardEvents);

      const progress = readJson(progressPath);
      assert.strictEqual(progress.feature,    'user-auth');
      assert.strictEqual(progress.phase,      'do');
      assert.strictEqual(progress.session_id, 'sess-claude-001');
      assert.ok(progress.turn > 0,       `turn > 0, got: ${progress.turn}`);
      assert.ok(progress.tool_calls > 0, `tool_calls > 0, got: ${progress.tool_calls}`);
      assert.strictEqual(progress.status, 'completed');
    } finally {
      rmDir(dir);
    }
  });

  await test('fake-claude: do-result.md 필수 frontmatter 필드 존재', async () => {
    const dir = makeTmpDir('e2e-fake-claude-result');
    try {
      const standardEvents = FAKE_CLAUDE_RAW_EVENTS.flatMap(nClaude);
      const { resultPath } = runWithStandardWriter(dir, 'fake-claude', standardEvents);

      assert.ok(fs.existsSync(resultPath), 'do-result.md 존재');
      const content = fs.readFileSync(resultPath, 'utf8');
      const { data } = parseFrontmatter(content);

      const REQUIRED = ['feature_id', 'status', 'model', 'cost_usd', 'duration_ms', 'created_at'];
      for (const key of REQUIRED) {
        assert.ok(key in data, `do-result.md frontmatter 필드 누락: ${key}`);
      }
      assert.strictEqual(data.feature_id, 'user-auth');
      assert.strictEqual(data.status, 'completed');
    } finally {
      rmDir(dir);
    }
  });

  await test('fake-claude: logs/do.jsonl에 표준 이벤트가 append됨', async () => {
    const dir = makeTmpDir('e2e-fake-claude-log');
    try {
      const standardEvents = FAKE_CLAUDE_RAW_EVENTS.flatMap(nClaude);
      const { logPath } = runWithStandardWriter(dir, 'fake-claude', standardEvents);

      assert.ok(fs.existsSync(logPath), 'logs/do.jsonl 존재');
      const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
      assert.strictEqual(lines.length, standardEvents.length, '표준 이벤트 수만큼 log line 존재');
      const entries = lines.map((line) => JSON.parse(line));
      assert.strictEqual(entries[0].type, 'phase_start');
      assert.strictEqual(entries[entries.length - 1].type, 'phase_end');
    } finally {
      rmDir(dir);
    }
  });

  // -------------------------------------------------------------------------
  // 2. fake-codex: standard events → normalizeCodex → standard-writer
  // -------------------------------------------------------------------------

  await test('fake-codex: progress.json 필수 필드 존재', async () => {
    const dir = makeTmpDir('e2e-fake-codex');
    try {
      const standardEvents = FAKE_CODEX_STANDARD_EVENTS.flatMap(nCodex);

      const violations = checkOrderingRules(standardEvents);
      assert.strictEqual(violations.length, 0, `순서 규칙 위반: ${violations}`);

      const { progressPath } = runWithStandardWriter(dir, 'fake-codex', standardEvents);

      assert.ok(fs.existsSync(progressPath), 'progress.json 존재');
      const progress = readJson(progressPath);

      const REQUIRED = ['feature', 'phase', 'session_id', 'turn', 'tool_calls',
                        'last_text', 'cost_usd', 'input_tokens', 'output_tokens',
                        'started_at', 'updated_at'];
      for (const key of REQUIRED) {
        assert.ok(key in progress, `progress.json 필드 누락: ${key}`);
      }
    } finally {
      rmDir(dir);
    }
  });

  await test('fake-codex: progress.json 값 계약 (turn, tool_calls, status)', async () => {
    const dir = makeTmpDir('e2e-fake-codex-val');
    try {
      const standardEvents = FAKE_CODEX_STANDARD_EVENTS.flatMap(nCodex);
      const { progressPath } = runWithStandardWriter(dir, 'fake-codex', standardEvents);

      const progress = readJson(progressPath);
      assert.strictEqual(progress.feature,    'user-auth');
      assert.strictEqual(progress.phase,      'do');
      assert.ok(progress.turn > 0,       `turn > 0, got: ${progress.turn}`);
      assert.ok(progress.tool_calls > 0, `tool_calls > 0, got: ${progress.tool_calls}`);
      assert.strictEqual(progress.status, 'completed');
    } finally {
      rmDir(dir);
    }
  });

  await test('fake-codex: do-result.md 필수 frontmatter 필드 존재', async () => {
    const dir = makeTmpDir('e2e-fake-codex-result');
    try {
      const standardEvents = FAKE_CODEX_STANDARD_EVENTS.flatMap(nCodex);
      const { resultPath } = runWithStandardWriter(dir, 'fake-codex', standardEvents);

      assert.ok(fs.existsSync(resultPath), 'do-result.md 존재');
      const content = fs.readFileSync(resultPath, 'utf8');
      const { data } = parseFrontmatter(content);

      const REQUIRED = ['feature_id', 'status', 'model', 'cost_usd', 'duration_ms', 'created_at'];
      for (const key of REQUIRED) {
        assert.ok(key in data, `do-result.md frontmatter 필드 누락: ${key}`);
      }
      assert.strictEqual(data.feature_id, 'user-auth');
      assert.strictEqual(data.status, 'completed');
    } finally {
      rmDir(dir);
    }
  });

  await test('fake-codex: logs/do.jsonl에 표준 이벤트가 append됨', async () => {
    const dir = makeTmpDir('e2e-fake-codex-log');
    try {
      const standardEvents = FAKE_CODEX_STANDARD_EVENTS.flatMap(nCodex);
      const { logPath } = runWithStandardWriter(dir, 'fake-codex', standardEvents);

      assert.ok(fs.existsSync(logPath), 'logs/do.jsonl 존재');
      const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
      assert.strictEqual(lines.length, standardEvents.length, '표준 이벤트 수만큼 log line 존재');
      const entries = lines.map((line) => JSON.parse(line));
      assert.strictEqual(entries[0].type, 'phase_start');
      assert.strictEqual(entries[entries.length - 1].type, 'phase_end');
      assert.strictEqual(entries[0].provider, 'codex');
    } finally {
      rmDir(dir);
    }
  });

  // -------------------------------------------------------------------------
  // 3. 두 provider 산출물 필수 구조 동일성 비교
  // -------------------------------------------------------------------------

  await test('fake-claude vs fake-codex: progress.json 필수 키 동일', async () => {
    const dir = makeTmpDir('e2e-compare');
    try {
      const claudeEvents = FAKE_CLAUDE_RAW_EVENTS.flatMap(nClaude);
      const codexEvents  = FAKE_CODEX_STANDARD_EVENTS.flatMap(nCodex);

      const { progressPath: claudeProgressPath } =
        runWithStandardWriter(dir, 'fake-claude', claudeEvents);
      const { progressPath: codexProgressPath  } =
        runWithStandardWriter(dir, 'fake-codex',  codexEvents);

      const claudeProgress = readJson(claudeProgressPath);
      const codexProgress  = readJson(codexProgressPath);

      const REQUIRED = ['feature', 'phase', 'session_id', 'turn', 'tool_calls',
                        'last_text', 'cost_usd', 'input_tokens', 'output_tokens',
                        'started_at', 'updated_at', 'status'];

      for (const key of REQUIRED) {
        assert.ok(key in claudeProgress, `Claude progress.json 필드 누락: ${key}`);
        assert.ok(key in codexProgress,  `Codex  progress.json 필드 누락: ${key}`);
      }

      assert.strictEqual(claudeProgress.feature, codexProgress.feature, 'feature 동일');
      assert.strictEqual(claudeProgress.phase,   codexProgress.phase,   'phase 동일');
      assert.strictEqual(claudeProgress.status,  codexProgress.status,
        `status 동일 (claude=${claudeProgress.status}, codex=${codexProgress.status})`);
    } finally {
      rmDir(dir);
    }
  });

  await test('fake-claude vs fake-codex: do-result.md 필수 frontmatter 키 동일', async () => {
    const dir = makeTmpDir('e2e-compare-result');
    try {
      const claudeEvents = FAKE_CLAUDE_RAW_EVENTS.flatMap(nClaude);
      const codexEvents  = FAKE_CODEX_STANDARD_EVENTS.flatMap(nCodex);

      const { resultPath: claudeResultPath } =
        runWithStandardWriter(dir, 'fake-claude', claudeEvents);
      const { resultPath: codexResultPath  } =
        runWithStandardWriter(dir, 'fake-codex',  codexEvents);

      assert.ok(fs.existsSync(claudeResultPath), 'Claude do-result.md 존재');
      assert.ok(fs.existsSync(codexResultPath),  'Codex  do-result.md 존재');

      const claudeData = parseFrontmatter(fs.readFileSync(claudeResultPath, 'utf8')).data;
      const codexData  = parseFrontmatter(fs.readFileSync(codexResultPath,  'utf8')).data;

      const REQUIRED = ['feature_id', 'status', 'model', 'cost_usd', 'duration_ms', 'created_at'];
      for (const key of REQUIRED) {
        assert.ok(key in claudeData, `Claude do-result.md 필드 누락: ${key}`);
        assert.ok(key in codexData,  `Codex  do-result.md 필드 누락: ${key}`);
      }

      assert.strictEqual(claudeData.feature_id, codexData.feature_id, 'feature_id 동일');
      assert.strictEqual(claudeData.status,     codexData.status,     'status 동일');
    } finally {
      rmDir(dir);
    }
  });

  // -------------------------------------------------------------------------
  // 4. tool_call/tool_result ordering 검증
  // -------------------------------------------------------------------------

  await test('tool_call/tool_result 짝: fake-claude 시퀀스에서 짝 맞음', async () => {
    const standardEvents = FAKE_CLAUDE_RAW_EVENTS.flatMap(nClaude);
    const { unpaired_calls, unpaired_results } = checkToolPairing(standardEvents);
    assert.strictEqual(unpaired_calls.length, 0,
      `짝 없는 tool_call: ${unpaired_calls}`);
    assert.strictEqual(unpaired_results.length, 0,
      `짝 없는 tool_result: ${unpaired_results}`);
  });

  await test('tool_call/tool_result 짝: fake-codex 시퀀스에서 짝 맞음', async () => {
    const standardEvents = FAKE_CODEX_STANDARD_EVENTS.flatMap(nCodex);
    const { unpaired_calls, unpaired_results } = checkToolPairing(standardEvents);
    assert.strictEqual(unpaired_calls.length, 0,
      `짝 없는 tool_call: ${unpaired_calls}`);
    assert.strictEqual(unpaired_results.length, 0,
      `짝 없는 tool_result: ${unpaired_results}`);
  });

  // -------------------------------------------------------------------------
  // 5. error 후 종료 규칙
  // -------------------------------------------------------------------------

  await test('error 이벤트 후 progress.json status=failed, do-result.md status=failed', async () => {
    const dir = makeTmpDir('e2e-error');
    try {
      const rawErrorEvents = [
        { type: 'system', subtype: 'init', session_id: 'sess-err', model: 'claude-opus-4-5' },
        { type: 'assistant', message: { content: [{ type: 'text', text: '작업 시도' }], usage: {} } },
        { type: 'result', subtype: 'error', is_error: true, result: 'do.js exited with code 1' },
      ];

      const standardEvents = rawErrorEvents.flatMap(nClaude);

      const violations = checkOrderingRules(standardEvents);
      assert.strictEqual(violations.length, 0, `순서 규칙 위반: ${violations}`);

      const hasError = standardEvents.some((e) => e.type === 'error');
      assert.ok(hasError, 'error 이벤트 존재');

      const runtimeRoot      = path.join(dir, 'fake-claude-err');
      const resultOutputPath = path.join(runtimeRoot, 'do-result.md');
      fs.mkdirSync(runtimeRoot, { recursive: true });

      const writer = createWriter({ runtimeRoot, phase: 'do', featureId: 'err-feat', resultOutputPath });
      for (const event of standardEvents) writer.handleEvent(event);
      writer.close();

      const progress = readJson(path.join(runtimeRoot, 'progress.json'));
      assert.strictEqual(progress.status, 'failed', `status=failed 예상, got: ${progress.status}`);

      assert.ok(fs.existsSync(resultOutputPath), 'do-result.md 존재 (error 시에도)');
      const resultData = parseFrontmatter(fs.readFileSync(resultOutputPath, 'utf8')).data;
      assert.strictEqual(resultData.status, 'failed');

      const logPath = path.join(runtimeRoot, 'logs', 'do.jsonl');
      assert.ok(fs.existsSync(logPath), 'logs/do.jsonl 존재 (error 시에도)');
      const entries = fs.readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      assert.strictEqual(entries[entries.length - 1].type, 'error');
    } finally {
      rmDir(dir);
    }
  });

  await test('error 이벤트 이후 추가 이벤트 없음 — 순서 규칙 위반 없음', async () => {
    const rawEvents = [
      { type: 'system', subtype: 'init' },
      { type: 'result', is_error: true, result: '실패' },
    ];
    const standardEvents = rawEvents.flatMap(nClaude);
    const violations = checkOrderingRules(standardEvents);
    assert.strictEqual(violations.length, 0, `위반 없어야 함: ${violations}`);
  });

  await test('error 이벤트 후 추가 이벤트 시 순서 위반 감지', async () => {
    const events = [
      { type: 'phase_start', provider: 'codex' },
      { type: 'error', message: '오류' },
      { type: 'text_delta', text: '위반 이벤트' },
    ];
    const violations = checkOrderingRules(events);
    assert.ok(violations.length > 0, '위반 감지해야 함');
  });

  // -------------------------------------------------------------------------
  // 6. standard-writer.close() — phase_end 없이 종료 시 crashed
  // -------------------------------------------------------------------------

  await test('standard-writer.close() — phase_end 없이 종료 시 status=crashed', async () => {
    const dir = makeTmpDir('e2e-crashed');
    try {
      const runtimeRoot = path.join(dir, 'crashed');
      fs.mkdirSync(runtimeRoot, { recursive: true });

      const writer = createWriter({ runtimeRoot, phase: 'do', featureId: 'crash-feat' });
      writer.handleEvent({ type: 'phase_start', provider: 'codex' });
      writer.handleEvent({ type: 'text_delta', text: '진행 중...' });
      writer.close();

      const progress = readJson(path.join(runtimeRoot, 'progress.json'));
      assert.strictEqual(progress.status, 'crashed');
    } finally {
      rmDir(dir);
    }
  });

  // -------------------------------------------------------------------------
  // 결과
  // -------------------------------------------------------------------------

  console.log(`\n  결과: ${passed} 통과, ${failed} 실패\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
