/**
 * src/providers/failure.js
 *
 * provider failure taxonomy 헬퍼.
 *
 * 모든 provider(Claude, Codex)가 공통으로 사용하는 failure 객체 생성·분류·sanitize 함수를 제공한다.
 *
 * API:
 *   createFailure({ kind, code, user_message, action, retryable, blocked, debug_detail, raw_provider })
 *     → failure 객체
 *
 *   classifyClaudeFailure({ timedOut, timeoutMs, spawnError, exitCode, stderrBuf, jsonParseError })
 *     → failure 객체
 *
 *   classifyClaudePermissionRequest({ message })
 *     → failure 객체
 *
 *   isClaudePermissionRequest(message)
 *     → boolean
 *
 *   classifyCodexFailure({ kind, message, retryable, brokerBusy, brokerStartFailed })
 *     → failure 객체
 *
 *   failureToEventFields(failure)
 *     → { message, retryable, failure }  (error 이벤트에 spread할 필드)
 *
 *   sanitizeDebugDetail(raw)
 *     → string  (secret/token 후보를 마스킹한 debug 문자열)
 *
 * taxonomy kinds:
 *   auth, config, sandbox, timeout, interrupted, provider_unavailable,
 *   model_response, runner_normalize, runner_io, unknown
 *
 * docs/contracts/provider-events.md 참고.
 */

'use strict';

const { maskPrivatePaths } = require('../../scripts/sanitize');

// ---------------------------------------------------------------------------
// taxonomy enum
// ---------------------------------------------------------------------------

/** 공통 failure kind 목록 */
const FAILURE_KINDS = Object.freeze({
  AUTH:               'auth',
  CONFIG:             'config',
  SANDBOX:            'sandbox',
  TIMEOUT:            'timeout',
  INTERRUPTED:        'interrupted',
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
  MODEL_RESPONSE:     'model_response',
  RUNNER_NORMALIZE:   'runner_normalize',
  RUNNER_IO:          'runner_io',
  UNKNOWN:            'unknown',
});

const DEFAULT_FAILURE_GUIDANCE = Object.freeze({
  [FAILURE_KINDS.AUTH]: Object.freeze({
    user_message: 'provider 인증에 실패했습니다.',
    action:       'provider 로그인 또는 API 키 설정을 확인한 뒤 다시 시도하세요.',
    retryable:    false,
    blocked:      true,
  }),
  [FAILURE_KINDS.CONFIG]: Object.freeze({
    user_message: 'provider 설정 오류가 발생했습니다.',
    action:       'run-request.json과 provider 설정을 확인하세요.',
    retryable:    false,
    blocked:      true,
  }),
  [FAILURE_KINDS.SANDBOX]: Object.freeze({
    user_message: 'sandbox 설정 때문에 요청한 작업을 완료할 수 없습니다.',
    action:       'phase 목적에 맞는 sandbox 권한으로 변경하세요.',
    retryable:    false,
    blocked:      true,
  }),
  [FAILURE_KINDS.TIMEOUT]: Object.freeze({
    user_message: 'provider 실행이 타임아웃되었습니다.',
    action:       'timeout 설정을 늘리거나 잠시 후 다시 시도하세요.',
    retryable:    true,
    blocked:      false,
  }),
  [FAILURE_KINDS.INTERRUPTED]: Object.freeze({
    user_message: 'provider 실행이 중단되었습니다.',
    action:       '필요하면 같은 feature를 다시 실행하세요.',
    retryable:    false,
    blocked:      false,
  }),
  [FAILURE_KINDS.PROVIDER_UNAVAILABLE]: Object.freeze({
    user_message: 'provider를 사용할 수 없습니다.',
    action:       'provider 설치, 버전, 실행 환경을 확인한 뒤 다시 시도하세요.',
    retryable:    false,
    blocked:      true,
  }),
  [FAILURE_KINDS.MODEL_RESPONSE]: Object.freeze({
    user_message: 'provider 응답을 처리하지 못했습니다.',
    action:       'prompt, schema, 모델 응답 형식을 확인하거나 다시 시도하세요.',
    retryable:    true,
    blocked:      false,
  }),
  [FAILURE_KINDS.RUNNER_NORMALIZE]: Object.freeze({
    user_message: 'provider 이벤트 정규화에 실패했습니다.',
    action:       'logs/<phase>.jsonl의 debug_detail과 provider event contract를 확인하세요.',
    retryable:    false,
    blocked:      false,
  }),
  [FAILURE_KINDS.RUNNER_IO]: Object.freeze({
    user_message: 'runtime 파일 기록에 실패했습니다.',
    action:       '.built/runtime과 .built/features 경로의 파일 권한과 디스크 상태를 확인하세요.',
    retryable:    false,
    blocked:      true,
  }),
  [FAILURE_KINDS.UNKNOWN]: Object.freeze({
    user_message: 'provider 실패가 발생했습니다.',
    action:       'logs/<phase>.jsonl의 debug_detail을 확인하세요.',
    retryable:    false,
    blocked:      false,
  }),
});

