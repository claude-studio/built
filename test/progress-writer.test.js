#!/usr/bin/env node
/**
 * test/progress-writer.test.js
 *
 * progress-writer.js 단위 테스트 (Node.js assert + fs만 사용, 외부 패키지 없음)
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const { createWriter } = require('../src/progress-writer');
const { parse }        = require('../src/frontmatter');

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

/** 테스트용 임시 디렉토리 생성 */
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pw-test-'));
}

/** 디렉토리 재귀 삭제 */
function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** JSON 파일 읽기 */
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ---------------------------------------------------------------------------
// createWriter 인자 검증
// ---------------------------------------------------------------------------

console.log('\n[createWriter] 인자 검증');

test('runtimeRoot 미제공 시 TypeError', () => {
  assert.throws(
    () => createWriter({ featureId: 'f1' }),
    (e) => e instanceof TypeError && /runtimeRoot/.test(e.message)
  );
});

test('featureId 미제공 시 TypeError', () => {
  assert.throws(
    () => createWriter({ runtimeRoot: path.join(os.tmpdir(), 'x') }),
    (e) => e instanceof TypeError && /featureId/.test(e.message)
  );
});

test('정상 옵션으로 writer 객체 반환', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    assert.strictEqual(typeof w.handleLine,  'function');
    assert.strictEqual(typeof w.handleEvent, 'function');
    assert.strictEqual(typeof w.close,       'function');
    assert.strictEqual(typeof w.getProgress, 'function');
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// system 이벤트
// ---------------------------------------------------------------------------

console.log('\n[handleEvent] system 이벤트');

test('system/init 이벤트: progress.json 생성', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat', phase: 'do' });
    w.handleEvent({ type: 'system', subtype: 'init', session_id: 'sess_abc' });

    const p = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(p.feature,    'feat');
    assert.strictEqual(p.phase,      'do');
    assert.strictEqual(p.session_id, 'sess_abc');
    assert.strictEqual(p.turn,       0);
  } finally {
    rmDir(dir);
  }
});

test('system/init: session_id가 없어도 null로 처리', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    w.handleEvent({ type: 'system', subtype: 'init' });

    const p = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(p.session_id, null);
  } finally {
    rmDir(dir);
  }
});

test('system 이벤트: logs/do.jsonl에 원본 append', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat', phase: 'do' });
    const ev = { type: 'system', subtype: 'init', session_id: 'x' };
    w.handleEvent(ev);

    const logFile = path.join(dir, 'logs', 'do.jsonl');
    assert.ok(fs.existsSync(logFile), 'do.jsonl 존재해야 함');
    const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    assert.strictEqual(lines.length, 1);
    assert.deepStrictEqual(JSON.parse(lines[0]), ev);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// assistant 이벤트
// ---------------------------------------------------------------------------

console.log('\n[handleEvent] assistant 이벤트');

test('assistant 이벤트: turn 카운트 증가', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    w.handleEvent({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello' }], usage: {} },
    });
    const p = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(p.turn, 1);
  } finally {
    rmDir(dir);
  }
});

test('assistant 이벤트: last_text 200자 제한', () => {
  const dir = makeTmpDir();
  try {
    const w   = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    const longText = 'A'.repeat(300);
    w.handleEvent({
      type: 'assistant',
      message: { content: [{ type: 'text', text: longText }], usage: {} },
    });
    const p = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(p.last_text.length, 200);
  } finally {
    rmDir(dir);
  }
});

test('assistant 이벤트: tool_use 카운트 증가', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    w.handleEvent({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'bash' },
          { type: 'tool_use', name: 'read' },
        ],
        usage: {},
      },
    });
    const p = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(p.tool_calls, 2);
  } finally {
    rmDir(dir);
  }
});

test('assistant 이벤트: 토큰 누적', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    w.handleEvent({
      type: 'assistant',
      message: { content: [], usage: { input_tokens: 100, output_tokens: 50 } },
    });
    w.handleEvent({
      type: 'assistant',
      message: { content: [], usage: { input_tokens: 200, output_tokens: 80 } },
    });
    const p = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(p.input_tokens,  300);
    assert.strictEqual(p.output_tokens, 130);
  } finally {
    rmDir(dir);
  }
});

test('assistant 이벤트: 여러 번 보내면 turn이 누적됨', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    w.handleEvent({ type: 'assistant', message: { content: [], usage: {} } });
    w.handleEvent({ type: 'assistant', message: { content: [], usage: {} } });
    w.handleEvent({ type: 'assistant', message: { content: [], usage: {} } });
    const p = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(p.turn, 3);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// user 이벤트
// ---------------------------------------------------------------------------

console.log('\n[handleEvent] user 이벤트');

test('user 이벤트: progress.json 갱신 (turn 증가 없음)', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    w.handleEvent({ type: 'user', message: { content: [{ type: 'text', text: 'hi' }] } });
    const p = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(p.turn, 0, 'user 이벤트는 turn을 증가시키지 않아야 함');
    assert.ok(p.updated_at, 'updated_at 존재해야 함');
  } finally {
    rmDir(dir);
  }
});

