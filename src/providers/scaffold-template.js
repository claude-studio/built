/**
 * src/providers/scaffold-template.js
 *
 * 신규 provider adapter scaffold 템플릿.
 *
 * 이 파일을 복사하여 새 provider adapter를 만든다.
 * `SCAFFOLD_TODO` 주석으로 표시된 항목을 실제 구현으로 교체한다.
 *
 * API (구현 필수):
 *   run<Provider>({ prompt, model, onEvent, sandbox, timeout_ms, signal })
 *     → Promise<{ success: boolean, exitCode: number, error?: string, failure?: object }>
 *
 * 계약 (모두 필수 준수):
 *   - provider는 파일을 직접 쓰지 않는다. 파일 기록은 runner(pipeline-runner.js)가 담당한다.
 *   - onEvent(event) 콜백으로 표준 이벤트를 emit한다. (docs/contracts/provider-events.md)
 *   - 첫 이벤트는 반드시 phase_start여야 한다.
 *   - 마지막 이벤트는 반드시 phase_end 또는 error여야 한다.
 *   - terminal 이벤트(phase_end/error) 이후 추가 이벤트를 emit하지 않는다.
 *   - failure taxonomy는 src/providers/failure.js의 createFailure/FAILURE_KINDS를 사용한다.
 *   - sandbox 정책: 'read-only' 또는 'workspace-write'. do/iter phase는 'workspace-write' 필요.
 *   - AbortSignal(signal) 지원: signal.aborted 시 interrupted failure로 종료한다.
 *   - usage/cost는 optional이다. 제공 가능하면 usage 이벤트로 emit한다.
 *
 * docs/contracts/provider-events.md, docs/contracts/provider-config.md 참고.
 * docs/providers/new-provider-checklist.md에서 추가 준수 항목을 확인한다.
 */

'use strict';

const {
  FAILURE_KINDS,
  createFailure,
  failureToEventFields,
  sanitizeDebugDetail,
} = require('./failure');

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

// SCAFFOLD_TODO: provider 이름을 실제 provider 이름으로 교체한다. ('claude', 'codex' 참고)
const PROVIDER_NAME = 'scaffold'; // 예: 'gemini', 'gpt4o', ...

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30분. 필요 시 변경.

// ---------------------------------------------------------------------------
// 내부 헬퍼
// ---------------------------------------------------------------------------

/**
 * 현재 ISO 타임스탬프 반환.
 * @returns {string}
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * provider 이름으로 phase_start 이벤트를 생성한다.
 *
 * @param {string} [phase]  phase 이름 (기본 'do')
 * @param {string} [model]  모델 이름
 * @returns {object}
 */
function makePhaseStart(phase, model) {
  return {
    type:      'phase_start',
    phase:     phase || 'do',
    provider:  PROVIDER_NAME,
    model:     model || null,
    timestamp: nowIso(),
  };
}

/**
 * provider 이름으로 phase_end 이벤트를 생성한다.
 *
 * @param {string} [phase]       phase 이름 (기본 'do')
 * @param {number} [duration_ms] 실행 시간 ms
 * @returns {object}
 */
function makePhaseEnd(phase, duration_ms) {
  return {
    type:        'phase_end',
    phase:       phase || 'do',
    status:      'completed',
    duration_ms: duration_ms || null,
    timestamp:   nowIso(),
  };
}

/**
 * failure 객체로 error 이벤트를 생성한다.
 *
 * @param {object} failure   createFailure() 반환값
 * @param {string} [phase]   phase 이름
 * @returns {object}
 */
function makeErrorEvent(failure, phase) {
  return {
    type:      'error',
    phase:     phase || 'do',
    timestamp: nowIso(),
    ...failureToEventFields(failure),
  };
}

// ---------------------------------------------------------------------------
// checkAvailability (선택)
// ---------------------------------------------------------------------------

/**
 * provider CLI / runtime 설치 여부를 확인한다.
 * provider가 사전 체크를 지원하는 경우 구현한다.
 *
 * SCAFFOLD_TODO: provider CLI/binary 확인 로직을 구현하거나 함수를 제거한다.
 *
 * @returns {{ available: boolean, detail: string }}
 */
function checkAvailability() {
  // 예:
  // const result = spawnSync('my-provider', ['--version'], { timeout: 5000 });
  // return { available: result.status === 0, detail: result.status === 0 ? 'ok' : 'not installed' };
  return { available: false, detail: 'checkAvailability not implemented' };
}

// ---------------------------------------------------------------------------
// 주 실행 함수
// ---------------------------------------------------------------------------

