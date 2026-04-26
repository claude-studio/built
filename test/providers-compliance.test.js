#!/usr/bin/env node
/**
 * test/providers-compliance.test.js
 *
 * provider adapter compliance fake 테스트.
 *
 * 신규 provider adapter가 built 계약을 준수하는지 검증하는 테스트 모음.
 * 실제 provider CLI 없이 fake adapter를 사용해 계약 규칙을 검증한다.
 *
 * 검증 항목:
 *   - 파일 직접 쓰기 금지: fs.writeFile/writeFileSync/appendFile/open(w) 사용 시 실패
 *   - 이벤트 순서 규칙: phase_start 없이 시작, terminal 이후 추가 이벤트, error+phase_end 동시 emit 등
 *   - 필수 이벤트 존재: phase_start와 terminal 이벤트(phase_end 또는 error) 필수
 *   - runner/writer 책임 경계: provider가 파일을 쓰면 위반
 *   - 준수 provider: 위 규칙을 모두 지키면 통과
 *
 * 외부 npm 패키지 없음. Node.js assert + fs만 사용.
 * docs/contracts/provider-events.md, docs/providers/new-provider-checklist.md 참고.
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

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
// compliance 검증 헬퍼
// ---------------------------------------------------------------------------

/**
 * provider adapter 함수를 실행하고 표준 이벤트 시퀀스를 수집한다.
 *
 * @param {function} adapterFn  (opts) => Promise<result>
 * @param {object}   opts
 * @returns {Promise<{ result: object, events: object[] }>}
 */
async function runAdapter(adapterFn, opts = {}) {
  const events = [];
  const result = await adapterFn({
    prompt:   opts.prompt   || 'test prompt',
    model:    opts.model    || null,
    sandbox:  opts.sandbox  || 'read-only',
    signal:   opts.signal   || null,
    onEvent:  (ev) => events.push(ev),
    ...opts,
  });
  return { result, events };
}

/**
 * 이벤트 시퀀스가 표준 순서 규칙을 따르는지 검증한다.
 * 위반이 있으면 오류 메시지 배열을 반환한다.
 *
 * 규칙:
 *   1. phase_start가 첫 번째 이벤트여야 한다.
 *   2. terminal 이벤트(phase_end / error)가 정확히 하나 존재해야 한다.
 *   3. terminal 이벤트 이후 추가 이벤트가 없어야 한다.
 *   4. error와 phase_end가 동시에 emit되면 안 된다.
 *
 * @param {object[]} events
 * @returns {string[]}  위반 메시지 배열 (빈 배열 = 준수)
 */
function checkEventOrder(events) {
  const violations = [];

  if (events.length === 0) {
    return ['이벤트가 하나도 emit되지 않았습니다.'];
  }

  // 규칙 1: 첫 이벤트는 phase_start
  if (events[0].type !== 'phase_start') {
    violations.push(`첫 번째 이벤트가 phase_start가 아닙니다: "${events[0].type}"`);
  }

  const TERMINAL_TYPES = new Set(['phase_end', 'error']);

  let terminalIndex = -1;
  let hasPhaseEnd   = false;
  let hasError      = false;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (TERMINAL_TYPES.has(ev.type)) {
      if (terminalIndex === -1) {
        terminalIndex = i;
      }
      if (ev.type === 'phase_end') hasPhaseEnd = true;
      if (ev.type === 'error')     hasError    = true;
    }
  }

  // 규칙 2: terminal 이벤트가 존재해야 함
  if (terminalIndex === -1) {
    violations.push('terminal 이벤트(phase_end 또는 error)가 없습니다.');
  }

  // 규칙 3: terminal 이후 추가 이벤트 없음
  if (terminalIndex !== -1 && terminalIndex < events.length - 1) {
    const afterTypes = events.slice(terminalIndex + 1).map((e) => e.type);
    violations.push(`terminal 이벤트(${events[terminalIndex].type}) 이후 추가 이벤트가 있습니다: [${afterTypes.join(', ')}]`);
  }

  // 규칙 4: error + phase_end 동시 emit 금지
  if (hasPhaseEnd && hasError) {
    violations.push('phase_end와 error가 동시에 emit되었습니다. 둘 중 하나만 허용됩니다.');
  }

  return violations;
}

