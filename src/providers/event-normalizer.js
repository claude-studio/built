/**
 * src/providers/event-normalizer.js
 *
 * provider별 raw 이벤트를 표준 7개 이벤트로 normalize한다.
 *
 * 표준 이벤트: phase_start, text_delta, tool_call, tool_result, usage, phase_end, error
 *
 * API:
 *   normalizeClaude(rawEvent)
 *     → StandardEvent[]  (빈 배열 가능)
 *
 *   normalizeCodex(rawEvent)
 *     → StandardEvent[]  (Codex는 이미 표준 형식으로 emit — passthrough + 검증)
 *
 * 순서 규칙 (docs/contracts/provider-events.md):
 *   - phase_start는 한 phase에서 첫 번째 이벤트여야 한다.
 *   - phase_end 또는 error는 terminal 이벤트다.
 *   - terminal 이후 같은 run에서 추가 이벤트를 emit하지 않는다.
 *   - tool_call은 가능하면 같은 id를 가진 tool_result와 짝을 이룬다.
 *   - error 이후 별도의 phase_end는 emit하지 않는다.
 *
 * docs/contracts/provider-events.md 참고.
 */

'use strict';

const {
  FAILURE_KINDS,
  classifyClaudePermissionRequest,
  createFailure,
  isClaudePermissionRequest,
  sanitizeDebugDetail,
} = require('./failure');

// ---------------------------------------------------------------------------
// 표준 이벤트 타입 목록
// ---------------------------------------------------------------------------

const STANDARD_EVENT_TYPES = new Set([
  'phase_start', 'text_delta', 'tool_call', 'tool_result',
  'usage', 'phase_end', 'error',
]);

const TERMINAL_EVENT_TYPES = new Set(['phase_end', 'error']);

// ---------------------------------------------------------------------------
// 내부 유틸
// ---------------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// normalizeClaude
// ---------------------------------------------------------------------------

/**
 * Claude stream-json raw 이벤트를 표준 이벤트 배열로 변환한다.
 *
 * Claude raw 이벤트 타입:
 *   system/init        → phase_start
 *   assistant          → text_delta, tool_call (content 블록 수에 따라 복수 가능)
 *   assistant.usage    → usage (추가로 emit)
 *   tool_result        → tool_result
 *   result(success)    → phase_end
 *   result(error)      → error
 *
 * @param {object} rawEvent  Claude stream-json 이벤트 객체
 * @returns {Array<object>}  표준 이벤트 배열 (빈 배열 가능)
 */