test('user 이벤트: logs에 append됨', () => {
  const dir = makeTmpDir();
  try {
    const w  = createWriter({ runtimeRoot: dir, featureId: 'feat', phase: 'do' });
    const ev = { type: 'user', message: { content: [] } };
    w.handleEvent(ev);
    const lines = fs.readFileSync(path.join(dir, 'logs', 'do.jsonl'), 'utf8').trim().split('\n');
    assert.deepStrictEqual(JSON.parse(lines[0]), ev);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// tool_result 이벤트
// ---------------------------------------------------------------------------

console.log('\n[handleEvent] tool_result 이벤트');

test('tool_result 이벤트: progress.json 갱신됨', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    w.handleEvent({ type: 'tool_result', content: 'ok' });
    assert.ok(fs.existsSync(path.join(dir, 'progress.json')));
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// result 이벤트
// ---------------------------------------------------------------------------

console.log('\n[handleEvent] result 이벤트');

test('result/success 이벤트: progress에 status=completed', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    w.handleEvent({
      type: 'result',
      subtype: 'success',
      total_cost_usd: 0.05,
      result: 'Done!',
    });
    const p = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(p.status,   'completed');
    assert.strictEqual(p.cost_usd, 0.05);
    assert.strictEqual(p.result,   'Done!');
  } finally {
    rmDir(dir);
  }
});

test('result/error 이벤트: progress에 status=failed', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    w.handleEvent({
      type: 'result',
      subtype: 'error',
      is_error: true,
      result: 'Something went wrong',
    });
    const p = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(p.status, 'failed');
  } finally {
    rmDir(dir);
  }
});

test('result 이벤트: is_error=true면 failed', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    w.handleEvent({ type: 'result', is_error: true });
    const p = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(p.status, 'failed');
  } finally {
    rmDir(dir);
  }
});

test('result 이벤트: usage 필드 반영', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    w.handleEvent({
      type: 'result',
      subtype: 'success',
      total_cost_usd: 0.1,
      usage: { input_tokens: 500, output_tokens: 200 },
    });
    const p = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(p.input_tokens,  500);
    assert.strictEqual(p.output_tokens, 200);
  } finally {
    rmDir(dir);
  }
});

test('result 이벤트: resultOutputPath 제공 시 do-result.md 생성', () => {
  const dir      = makeTmpDir();
  const outDir   = makeTmpDir();
  const outPath  = path.join(outDir, 'do-result.md');
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat', resultOutputPath: outPath });
    w.handleEvent({
      type: 'result',
      subtype: 'success',
      total_cost_usd: 0.02,
      result: 'All done.',
      model: 'claude-opus-4-6',
    });
    assert.ok(fs.existsSync(outPath), 'do-result.md 파일이 생성되어야 함');
    const { data, content } = parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(data.feature_id, 'feat');
    assert.strictEqual(data.status,     'completed');
    assert.strictEqual(content.trim(),  'All done.');
  } finally {
    rmDir(dir);
    rmDir(outDir);
  }
});

test('result 이벤트: resultOutputPath 미제공 시 do-result.md 미생성 (오류 없음)', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    assert.doesNotThrow(() => {
      w.handleEvent({ type: 'result', subtype: 'success' });
    });
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// 알 수 없는 이벤트 타입
// ---------------------------------------------------------------------------

console.log('\n[handleEvent] 알 수 없는 타입');

test('알 수 없는 type: 오류 없이 무시', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    assert.doesNotThrow(() => {
      w.handleEvent({ type: 'unknown_future_type', data: 'whatever' });
    });
  } finally {
    rmDir(dir);
  }
});

test('알 수 없는 type: logs에는 기록됨', () => {
  const dir = makeTmpDir();
  try {
    const w  = createWriter({ runtimeRoot: dir, featureId: 'feat', phase: 'do' });
    const ev = { type: 'unknown_future_type' };
    w.handleEvent(ev);
    const log = path.join(dir, 'logs', 'do.jsonl');
    assert.ok(fs.existsSync(log));
    const line = fs.readFileSync(log, 'utf8').trim();
    assert.deepStrictEqual(JSON.parse(line), ev);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// handleLine
// ---------------------------------------------------------------------------

console.log('\n[handleLine]');

test('유효한 JSON 줄: 이벤트 처리', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    w.handleLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sid' }));
    const p = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(p.session_id, 'sid');
  } finally {
    rmDir(dir);
  }
});

test('빈 줄: 무시 (오류 없음)', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    assert.doesNotThrow(() => {
      w.handleLine('');
      w.handleLine('   ');
    });
  } finally {
    rmDir(dir);
  }
});

