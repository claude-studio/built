#!/usr/bin/env node
/**
 * progress-writer.js
 *
 * claude -p --output-format stream-json --verbose 의 stdout 이벤트를 실시간으로 파싱해
 * .built/features/<feature>/progress.json을 atomic write로 갱신하고,
 * result 이벤트 수신 시 result-to-markdown.js를 호출.
 *
 * SSOT 계약 (BUILT-DESIGN.md §8.3):
 *   - progress.json (.built/features/<feature>/): pipeline 전용
 *     session_id, turn, cost, tokens, status 등 실행 관찰 정보
 *   - state.json (.built/runtime/runs/<feature>/): orchestrator 전용
 *     phase, status, pid, attempt, last_error 등 생명주기 정보
 *   이 모듈은 progress.json만 관리한다. state.json은 건드리지 않는다.
 *
 * API:
 *   createWriter({ runtimeRoot, phase, featureId, resultOutputPath }) → writer
 *   writer.handleLine(line)    - JSON 텍스트 한 줄을 파싱해 처리
 *   writer.handleEvent(event)  - 이미 파싱된 이벤트 객체를 처리
 *   writer.close()             - stdin 종료 시 호출 (crashed 처리)
 *   writer.getProgress()       - 현재 progress 스냅샷 반환
 *
 * 지원 이벤트 타입: system, assistant, user, tool_result, result
 * 외부 npm 패키지 없음 (Node.js 표준 라이브러리만). BUILT-DESIGN.md §8 기준.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { convert } = require('./result-to-markdown');
const {
  TEXT_TAIL_CHARS,
  createProgressCompactor,
  truncateText,
} = require('./progress-compaction');
const {
  classifyClaudePermissionRequest,
  isClaudePermissionRequest,
} = require('./providers/failure');

// ---------------------------------------------------------------------------
// 내부 유틸
// ---------------------------------------------------------------------------

/**
 * JSON 객체를 tmp 파일에 쓴 뒤 rename으로 교체 — 파일 손상 방지.
 *
 * @param {string} filePath  대상 파일 절대경로
 * @param {object} data      직렬화할 객체
 */
function atomicWrite(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmp = path.join(
    os.tmpdir(),
    `progress-writer-${process.pid}-${Date.now()}.tmp`
  );
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');

  try {
    fs.renameSync(tmp, filePath);
  } catch (_) {
    // 크로스-디바이스 fallback
    fs.copyFileSync(tmp, filePath);
    try { fs.unlinkSync(tmp); } catch (_2) {}
  }
}

/**
 * JSONL 파일에 이벤트 한 줄 append.
 *
 * @param {string} logFile  .jsonl 파일 경로
 * @param {object} event    직렬화할 이벤트 객체
 */
function appendLog(logFile, event) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, JSON.stringify(event) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// createWriter
// ---------------------------------------------------------------------------

/**
 * progress-writer 인스턴스를 생성한다.
 *
 * @param {object} opts
 * @param {string} opts.runtimeRoot      .built/runtime/runs/<feature>/ 절대경로
 * @param {string} [opts.phase='do']     현재 phase 이름 (logs/<phase>.jsonl에 사용)
 * @param {string} opts.featureId        feature 식별자
 * @param {string} [opts.resultOutputPath]  result 이벤트 시 do-result.md 저장 경로
 *                                          미제공 시 result-to-markdown 호출 생략
 * @returns {object} writer
 */