function normalizeClaude(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') return [];

  const ts = nowIso();

  switch (rawEvent.type) {

    case 'system': {
      if (rawEvent.subtype !== 'init') return [];
      return [{
        type:       'phase_start',
        provider:   'claude',
        model:      rawEvent.model || null,
        session_id: rawEvent.session_id || null,
        timestamp:  ts,
      }];
    }

    case 'assistant': {
      const events = [];
      const content = (rawEvent.message && rawEvent.message.content) || [];
      const usage   = (rawEvent.message && rawEvent.message.usage)   || {};

      for (const block of content) {
        if (block.type === 'text') {
          events.push({
            type:      'text_delta',
            text:      block.text || '',
            timestamp: ts,
          });
        } else if (block.type === 'tool_use') {
          events.push({
            type:      'tool_call',
            id:        block.id   || null,
            name:      block.name || null,
            summary:   block.name || null,
            timestamp: ts,
          });
        }
      }

      if (usage.input_tokens || usage.output_tokens) {
        events.push({
          type:          'usage',
          input_tokens:  usage.input_tokens  || 0,
          output_tokens: usage.output_tokens || 0,
          cost_usd:      null,
          timestamp:     ts,
        });
      }

      return events;
    }

    case 'tool_result': {
      return [{
        type:      'tool_result',
        id:        rawEvent.tool_use_id || null,
        name:      null,
        status:    'completed',
        timestamp: ts,
      }];
    }

    case 'result': {
      const permissionFailure = !rawEvent.is_error && rawEvent.subtype !== 'error' &&
        isClaudePermissionRequest(rawEvent.result || '')
        ? classifyClaudePermissionRequest({ message: rawEvent.result || '' })
        : null;
      const isError = !!(rawEvent.is_error || rawEvent.subtype === 'error' || permissionFailure);

      if (isError) {
        const errMsg = rawEvent.result || 'Claude returned an error';
        const failure = permissionFailure || createFailure({
          kind:         FAILURE_KINDS.MODEL_RESPONSE,
          code:         'claude_result_error',
          user_message: errMsg,
          action:       'prompt와 모델 설정을 확인하거나 다시 시도하세요.',
          retryable:    true,
          blocked:      false,
          debug_detail: sanitizeDebugDetail(errMsg),
          raw_provider: 'claude',
        });
        return [{
          type:      'error',
          message:   failure.user_message,
          retryable: failure.retryable,
          failure,
          timestamp: ts,
        }];
      }

      const events = [];

      // result에서 usage가 있으면 usage 먼저 emit (phase_end 직전)
      const usage = rawEvent.usage || {};
      if (usage.input_tokens || usage.output_tokens || rawEvent.total_cost_usd) {
        events.push({
          type:          'usage',
          input_tokens:  usage.input_tokens  || 0,
          output_tokens: usage.output_tokens || 0,
          cost_usd:      rawEvent.total_cost_usd || null,
          timestamp:     ts,
        });
      }

      events.push({
        type:        'phase_end',
        status:      'completed',
        duration_ms: rawEvent.duration_ms || null,
        result:      rawEvent.result || '',
        timestamp:   ts,
      });

      return events;
    }

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// normalizeCodex
// ---------------------------------------------------------------------------

/**
 * Codex app-server raw 이벤트를 표준 이벤트 배열로 변환한다.
 *
 * Codex는 이미 표준 이벤트 형식으로 emit하므로 기본 검증 후 그대로 반환한다.
 * 알 수 없는 이벤트 타입은 무시한다.
 *
 * @param {object} rawEvent  Codex raw 이벤트 객체
 * @returns {Array<object>}  표준 이벤트 배열 (빈 배열 가능)
 */
function normalizeCodex(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') return [];
  if (!STANDARD_EVENT_TYPES.has(rawEvent.type)) return [];

  // timestamp 누락 시 현재 시각으로 보완
  let event = rawEvent.timestamp ? rawEvent : { ...rawEvent, timestamp: nowIso() };

  // error 이벤트에 failure 객체가 없으면 fallback으로 보완
  if (event.type === 'error' && !event.failure) {
    const fallbackFailure = createFailure({
      kind:         FAILURE_KINDS.UNKNOWN,
      code:         'codex_error_no_failure',
      user_message: event.message || 'Codex 오류가 발생했습니다.',
      retryable:    Boolean(event.retryable),
      blocked:      false,
      debug_detail: sanitizeDebugDetail(event.message || ''),
      raw_provider: 'codex',
    });
    event = { ...event, failure: fallbackFailure };
  }

  return [event];
}

// ---------------------------------------------------------------------------
// 순서 규칙 검증 헬퍼
// ---------------------------------------------------------------------------

/**
 * 이벤트 시퀀스의 순서 규칙 위반을 반환한다.
 * 위반이 없으면 빈 배열 반환.
 *
 * 검증 규칙:
 *   - terminal 이벤트(phase_end/error) 이후 추가 이벤트가 있으면 위반
 *   - error 이후 phase_end가 있으면 위반
 *
 * @param {Array<object>} events  표준 이벤트 배열
 * @returns {string[]}  위반 설명 배열
 */
function checkOrderingRules(events) {
  const violations = [];
  let terminalSeen = false;
  let terminalType = null;

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!e || !e.type) continue;

    if (terminalSeen) {
      violations.push(
        `terminal 이벤트(${terminalType}) 이후 ${e.type} 이벤트 금지 (index ${i})`
      );
    }

    if (TERMINAL_EVENT_TYPES.has(e.type)) {
      terminalSeen = true;
      terminalType = e.type;
    }
  }

  return violations;
}

/**
 * 짝이 맞지 않는 tool_call/tool_result 쌍을 반환한다.
 *
 * @param {Array<object>} events  표준 이벤트 배열
 * @returns {{ unpaired_calls: string[], unpaired_results: string[] }}
 */
function checkToolPairing(events) {
  const callIds   = new Set();
  const resultIds = new Set();

  for (const e of events) {
    if (!e || !e.type) continue;
    if (e.type === 'tool_call'   && e.id) callIds.add(e.id);
    if (e.type === 'tool_result' && e.id) resultIds.add(e.id);
  }

  const unpaired_calls   = [...callIds].filter((id) => !resultIds.has(id));
  const unpaired_results = [...resultIds].filter((id) => !callIds.has(id));

  return { unpaired_calls, unpaired_results };
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = {
  normalizeClaude,
  normalizeCodex,
  checkOrderingRules,
  checkToolPairing,
  STANDARD_EVENT_TYPES,
  TERMINAL_EVENT_TYPES,
};