/**
 * fs 파일 쓰기 함수를 intercept해 provider adapter 실행 중 직접 쓰기를 감지한다.
 *
 * @param {function} adapterFn  테스트할 adapter 함수
 * @param {object}   opts
 * @returns {Promise<{ result: object, events: object[], fileWrites: string[] }>}
 *   fileWrites: 감지된 파일 쓰기 대상 경로 목록
 */
async function runAdapterWithFileGuard(adapterFn, opts = {}) {
  const fileWrites = [];

  // fs 쓰기 함수 intercept
  const originalWriteFile    = fs.writeFile;
  const originalWriteFileSync = fs.writeFileSync;
  const originalAppendFile   = fs.appendFile;
  const originalAppendFileSync = fs.appendFileSync;
  const originalOpen         = fs.open;
  const originalOpenSync     = fs.openSync;

  function recordWrite(filePath) {
    if (filePath && typeof filePath === 'string') {
      fileWrites.push(filePath);
    }
  }

  fs.writeFile     = function(p, ...a) { recordWrite(p); return originalWriteFile.call(fs, p, ...a); };
  fs.writeFileSync = function(p, ...a) { recordWrite(p); return originalWriteFileSync.call(fs, p, ...a); };
  fs.appendFile    = function(p, ...a) { recordWrite(p); return originalAppendFile.call(fs, p, ...a); };
  fs.appendFileSync = function(p, ...a) { recordWrite(p); return originalAppendFileSync.call(fs, p, ...a); };

  // open with write flag
  fs.open = function(p, flags, ...a) {
    if (typeof flags === 'string' && /^[wa]/.test(flags)) recordWrite(p);
    return originalOpen.call(fs, p, flags, ...a);
  };
  fs.openSync = function(p, flags, ...a) {
    if (typeof flags === 'string' && /^[wa]/.test(flags)) recordWrite(p);
    return originalOpenSync.call(fs, p, flags, ...a);
  };

  let result, events;
  try {
    ({ result, events } = await runAdapter(adapterFn, opts));
  } finally {
    fs.writeFile      = originalWriteFile;
    fs.writeFileSync  = originalWriteFileSync;
    fs.appendFile     = originalAppendFile;
    fs.appendFileSync = originalAppendFileSync;
    fs.open           = originalOpen;
    fs.openSync       = originalOpenSync;
  }

  return { result, events, fileWrites };
}

// ---------------------------------------------------------------------------
// Fake provider 정의
// ---------------------------------------------------------------------------

/**
 * 준수 fake provider.
 * 올바른 이벤트 순서를 따르고 파일을 직접 쓰지 않는다.
 */
async function compliantProvider({ prompt, model, onEvent }) {
  if (!prompt) throw new TypeError('compliantProvider: prompt is required');

  function emit(ev) { if (typeof onEvent === 'function') onEvent(ev); }

  emit({ type: 'phase_start', phase: 'do', provider: 'fake-compliant', model: model || null, timestamp: new Date().toISOString() });
  emit({ type: 'text_delta',  phase: 'do', text: '처리 중', timestamp: new Date().toISOString() });
  emit({ type: 'tool_call',   phase: 'do', id: 'tc1', name: 'commandExecution', summary: 'ls 실행', timestamp: new Date().toISOString() });
  emit({ type: 'tool_result', phase: 'do', id: 'tc1', name: 'commandExecution', status: 'completed', exit_code: 0, timestamp: new Date().toISOString() });
  emit({ type: 'phase_end',   phase: 'do', status: 'completed', duration_ms: 100, timestamp: new Date().toISOString() });

  return { success: true, exitCode: 0 };
}

/**
 * 파일 직접 쓰기 위반 fake provider.
 * provider가 파일을 직접 작성하면 안 된다는 계약을 위반한다.
 */
async function fileWritingProvider({ prompt, onEvent }) {
  if (!prompt) throw new TypeError('fileWritingProvider: prompt is required');

  function emit(ev) { if (typeof onEvent === 'function') onEvent(ev); }

  emit({ type: 'phase_start', phase: 'do', provider: 'fake-file-writer', timestamp: new Date().toISOString() });

  // 계약 위반: provider가 파일을 직접 쓴다
  const tmpPath = path.join(os.tmpdir(), `compliance-test-write-${process.pid}.txt`);
  fs.writeFileSync(tmpPath, 'direct write by provider — 위반\n', 'utf8');
  try { fs.unlinkSync(tmpPath); } catch (_) {}

  emit({ type: 'phase_end', phase: 'do', status: 'completed', duration_ms: 10, timestamp: new Date().toISOString() });

  return { success: true, exitCode: 0 };
}

