/**
 * src/providers/standard-writer.js
 *
 * 표준 provider 이벤트(phase_start, text_delta, tool_call, tool_result, usage, phase_end, error)를
 * 받아 progress.json과 do-result.md를 기록한다.
 *
 * progress-writer.js와 동일한 파일 위치/필드 계약을 따른다.
 * Provider가 달라도 산출물 필수 구조가 동일함을 보장하기 위한 표준 writer.
 *
 * API:
 *   createStandardWriter({ runtimeRoot, phase, featureId, resultOutputPath })
 *     → writer
 *   writer.handleEvent(event)   — 표준 이벤트 객체를 처리
 *   writer.close()              — 종료 시 호출 (phase_end/error 없으면 crashed 처리)
 *   writer.getProgress()        — 현재 progress 스냅샷 반환
 *
 * docs/contracts/provider-events.md, docs/contracts/file-contracts.md 참고.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { convert } = require('../result-to-markdown');

// ---------------------------------------------------------------------------
// 내부 유틸 (progress-writer.js와 동일)
// ---------------------------------------------------------------------------

function atomicWrite(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmp = path.join(
    os.tmpdir(),
    `standard-writer-${process.pid}-${Date.now()}.tmp`
  );
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');

  try {
    fs.renameSync(tmp, filePath);
  } catch (_) {
    fs.copyFileSync(tmp, filePath);
    try { fs.unlinkSync(tmp); } catch (_2) {}
  }
}

// ---------------------------------------------------------------------------
// createStandardWriter
// ---------------------------------------------------------------------------

/**
 * 표준 이벤트를 처리해 progress.json과 do-result.md를 기록하는 writer를 생성한다.
 *
 * progress.json 경로: path.join(runtimeRoot, 'progress.json')
 * do-result.md 경로: resultOutputPath (미제공 시 기록 생략)
 *
 * @param {object} opts
 * @param {string} opts.runtimeRoot        .built/features/<feature>/ 절대경로
 * @param {string} [opts.phase='do']       현재 phase 이름
 * @param {string} opts.featureId          feature 식별자
 * @param {string} [opts.resultOutputPath] do-result.md 저장 경로
 * @returns {object} writer
 */
function createStandardWriter({ runtimeRoot, phase = 'do', featureId, resultOutputPath }) {
  if (!runtimeRoot) throw new TypeError('createStandardWriter: runtimeRoot is required');
  if (!featureId)   throw new TypeError('createStandardWriter: featureId is required');

  const progressFile = path.join(runtimeRoot, 'progress.json');

  // 상태 변수
  let sessionId    = null;
  let provider     = null;
  let model        = null;
  let turnCount    = 0;   // text_delta 이벤트마다 증가
  let toolCalls    = 0;   // tool_call 이벤트마다 증가
  let lastText     = '';
  let costUsd      = 0;
  let inputTokens  = 0;
  let outputTokens = 0;
  const startedAt  = new Date().toISOString();
  let finished     = false;

  // -------------------------------------------------------------------------
  // progress.json 빌드/기록
  // -------------------------------------------------------------------------

  function buildProgress(extra = {}) {
    return {
      feature:       featureId,
      phase,
      session_id:    sessionId,
      turn:          turnCount,
      tool_calls:    toolCalls,
      last_text:     lastText.slice(0, 200),
      cost_usd:      costUsd,
      input_tokens:  inputTokens,
      output_tokens: outputTokens,
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

  function onPhaseStart(event) {
    sessionId = event.session_id || null;
    provider  = event.provider   || null;
    model     = event.model      || null;
    writeProgress();
  }

  function onTextDelta(event) {
    turnCount++;
    lastText = event.text || '';
    writeProgress();
  }

  function onToolCall(_event) {
    toolCalls++;
    writeProgress();
  }

  function onToolResult(_event) {
    writeProgress();
  }

  function onUsage(event) {
    if (event.input_tokens)  inputTokens  += event.input_tokens;
    if (event.output_tokens) outputTokens += event.output_tokens;
    if (event.cost_usd)      costUsd       = (costUsd || 0) + event.cost_usd;
    writeProgress();
  }

  function onPhaseEnd(event) {
    finished = true;
    if (event.cost_usd) costUsd = event.cost_usd;

    writeProgress({ status: 'completed' });

    if (resultOutputPath) {
      const resultObj = {
        feature_id:  featureId,
        subtype:     'success',
        status:      'completed',
        model:       model || null,
        cost_usd:    costUsd,
        duration_ms: event.duration_ms || null,
        started_at:  startedAt,
        updated_at:  new Date().toISOString(),
        result:      event.result || '',
      };
      convert(resultObj, resultOutputPath);
    }
  }

  function onError(event) {
    finished = true;

    const progressExtra = {
      status:     'failed',
      last_error: event.message || 'unknown error',
    };
    // failure 객체가 있으면 last_failure로 기록 (user_message 중심, debug_detail 제외)
    if (event.failure && typeof event.failure === 'object') {
      progressExtra.last_failure = {
        kind:      event.failure.kind      || null,
        code:      event.failure.code      || null,
        retryable: Boolean(event.failure.retryable),
        blocked:   Boolean(event.failure.blocked),
        action:    event.failure.action    || null,
      };
    }
    writeProgress(progressExtra);

    if (resultOutputPath) {
      const resultObj = {
        feature_id:  featureId,
        subtype:     'error',
        status:      'failed',
        model:       model || null,
        cost_usd:    costUsd,
        duration_ms: null,
        started_at:  startedAt,
        updated_at:  new Date().toISOString(),
        result:      (event.failure && event.failure.user_message) || event.message || '',
      };
      convert(resultObj, resultOutputPath);
    }
  }

  // -------------------------------------------------------------------------
  // 공개 API
  // -------------------------------------------------------------------------

  /**
   * 표준 이벤트 객체를 처리한다.
   *
   * @param {object} event  표준 이벤트 (phase_start, text_delta, tool_call, ...)
   */
  function handleEvent(event) {
    if (!event || typeof event !== 'object') return;

    const type = event.type;
    if (type === 'phase_start')  return onPhaseStart(event);
    if (type === 'text_delta')   return onTextDelta(event);
    if (type === 'tool_call')    return onToolCall(event);
    if (type === 'tool_result')  return onToolResult(event);
    if (type === 'usage')        return onUsage(event);
    if (type === 'phase_end')    return onPhaseEnd(event);
    if (type === 'error')        return onError(event);
    // 알 수 없는 타입은 무시
  }

  /**
   * 종료 시 호출. phase_end/error를 받지 못했으면 crashed 처리.
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

  return { handleEvent, close, getProgress };
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = { createStandardWriter };