test('잘못된 JSON 줄: raw-error.log에 기록', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat', phase: 'do' });
    w.handleLine('not-json{broken');
    const errLog = path.join(dir, 'logs', 'raw-error.log');
    assert.ok(fs.existsSync(errLog), 'raw-error.log가 생성되어야 함');
    const content = fs.readFileSync(errLog, 'utf8');
    assert.ok(content.includes('not-json{broken'));
  } finally {
    rmDir(dir);
  }
});

test('여러 줄 연속 처리: turn 누적', () => {
  const dir = makeTmpDir();
  try {
    const w    = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    const lines = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      { type: 'assistant', message: { content: [], usage: {} } },
      { type: 'assistant', message: { content: [], usage: {} } },
    ];
    for (const ev of lines) w.handleLine(JSON.stringify(ev));
    const p = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(p.turn, 2);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// close
// ---------------------------------------------------------------------------

console.log('\n[close]');

test('close: result 없이 종료 시 progress.json에 status=crashed', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    // result 이벤트 없이 close 호출 (stdin 비정상 종료 시뮬레이션)
    w.close();
    const progress = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(progress.status, 'crashed');
  } finally {
    rmDir(dir);
  }
});

test('close: result 이벤트 후 호출 시 progress.json 상태 변경 없음', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    w.handleEvent({ type: 'result', subtype: 'success', result: 'done' });
    const progressBefore = readJson(path.join(dir, 'progress.json'));
    w.close();
    const progressAfter = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(progressAfter.status, progressBefore.status, '상태가 변경되지 않아야 함');
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// getProgress
// ---------------------------------------------------------------------------

console.log('\n[getProgress]');

test('getProgress: 초기 상태 반환', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'my-feature', phase: 'check' });
    const p = w.getProgress();
    assert.strictEqual(p.feature, 'my-feature');
    assert.strictEqual(p.phase,   'check');
    assert.strictEqual(p.turn,    0);
  } finally {
    rmDir(dir);
  }
});

test('getProgress: 이벤트 처리 후 최신 상태 반환', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    w.handleEvent({ type: 'assistant', message: { content: [], usage: { input_tokens: 10, output_tokens: 5 } } });
    const p = w.getProgress();
    assert.strictEqual(p.turn,          1);
    assert.strictEqual(p.input_tokens,  10);
    assert.strictEqual(p.output_tokens, 5);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// atomic write 검증
// ---------------------------------------------------------------------------

console.log('\n[atomic write]');

test('progress.json: 이벤트마다 덮어씌워짐 (누적 아님)', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    w.handleEvent({ type: 'system', subtype: 'init', session_id: 'a' });
    w.handleEvent({ type: 'system', subtype: 'init', session_id: 'b' });
    const p = readJson(path.join(dir, 'progress.json'));
    // 두 번째 system/init에서 session_id가 'b'로 업데이트되어야 함
    assert.strictEqual(p.session_id, 'b');
  } finally {
    rmDir(dir);
  }
});

test('logs/<phase>.jsonl: 이벤트가 누적 append됨', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat', phase: 'do' });
    w.handleEvent({ type: 'system', subtype: 'init' });
    w.handleEvent({ type: 'assistant', message: { content: [], usage: {} } });
    w.handleEvent({ type: 'result', subtype: 'success' });
    const lines = fs.readFileSync(path.join(dir, 'logs', 'do.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean);
    assert.strictEqual(lines.length, 3);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// phase 옵션
// ---------------------------------------------------------------------------

console.log('\n[phase 옵션]');

test('phase=check이면 logs/check.jsonl에 기록', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat', phase: 'check' });
    w.handleEvent({ type: 'system', subtype: 'init' });
    assert.ok(fs.existsSync(path.join(dir, 'logs', 'check.jsonl')));
    assert.ok(!fs.existsSync(path.join(dir, 'logs', 'do.jsonl')));
  } finally {
    rmDir(dir);
  }
});

test('phase 기본값은 do', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    w.handleEvent({ type: 'system', subtype: 'init' });
    assert.ok(fs.existsSync(path.join(dir, 'logs', 'do.jsonl')));
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// null / undefined 이벤트 방어
// ---------------------------------------------------------------------------

console.log('\n[방어 코드]');

test('handleEvent(null): 오류 없이 무시', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    assert.doesNotThrow(() => w.handleEvent(null));
  } finally {
    rmDir(dir);
  }
});

test('handleEvent(문자열): 오류 없이 무시', () => {
  const dir = makeTmpDir();
  try {
    const w = createWriter({ runtimeRoot: dir, featureId: 'feat' });
    assert.doesNotThrow(() => w.handleEvent('not-an-object'));
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// 결과 출력
// ---------------------------------------------------------------------------

console.log(`\n총 ${passed + failed}개 테스트: ${passed}개 통과, ${failed}개 실패\n`);
if (failed > 0) process.exit(1);