function normalizeFailureKind(kind) {
  return Object.values(FAILURE_KINDS).includes(kind) ? kind : FAILURE_KINDS.UNKNOWN;
}

function guidanceForKind(kind) {
  return DEFAULT_FAILURE_GUIDANCE[normalizeFailureKind(kind)] || DEFAULT_FAILURE_GUIDANCE[FAILURE_KINDS.UNKNOWN];
}

// ---------------------------------------------------------------------------
// createFailure
// ---------------------------------------------------------------------------

/**
 * 표준 failure 객체를 생성한다.
 *
 * @param {object} opts
 * @param {string} opts.kind           FAILURE_KINDS 중 하나
 * @param {string} [opts.code]         provider-specific error code 슬러그
 * @param {string} opts.user_message   사용자에게 노출할 메시지 (조치 중심)
 * @param {string} [opts.action]       권장 조치 문자열
 * @param {boolean} opts.retryable     재시도 가능 여부
 * @param {boolean} opts.blocked       blocked 여부 (false = runner가 재시도 가능)
 * @param {string} [opts.debug_detail] sanitize된 디버그 상세 (provider raw error)
 * @param {string} [opts.raw_provider] provider 이름 ('claude' | 'codex')
 * @returns {object}
 */
function createFailure({
  kind,
  code,
  user_message,
  action,
  retryable,
  blocked,
  debug_detail,
  raw_provider,
}) {
  const normalizedKind = normalizeFailureKind(kind);
  const guidance = guidanceForKind(normalizedKind);
  return {
    kind:          normalizedKind,
    code:          code            || null,
    user_message:  user_message    || guidance.user_message,
    action:        action          || guidance.action,
    retryable:     retryable !== undefined ? Boolean(retryable) : guidance.retryable,
    blocked:       blocked !== undefined ? Boolean(blocked) : guidance.blocked,
    debug_detail:  debug_detail    || null,
    raw_provider:  raw_provider    || null,
  };
}

// ---------------------------------------------------------------------------
// sanitizeDebugDetail
// ---------------------------------------------------------------------------

/**
 * provider raw error 문자열에서 secret/token 후보를 마스킹한다.
 * Authorization 헤더, Bearer 토큰, sk-/pk-/org- 형식 키를 마스킹한다.
 *
 * @param {string} raw
 * @returns {string}
 */