/**
 * 신규 provider를 실행하고 표준 이벤트를 onEvent로 전달한다.
 *
 * 구현 체크리스트:
 *   [ ] provider 프로세스/클라이언트 초기화
 *   [ ] signal.aborted 감지 후 interrupted failure emit
 *   [ ] 첫 이벤트로 phase_start emit
 *   [ ] text_delta, tool_call, tool_result 이벤트 순서대로 emit
 *   [ ] 종료 시 phase_end 또는 error emit (둘 중 하나만)
 *   [ ] 파일 직접 쓰기 금지 (fs.writeFile/writeFileSync/appendFile 등 사용 불가)
 *   [ ] 타임아웃 지원 (timeout_ms 또는 DEFAULT_TIMEOUT_MS)
 *   [ ] sandbox 값 검증 및 전달 ('read-only' | 'workspace-write')
 *   [ ] usage 이벤트 emit (provider가 지원하는 경우)
 *
 * @param {object}   opts
 * @param {string}   opts.prompt        provider에 전달할 프롬프트
 * @param {string}   [opts.model]       모델 ID
 * @param {function} [opts.onEvent]     표준 이벤트 콜백
 * @param {string}   [opts.sandbox]     'read-only' | 'workspace-write'
 * @param {number}   [opts.timeout_ms]  타임아웃 ms
 * @param {AbortSignal} [opts.signal]   취소 신호
 * @returns {Promise<{ success: boolean, exitCode: number, error?: string, failure?: object }>}
 */
async function runScaffold({ prompt, model, onEvent, sandbox, timeout_ms, signal } = {}) {
  if (!prompt) throw new TypeError('runScaffold: prompt is required');

  const phase      = 'do'; // SCAFFOLD_TODO: phase를 호출자에서 받거나 고정 값으로 설정한다.
  const timeoutMs  = timeout_ms || DEFAULT_TIMEOUT_MS;
  const startedAt  = Date.now();

  /**
   * onEvent 안전 래퍼. onEvent가 없어도 crash하지 않는다.
   * terminal 이벤트 이후 추가 emit을 방지하는 guard는 구현 시 추가한다.
   */
  function emit(event) {
    if (typeof onEvent === 'function') {
      try { onEvent(event); } catch (_) {}
    }
  }

  // AbortSignal 즉시 확인
  if (signal && signal.aborted) {
    const failure = createFailure({
      kind:         FAILURE_KINDS.INTERRUPTED,
      code:         `${PROVIDER_NAME}_interrupted`,
      user_message: `${PROVIDER_NAME} 실행이 취소되었습니다.`,
      retryable:    false,
      blocked:      false,
      raw_provider: PROVIDER_NAME,
    });
    emit(makeErrorEvent(failure, phase));
    return { success: false, exitCode: 1, ...failureToEventFields(failure) };
  }

  // --- phase_start emit ---
  emit(makePhaseStart(phase, model));

  // SCAFFOLD_TODO: 여기에 실제 provider 실행 로직을 구현한다.
  //
  // 패턴 예시 (프로세스 기반):
  //
  //   const child = spawn('my-provider-cli', [...args], { stdio: ['pipe','pipe','pipe'] });
  //   const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
  //   child.stdin.write(prompt); child.stdin.end();
  //
  //   child.stdout.on('data', (chunk) => {
  //     // 이벤트 파싱 후 emit:
  //     // emit({ type: 'text_delta', phase, text: '...', timestamp: nowIso() });
  //     // emit({ type: 'tool_call', phase, id: 'tc1', name: '...', timestamp: nowIso() });
  //     // emit({ type: 'tool_result', phase, id: 'tc1', status: 'completed', timestamp: nowIso() });
  //   });
  //
  //   const exitCode = await new Promise((resolve) => child.on('close', resolve));
  //   clearTimeout(timer);
  //
  // 패턴 예시 (HTTP/RPC 기반):
  //
  //   const response = await fetch('http://...', { signal, body: prompt });
  //   const data = await response.json();
  //   emit({ type: 'text_delta', phase, text: data.text, timestamp: nowIso() });
  //
  // 구현 중 오류 발생 시:
  //
  //   const failure = createFailure({
  //     kind:         FAILURE_KINDS.UNKNOWN,
  //     code:         `${PROVIDER_NAME}_unknown`,
  //     user_message: '...',
  //     retryable:    false,
  //     blocked:      false,
  //     debug_detail: sanitizeDebugDetail(err.message),
  //     raw_provider: PROVIDER_NAME,
  //   });
  //   emit(makeErrorEvent(failure, phase));
  //   return { success: false, exitCode: 1, ...failureToEventFields(failure) };

  // --- 미구현 상태에서 config failure 반환 ---
  const failure = createFailure({
    kind:         FAILURE_KINDS.CONFIG,
    code:         `${PROVIDER_NAME}_not_implemented`,
    user_message: `${PROVIDER_NAME} provider가 아직 구현되지 않았습니다.`,
    action:       'scaffold-template.js의 runScaffold 함수를 실제 구현으로 교체하세요.',
    retryable:    false,
    blocked:      true,
    raw_provider: PROVIDER_NAME,
  });
  emit(makeErrorEvent(failure, phase));
  return { success: false, exitCode: 1, ...failureToEventFields(failure) };

  // --- 정상 완료 시 (SCAFFOLD_TODO: 위 placeholder를 교체하면 이 부분이 실행됨) ---
  // const duration_ms = Date.now() - startedAt;
  // emit(makePhaseEnd(phase, duration_ms));
  // return { success: true, exitCode: 0 };
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = {
  runScaffold,
  checkAvailability,
  // SCAFFOLD_TODO: provider 이름에 맞게 export 이름을 변경한다.
  //   예: module.exports = { runGemini, checkAvailability };
};