/**
 * phase_start 없이 시작하는 위반 fake provider.
 */
async function noPhaseStartProvider({ prompt, onEvent }) {
  if (!prompt) throw new TypeError('noPhaseStartProvider: prompt is required');

  function emit(ev) { if (typeof onEvent === 'function') onEvent(ev); }

  // 계약 위반: phase_start 없이 바로 text_delta 시작
  emit({ type: 'text_delta', phase: 'do', text: 'hello', timestamp: new Date().toISOString() });
  emit({ type: 'phase_end',  phase: 'do', status: 'completed', duration_ms: 10, timestamp: new Date().toISOString() });

  return { success: true, exitCode: 0 };
}

/**
 * terminal 이벤트 이후 추가 이벤트를 emit하는 위반 fake provider.
 */
async function postTerminalEventProvider({ prompt, onEvent }) {
  if (!prompt) throw new TypeError('postTerminalEventProvider: prompt is required');

  function emit(ev) { if (typeof onEvent === 'function') onEvent(ev); }

  emit({ type: 'phase_start', phase: 'do', provider: 'fake', timestamp: new Date().toISOString() });
  emit({ type: 'phase_end',   phase: 'do', status: 'completed', duration_ms: 10, timestamp: new Date().toISOString() });
  // 계약 위반: terminal 이후 추가 이벤트
  emit({ type: 'text_delta',  phase: 'do', text: 'stale event', timestamp: new Date().toISOString() });

  return { success: true, exitCode: 0 };
}

/**
 * phase_end와 error를 동시에 emit하는 위반 fake provider.
 */
async function doubleTerminalProvider({ prompt, onEvent }) {
  if (!prompt) throw new TypeError('doubleTerminalProvider: prompt is required');

  function emit(ev) { if (typeof onEvent === 'function') onEvent(ev); }

  emit({ type: 'phase_start', phase: 'do', provider: 'fake', timestamp: new Date().toISOString() });
  // 계약 위반: phase_end와 error 둘 다 emit
  emit({ type: 'phase_end',   phase: 'do', status: 'completed', duration_ms: 10, timestamp: new Date().toISOString() });
  emit({ type: 'error',       phase: 'do', message: '오류', retryable: false, timestamp: new Date().toISOString() });

  return { success: false, exitCode: 1 };
}

/**
 * terminal 이벤트 없이 종료하는 위반 fake provider.
 */
async function noTerminalProvider({ prompt, onEvent }) {
  if (!prompt) throw new TypeError('noTerminalProvider: prompt is required');

  function emit(ev) { if (typeof onEvent === 'function') onEvent(ev); }

  emit({ type: 'phase_start', phase: 'do', provider: 'fake', timestamp: new Date().toISOString() });
  emit({ type: 'text_delta',  phase: 'do', text: 'done', timestamp: new Date().toISOString() });
  // 계약 위반: terminal 이벤트(phase_end 또는 error) 없이 종료

  return { success: true, exitCode: 0 };
}

/**
 * AbortSignal을 준수하는 fake provider.
 */