function sanitizeDebugDetail(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const sanitized = raw
    // Authorization: Bearer <token>
    .replace(/(Authorization\s*:\s*Bearer\s+)\S+/gi, '$1[REDACTED]')
    // Bearer <token> 단독
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/=]{20,}/g, 'Bearer [REDACTED]')
    // sk-*, pk-*, org-* 형식 (OpenAI/Anthropic key 패턴)
    .replace(/\b(sk|pk|org)-[A-Za-z0-9\-_]{16,}/g, '[REDACTED_KEY]')
    // GitHub 토큰
    .replace(/ghp_[A-Za-z0-9]{36}/g, '[REDACTED_KEY]')
    // 민감 환경변수 값 (ANTHROPIC_API_KEY=xxx, OPENAI_API_KEY=xxx 등)
    .replace(/\b(ANTHROPIC_API_KEY|OPENAI_API_KEY|CLAUDE_API_KEY|OPENAI_SECRET_KEY|CODEX_API_KEY)\s*[=:]\s*\S+/gi, '$1=[REDACTED]')
    // 사용자 홈 경로 (/Users/<name>/ 또는 /home/<name>/ → ~/)
    .replace(/\/(?:Users|home)\/[^/\s"'`]+\//g, '~/')
    // Telegram bot token 형식 (1234567890:ABCdef...)
    .replace(/\b\d{7,12}:[A-Za-z0-9_-]{35,36}\b/g, '[REDACTED_BOT_TOKEN]')
    // chat_id 값 마스킹 (JSON/query 형식)
    .replace(/(chat_id[\s"':=]+)\d{7,15}/gi, '$1[REDACTED_CHAT_ID]');

  return maskPrivatePaths(sanitized).slice(0, 2000);
}

// ---------------------------------------------------------------------------
// classifyClaudeFailure
// ---------------------------------------------------------------------------

/**
 * Claude provider 실패를 taxonomy failure 객체로 분류한다.
 *
 * @param {object} opts
 * @param {boolean} [opts.timedOut]         타임아웃 여부
 * @param {number}  [opts.timeoutMs]        타임아웃 ms
 * @param {Error}   [opts.spawnError]       spawn ENOENT 등 프로세스 시작 오류
 * @param {number}  [opts.exitCode]         비정상 종료 코드
 * @param {string}  [opts.stderrBuf]        stderr 내용
 * @param {string}  [opts.jsonParseError]   JSON parse 실패 메시지
 * @returns {object}  failure 객체
 */
function classifyClaudeFailure({ timedOut, timeoutMs, spawnError, exitCode, stderrBuf, jsonParseError } = {}) {
  if (timedOut) {
    const ms = timeoutMs || 0;
    return createFailure({
      kind:         FAILURE_KINDS.TIMEOUT,
      code:         'claude_timeout',
      user_message: `Claude 실행이 ${ms}ms 후 타임아웃되었습니다. 다시 시도하세요.`,
      action:       'MULTICA_AGENT_TIMEOUT 환경변수로 타임아웃을 늘리거나 다시 시도하세요.',
      retryable:    true,
      blocked:      false,
      debug_detail: sanitizeDebugDetail(`process timed out after ${ms}ms`),
      raw_provider: 'claude',
    });
  }

  if (spawnError) {
    const isNotFound = spawnError.code === 'ENOENT' || /not found|no such file/i.test(spawnError.message);
    return createFailure({
      kind:         FAILURE_KINDS.PROVIDER_UNAVAILABLE,
      code:         isNotFound ? 'claude_binary_not_found' : 'claude_spawn_failed',
      user_message: isNotFound
        ? 'Claude CLI를 찾을 수 없습니다. @anthropic-ai/claude-code 설치 후 다시 실행하세요.'
        : 'Claude 프로세스를 시작하지 못했습니다. 실행 환경을 확인하세요.',
      action:       isNotFound ? 'npm install -g @anthropic-ai/claude-code 을 실행하세요.' : '환경을 확인하세요.',
      retryable:    false,
      blocked:      true,
      debug_detail: sanitizeDebugDetail(spawnError.message),
      raw_provider: 'claude',
    });
  }

  if (jsonParseError) {
    return createFailure({
      kind:         FAILURE_KINDS.MODEL_RESPONSE,
      code:         'claude_json_parse_failed',
      user_message: 'Claude 응답을 JSON으로 파싱하지 못했습니다. 다시 시도하거나 prompt/schema를 확인하세요.',
      action:       'prompt와 --json-schema 스키마를 확인하세요.',
      retryable:    true,
      blocked:      false,
      debug_detail: sanitizeDebugDetail(jsonParseError),
      raw_provider: 'claude',
    });
  }

  if (stderrBuf && stderrBuf.trim()) {
    const cleaned = stderrBuf.trim();
    const isAuth = /unauthorized|authentication|api key|401/i.test(cleaned);
    if (isAuth) {
      return createFailure({
        kind:         FAILURE_KINDS.AUTH,
        code:         'claude_auth_failed',
        user_message: 'Claude 인증에 실패했습니다. API 키와 인증 상태를 확인하세요.',
        action:       'ANTHROPIC_API_KEY 환경변수 또는 claude auth 상태를 확인하세요.',
        retryable:    false,
        blocked:      true,
        debug_detail: sanitizeDebugDetail(cleaned),
        raw_provider: 'claude',
      });
    }
    return createFailure({
      kind:         FAILURE_KINDS.UNKNOWN,
      code:         `claude_exit_${exitCode || 1}`,
      user_message: `Claude 실행이 비정상 종료되었습니다 (코드: ${exitCode || 1}). 로그를 확인하세요.`,
      action:       'logs/<phase>.jsonl의 debug_detail을 확인하세요.',
      retryable:    false,
      blocked:      false,
      debug_detail: sanitizeDebugDetail(cleaned),
      raw_provider: 'claude',
    });
  }

  return createFailure({
    kind:         FAILURE_KINDS.UNKNOWN,
    code:         `claude_exit_${exitCode || 1}`,
    user_message: `Claude 실행이 비정상 종료되었습니다 (코드: ${exitCode || 1}).`,
    action:       'logs/<phase>.jsonl의 debug_detail을 확인하세요.',
    retryable:    false,
    blocked:      false,
    debug_detail: null,
    raw_provider: 'claude',
  });
}

// ---------------------------------------------------------------------------
// Claude permission request detection
// ---------------------------------------------------------------------------

/**
 * Claude가 headless 실행 중 tool permission 승인을 요구하는 응답인지 판정한다.
 *
 * @param {string} message
 * @returns {boolean}
 */
function isClaudePermissionRequest(message) {
  if (!message || typeof message !== 'string') return false;
  const text = message.toLowerCase();

  const englishApproval =
    /permission/.test(text) &&
    /(approval|approve|allow|authorize|grant|requires?|needed|need|waiting|cannot proceed|can't proceed)/.test(text);
  const englishToolUse =
    /(need|requires?|waiting for|cannot proceed without|can't proceed without).{0,80}(permission|approval)/.test(text);
  const englishCommandApproval =
    /(this\s+)?command.{0,40}requires?.{0,40}approval/.test(text);
  const koreanApproval =
    /(권한|승인|허용)/.test(message) &&
    /(필요|대기|요청|없이는|없으면|진행할 수|생성할 수|수정할 수)/.test(message);

  return englishApproval || englishToolUse || englishCommandApproval || koreanApproval;
}

/**
 * Claude permission approval 대기 응답을 표준 failure 객체로 분류한다.
 *
 * @param {object} opts
 * @param {string} opts.message
 * @returns {object}
 */
function classifyClaudePermissionRequest({ message } = {}) {
  return createFailure({
    kind:         FAILURE_KINDS.MODEL_RESPONSE,
    code:         'claude_permission_request',
    user_message: 'Claude가 headless 실행 중 파일 변경 권한 승인을 요청해 Do 단계를 완료할 수 없습니다.',
    action:       formatClaudePermissionRemediation(null),
    retryable:    false,
    blocked:      true,
    debug_detail: sanitizeDebugDetail(message || 'Claude requested tool permission approval'),
    raw_provider: 'claude',
  });
}

/**
 * claude_permission_request 전용 사용자 안내 문구.
 *
 * @param {string|null} feature
 * @returns {string}
 */
function formatClaudePermissionRemediation(feature) {
  const featureArg = feature ? ` ${feature}` : ' <feature>';
  return [
    '다음 중 하나를 선택하세요:',
    `1. 권장: /built:run-codex${featureArg} 로 Do/Check/Iter/Report를 Codex 경로에서 다시 실행합니다.`,
    '2. Claude 유지: 사용자 승인 후 대상 프로젝트의 .claude/settings.json에 필요한 Write/Edit/Bash allow rule만 명시 범위로 추가합니다.',
    '3. 고급: 중단한 뒤 .claude/settings.json 또는 Claude CLI permission 설정을 직접 확인하고 필요한 도구만 허용합니다.',
    'built는 --dangerously-skip-permissions를 자동 적용하지 않습니다.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// classifyCodexFailure
// ---------------------------------------------------------------------------

/**
 * Codex provider 실패를 taxonomy failure 객체로 분류한다.
 *
 * @param {object} opts
 * @param {string}  opts.kind            'auth' | 'config' | 'sandbox' | 'timeout' |
 *                                        'interrupted' | 'provider_unavailable' |
 *                                        'model_response' | 'runner_normalize' |
 *                                        'unknown'
 * @param {string}  opts.message         원본 오류 메시지 (MSG_* 상수 또는 런타임 메시지)
 * @param {boolean} [opts.retryable]     재시도 가능 여부 오버라이드
 * @param {boolean} [opts.brokerBusy]    broker busy 여부
 * @param {boolean} [opts.brokerStartFailed]  broker 시작 실패 여부
 * @returns {object}  failure 객체
 */
function classifyCodexFailure({ kind, message, retryable, brokerBusy, brokerStartFailed } = {}) {
  const k = kind || FAILURE_KINDS.UNKNOWN;

  if (brokerBusy) {
    return createFailure({
      kind:         FAILURE_KINDS.PROVIDER_UNAVAILABLE,
      code:         'codex_broker_busy',
      user_message: 'Codex broker가 다른 turn을 처리 중입니다. 잠시 후 다시 실행하세요.',
      action:       '잠시 후 다시 시도하세요.',
      retryable:    true,
      blocked:      false,
      debug_detail: sanitizeDebugDetail(message || 'broker busy'),
      raw_provider: 'codex',
    });
  }

  if (brokerStartFailed) {
    return createFailure({
      kind:         FAILURE_KINDS.PROVIDER_UNAVAILABLE,
      code:         'codex_broker_start_failed',
      user_message: 'Codex broker를 시작하지 못했습니다.',
      action:       'app-server lifecycle과 broker 로그를 확인하세요.',
      retryable:    false,
      blocked:      true,
      debug_detail: sanitizeDebugDetail(message || 'broker start failed'),
      raw_provider: 'codex',
    });
  }

  switch (k) {
    case FAILURE_KINDS.AUTH:
      return createFailure({
        kind:         FAILURE_KINDS.AUTH,
        code:         'codex_auth_required',
        user_message: 'Codex 인증이 필요합니다. codex login 상태를 확인하세요.',
        action:       'codex login을 실행한 뒤 다시 시도하세요.',
        retryable:    false,
        blocked:      true,
        debug_detail: sanitizeDebugDetail(message || 'auth required'),
        raw_provider: 'codex',
      });

    case FAILURE_KINDS.CONFIG:
      return createFailure({
        kind:         FAILURE_KINDS.CONFIG,
        code:         'codex_config_error',
        user_message: 'Codex 설정 오류입니다. provider 이름, sandbox, phase 설정을 확인하세요.',
        action:       'provider 설정(run-request.json)을 확인하세요.',
        retryable:    false,
        blocked:      true,
        debug_detail: sanitizeDebugDetail(message || 'config error'),
        raw_provider: 'codex',
      });

    case FAILURE_KINDS.SANDBOX:
      if (String(message || '').includes('read-only sandbox에서 파일 변경 시도')) {
        return createFailure({
          kind:         FAILURE_KINDS.SANDBOX,
          code:         'codex_read_only_file_change',
          user_message: 'Codex read-only sandbox에서 파일 변경 시도가 감지되었습니다.',
          action:       'check/report/plan_synthesis에서는 파일을 수정하지 말고, 구현 변경은 do/iter phase를 workspace-write로 실행하세요.',
          retryable:    false,
          blocked:      true,
          debug_detail: sanitizeDebugDetail(message || 'read-only file change'),
          raw_provider: 'codex',
        });
      }

      return createFailure({
        kind:         FAILURE_KINDS.SANDBOX,
        code:         'codex_sandbox_conflict',
        user_message: 'do/iter phase에서 Codex read-only sandbox는 파일 변경을 반영할 수 없습니다. workspace-write를 사용하세요.',
        action:       'run-request.json의 해당 do/iter provider sandbox를 workspace-write로 변경하세요.',
        retryable:    false,
        blocked:      true,
        debug_detail: sanitizeDebugDetail(message || 'sandbox conflict'),
        raw_provider: 'codex',
      });

    case FAILURE_KINDS.TIMEOUT:
      return createFailure({
        kind:         FAILURE_KINDS.TIMEOUT,
        code:         'codex_timeout',
        user_message: 'Codex 실행이 타임아웃되었습니다.',
        action:       'timeout_ms를 늘리거나 다시 시도하세요.',
        retryable:    true,
        blocked:      false,
        debug_detail: sanitizeDebugDetail(message || 'timeout'),
        raw_provider: 'codex',
      });

    case FAILURE_KINDS.INTERRUPTED:
      return createFailure({
        kind:         FAILURE_KINDS.INTERRUPTED,
        code:         'codex_interrupted',
        user_message: 'Codex 실행이 사용자 중단 신호로 취소되었습니다.',
        action:       '필요하면 같은 feature를 다시 실행하세요.',
        retryable:    false,
        blocked:      false,
        debug_detail: sanitizeDebugDetail(message || 'interrupted'),
        raw_provider: 'codex',
      });

    case FAILURE_KINDS.PROVIDER_UNAVAILABLE:
      return createFailure({
        kind:         FAILURE_KINDS.PROVIDER_UNAVAILABLE,
        code:         'codex_unavailable',
        user_message: 'Codex CLI를 사용할 수 없습니다. 설치 상태를 확인하세요.',
        action:       '설치 또는 업데이트 후 다시 시도하세요.',
        retryable:    retryable !== undefined ? retryable : false,
        blocked:      retryable !== undefined ? !retryable : true,
        debug_detail: sanitizeDebugDetail(message || 'provider unavailable'),
        raw_provider: 'codex',
      });

    case FAILURE_KINDS.MODEL_RESPONSE:
      return createFailure({
        kind:         FAILURE_KINDS.MODEL_RESPONSE,
        code:         'codex_model_response_error',
        user_message: 'Codex 응답 처리 중 오류가 발생했습니다. 다시 시도하거나 prompt를 확인하세요.',
        action:       'prompt와 outputSchema를 확인하세요.',
        retryable:    true,
        blocked:      false,
        debug_detail: sanitizeDebugDetail(message || 'model response error'),
        raw_provider: 'codex',
      });

    default:
      return createFailure({
        kind:         FAILURE_KINDS.UNKNOWN,
        code:         'codex_unknown',
        user_message: 'Codex 실행 중 알 수 없는 오류가 발생했습니다. 로그를 확인하세요.',
        action:       'logs/<phase>.jsonl의 debug_detail을 확인하세요.',
        retryable:    retryable !== undefined ? retryable : false,
        blocked:      false,
        debug_detail: sanitizeDebugDetail(message || 'unknown error'),
        raw_provider: 'codex',
      });
  }
}

// ---------------------------------------------------------------------------
// failureToEventFields
// ---------------------------------------------------------------------------

/**
 * failure 객체를 error 이벤트에 spread할 필드로 변환한다.
 * 기존 error 이벤트의 message/retryable과 함께 사용한다.
 *
 * @param {object} failure  createFailure()가 반환한 객체
 * @returns {{ message: string, retryable: boolean, failure: object }}
 */
function failureToEventFields(failure) {
  return {
    message:   failure.user_message,
    retryable: failure.retryable,
    failure,
  };
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = {
  FAILURE_KINDS,
  createFailure,
  sanitizeDebugDetail,
  classifyClaudeFailure,
  classifyClaudePermissionRequest,
  formatClaudePermissionRemediation,
  classifyCodexFailure,
  failureToEventFields,
  isClaudePermissionRequest,
};