function createWriter({ runtimeRoot, phase = 'do', featureId, resultOutputPath }) {
  if (!runtimeRoot) throw new TypeError('createWriter: runtimeRoot is required');
  if (!featureId)   throw new TypeError('createWriter: featureId is required');

  const progressFile = path.join(runtimeRoot, 'progress.json');
  const logsDir      = path.join(runtimeRoot, 'logs');
  const logFile      = path.join(logsDir, `${phase}.jsonl`);
  const compactor    = createProgressCompactor();

  // 진행 상태 변수
  let sessionId    = null;
  let turnCount    = 0;
  let toolUseCount = 0;
  let lastText     = '';
  let totalCostUsd = 0;
  let inputTokens  = 0;
  let outputTokens = 0;
  const startedAt  = new Date().toISOString();
  let finished     = false;

  // -------------------------------------------------------------------------
  // progress.json / state.json 갱신 헬퍼
  // -------------------------------------------------------------------------

  function buildProgress(extra = {}) {
    return {
      feature:       featureId,
      phase,
      session_id:    sessionId,
      turn:          turnCount,
      tool_calls:    toolUseCount,
      last_text:     truncateText(lastText, TEXT_TAIL_CHARS).text,
      cost_usd:      totalCostUsd,
      input_tokens:  inputTokens,
      output_tokens: outputTokens,
      log_summary:   compactor.snapshot(),
      recent_events: compactor.recentEvents(),
      started_at:    startedAt,
      updated_at:    new Date().toISOString(),
      ...extra,
    };
  }

  function writeProgress(extra = {}) {
    atomicWrite(progressFile, buildProgress(extra));
  }

  // -------------------------------------------------------------------------
  // 이벤트별 핸들러
  // -------------------------------------------------------------------------

  function onSystem(event) {
    if (event.subtype === 'init') {
      sessionId = event.session_id || null;
    }
    writeProgress();
  }

  function onAssistant(event) {
    turnCount++;
    const content = (event.message && event.message.content) || [];
    for (const block of content) {
      if (block.type === 'text')     lastText = block.text || '';
      if (block.type === 'tool_use') toolUseCount++;
    }
    const usage = (event.message && event.message.usage) || {};
    if (usage.input_tokens)  inputTokens  += usage.input_tokens;
    if (usage.output_tokens) outputTokens += usage.output_tokens;
    writeProgress();
  }

  function onUser(event) {
    // user 메시지는 heartbeat 갱신만
    writeProgress();
  }

  function onToolResult(event) {
    writeProgress();
  }

  function onResult(event) {
    finished = true;
    totalCostUsd = event.total_cost_usd || 0;
    const usage  = event.usage || {};
    inputTokens  = usage.input_tokens  || inputTokens;
    outputTokens = usage.output_tokens || outputTokens;

    const permissionFailure = !event.is_error && event.subtype !== 'error' &&
      isClaudePermissionRequest(event.result || '')
      ? classifyClaudePermissionRequest({ message: event.result || '' })
      : null;
    const failure    = event.failure || permissionFailure;
    const isError    = !!(event.is_error || event.subtype === 'error' || failure);
    const finalStatus = isError ? 'failed' : 'completed';

    const progressExtra = {
      ...compactor.compactResult(event.result || ''),
      stop_reason: event.stop_reason,
      cost_usd:    totalCostUsd,
      status:      finalStatus,
    };
    if (failure && typeof failure === 'object') {
      progressExtra.last_error = failure.user_message || event.result || 'provider failure';
      progressExtra.last_failure = {
        kind:      failure.kind      || null,
        code:      failure.code      || null,
        retryable: Boolean(failure.retryable),
        blocked:   Boolean(failure.blocked),
        action:    failure.action    || null,
      };
    }
    writeProgress(progressExtra);

    // result-to-markdown 호출 (outputPath 제공 시)
    if (resultOutputPath) {
      const resultObj = {
        feature_id:    featureId,
        subtype:       finalStatus === 'failed' ? 'error' : event.subtype,
        status:        finalStatus,
        model:         event.model || null,
        cost_usd:      totalCostUsd,
        duration_ms:   event.duration_ms || null,
        started_at:    startedAt,
        updated_at:    new Date().toISOString(),
        result:        event.result || '',
      };
      convert(resultObj, resultOutputPath);
    }
  }

  // -------------------------------------------------------------------------
  // 공개 API
  // -------------------------------------------------------------------------

  /**
   * 이미 파싱된 이벤트 객체를 처리한다.
   *
   * @param {object} event
   */
  function handleEvent(event) {
    if (!event || typeof event !== 'object') return;

    // logs/<phase>.jsonl 에 원본 append
    appendLog(logFile, event);
    compactor.observe(event);

    const type = event.type;
    if (type === 'system')      return onSystem(event);
    if (type === 'assistant')   return onAssistant(event);
    if (type === 'user')        return onUser(event);
    if (type === 'tool_result') return onToolResult(event);
    if (type === 'result')      return onResult(event);
    // 알 수 없는 타입은 무시 (log만 남김)
  }

  /**
   * JSON 텍스트 한 줄을 파싱해 처리한다.
   * 파싱 실패 시 raw-error.log에 기록.
   *
   * @param {string} line
   */
  function handleLine(line) {
    const trimmed = (line || '').trim();
    if (!trimmed) return;
    try {
      handleEvent(JSON.parse(trimmed));
    } catch (_) {
      const errLog = path.join(logsDir, 'raw-error.log');
      fs.mkdirSync(logsDir, { recursive: true });
      fs.appendFileSync(errLog, line + '\n', 'utf8');
    }
  }

  /**
   * stdin 종료 시 호출. result 이벤트를 받지 못했으면 crashed로 처리.
   */
  function close() {
    if (finished) return;
    writeProgress({ status: 'crashed' });
  }

  /**
   * 현재 progress 스냅샷 반환 (파일 I/O 없음).
   *
   * @returns {object}
   */
  function getProgress() {
    return buildProgress();
  }

  return { handleLine, handleEvent, close, getProgress };
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = { createWriter };