async function abortAwareProvider({ prompt, signal, onEvent }) {
  if (!prompt) throw new TypeError('abortAwareProvider: prompt is required');

  function emit(ev) { if (typeof onEvent === 'function') onEvent(ev); }

  if (signal && signal.aborted) {
    emit({ type: 'error', phase: 'do', message: '취소됨', retryable: false,
           failure: { kind: 'interrupted', code: 'fake_interrupted', user_message: '취소됨',
                      retryable: false, blocked: false, raw_provider: 'fake' },
           timestamp: new Date().toISOString() });
    return { success: false, exitCode: 1, error: '취소됨' };
  }

  emit({ type: 'phase_start', phase: 'do', provider: 'fake-abort-aware', timestamp: new Date().toISOString() });
  emit({ type: 'phase_end',   phase: 'do', status: 'completed', duration_ms: 5, timestamp: new Date().toISOString() });
  return { success: true, exitCode: 0 };
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

async function main() {

  // -------------------------------------------------------------------------
  // 파일 직접 쓰기 금지
  // -------------------------------------------------------------------------

  console.log('\n[파일 직접 쓰기 금지 — runner/writer 책임 경계]');

  await test('준수 provider: 파일 직접 쓰기 없음', async () => {
    const { fileWrites } = await runAdapterWithFileGuard(compliantProvider);
    assert.strictEqual(fileWrites.length, 0, `파일 직접 쓰기 감지됨: [${fileWrites.join(', ')}]`);
  });

  await test('위반 provider(fileWritingProvider): 파일 직접 쓰기 감지됨', async () => {
    const { fileWrites } = await runAdapterWithFileGuard(fileWritingProvider);
    assert.ok(fileWrites.length > 0, '파일 직접 쓰기가 감지되어야 합니다 (계약 위반)');
  });

  // -------------------------------------------------------------------------
  // 이벤트 순서 규칙
  // -------------------------------------------------------------------------

  console.log('\n[이벤트 순서 규칙]');

  await test('준수 provider: 이벤트 순서 위반 없음', async () => {
    const { events } = await runAdapter(compliantProvider);
    const violations = checkEventOrder(events);
    assert.strictEqual(violations.length, 0, `위반: ${violations.join('; ')}`);
  });

  await test('위반 provider(noPhaseStart): 첫 이벤트가 phase_start가 아님', async () => {
    const { events } = await runAdapter(noPhaseStartProvider);
    const violations = checkEventOrder(events);
    assert.ok(violations.length > 0, '순서 위반이 감지되어야 합니다');
    assert.ok(violations.some((v) => v.includes('phase_start')), `위반 내용: ${violations.join('; ')}`);
  });

  await test('위반 provider(postTerminalEvent): terminal 이후 추가 이벤트 감지', async () => {
    const { events } = await runAdapter(postTerminalEventProvider);
    const violations = checkEventOrder(events);
    assert.ok(violations.length > 0, '순서 위반이 감지되어야 합니다');
    assert.ok(violations.some((v) => v.includes('terminal')), `위반 내용: ${violations.join('; ')}`);
  });

  await test('위반 provider(doubleTerminal): phase_end와 error 동시 emit 감지', async () => {
    const { events } = await runAdapter(doubleTerminalProvider);
    const violations = checkEventOrder(events);
    assert.ok(violations.length > 0, '순서 위반이 감지되어야 합니다');
    assert.ok(violations.some((v) => v.includes('동시')), `위반 내용: ${violations.join('; ')}`);
  });

  await test('위반 provider(noTerminal): terminal 이벤트 없음 감지', async () => {
    const { events } = await runAdapter(noTerminalProvider);
    const violations = checkEventOrder(events);
    assert.ok(violations.length > 0, '순서 위반이 감지되어야 합니다');
    assert.ok(violations.some((v) => v.includes('terminal')), `위반 내용: ${violations.join('; ')}`);
  });

  // -------------------------------------------------------------------------
  // 필수 이벤트 존재
  // -------------------------------------------------------------------------

  console.log('\n[필수 이벤트 존재 검증]');

  await test('준수 provider: phase_start 이벤트 존재', async () => {
    const { events } = await runAdapter(compliantProvider);
    assert.ok(events.some((e) => e.type === 'phase_start'), 'phase_start 이벤트가 없습니다');
  });

  await test('준수 provider: terminal 이벤트(phase_end 또는 error) 존재', async () => {
    const { events } = await runAdapter(compliantProvider);
    const TERMINAL = new Set(['phase_end', 'error']);
    assert.ok(events.some((e) => TERMINAL.has(e.type)), 'terminal 이벤트가 없습니다');
  });

  await test('준수 provider: phase_start가 첫 번째 이벤트', async () => {
    const { events } = await runAdapter(compliantProvider);
    assert.ok(events.length > 0, '이벤트가 없습니다');
    assert.strictEqual(events[0].type, 'phase_start', `첫 이벤트: ${events[0].type}`);
  });

  await test('준수 provider: 마지막 이벤트가 phase_end', async () => {
    const { events } = await runAdapter(compliantProvider);
    const last = events[events.length - 1];
    assert.ok(last.type === 'phase_end' || last.type === 'error',
              `마지막 이벤트: ${last.type}`);
  });

  await test('준수 provider: 이벤트 payload가 JSON 직렬화 가능', async () => {
    const { events } = await runAdapter(compliantProvider);
    for (const ev of events) {
      assert.doesNotThrow(
        () => JSON.parse(JSON.stringify(ev)),
        `이벤트를 JSON으로 직렬화할 수 없습니다: ${ev.type}`
      );
    }
  });

  // -------------------------------------------------------------------------
  // tool_call / tool_result 페어링
  // -------------------------------------------------------------------------

  console.log('\n[tool_call / tool_result 페어링]');

  await test('준수 provider: tool_call과 tool_result가 같은 id로 페어링됨', async () => {
    const { events } = await runAdapter(compliantProvider);
    const toolCalls   = events.filter((e) => e.type === 'tool_call').map((e) => e.id);
    const toolResults = events.filter((e) => e.type === 'tool_result').map((e) => e.id);
    for (const id of toolCalls) {
      assert.ok(toolResults.includes(id), `tool_call id="${id}"에 대응하는 tool_result가 없습니다`);
    }
  });

  // -------------------------------------------------------------------------
  // AbortSignal 지원
  // -------------------------------------------------------------------------

  console.log('\n[AbortSignal 지원]');

  await test('abort 전 signal: 정상 실행', async () => {
    const controller = new AbortController();
    const { result, events } = await runAdapter(abortAwareProvider, { signal: controller.signal });
    assert.strictEqual(result.success, true);
    assert.ok(events.some((e) => e.type === 'phase_start'), 'phase_start 없음');
  });

  await test('abort된 signal: interrupted failure 반환', async () => {
    const controller = new AbortController();
    controller.abort();
    const { result, events } = await runAdapter(abortAwareProvider, { signal: controller.signal });
    assert.strictEqual(result.success, false);
    const errorEv = events.find((e) => e.type === 'error');
    assert.ok(errorEv, 'error 이벤트가 없습니다');
    assert.ok(errorEv.failure && errorEv.failure.kind === 'interrupted',
              `failure.kind: ${errorEv.failure && errorEv.failure.kind}`);
  });

  // -------------------------------------------------------------------------
  // prompt 필수 검증
  // -------------------------------------------------------------------------

  console.log('\n[prompt 필수 검증]');

  await test('준수 provider: prompt 미제공 시 TypeError', async () => {
    await assert.rejects(
      () => compliantProvider({ onEvent: () => {} }),
      (e) => e instanceof TypeError && /prompt/i.test(e.message)
    );
  });

  // -------------------------------------------------------------------------
  // scaffold-template.js 불완전 상태 검증
  // -------------------------------------------------------------------------

  console.log('\n[scaffold-template.js — 미구현 상태 계약]');

  await test('scaffold-template: prompt 미제공 시 TypeError', async () => {
    const { runScaffold } = require('../src/providers/scaffold-template');
    await assert.rejects(
      () => runScaffold({}),
      (e) => e instanceof TypeError && /prompt/i.test(e.message)
    );
  });

  await test('scaffold-template: 미구현 상태에서 success:false 반환', async () => {
    const { runScaffold } = require('../src/providers/scaffold-template');
    const { result, events } = await runAdapter(runScaffold);
    assert.strictEqual(result.success, false);
    // 미구현 상태는 config failure를 emit한다
    const errEv = events.find((e) => e.type === 'error');
    assert.ok(errEv, '미구현 scaffold는 error 이벤트를 emit해야 합니다');
  });

  await test('scaffold-template: 미구현 상태에서도 phase_start emit', async () => {
    const { runScaffold } = require('../src/providers/scaffold-template');
    const { events } = await runAdapter(runScaffold);
    assert.ok(events[0] && events[0].type === 'phase_start',
              `첫 이벤트: ${events[0] && events[0].type}`);
  });

  await test('scaffold-template: 미구현 상태에서 파일 직접 쓰기 없음', async () => {
    const { runScaffold } = require('../src/providers/scaffold-template');
    const { fileWrites } = await runAdapterWithFileGuard(runScaffold);
    assert.strictEqual(fileWrites.length, 0, `파일 직접 쓰기 감지됨: [${fileWrites.join(', ')}]`);
  });

  // -------------------------------------------------------------------------
  // 결과
  // -------------------------------------------------------------------------

  console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
