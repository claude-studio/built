/**
 * src/providers/capabilities.js
 *
 * Provider capability registry.
 * provider별 지원 phase, sandbox 정책, outputSchema 지원, app-server 필요 여부,
 * 기본 timeout을 한 곳에서 관리한다.
 *
 * config parser, doctor, 문서가 이 모듈에서 정보를 파생한다.
 *
 * API:
 *   PROVIDER_CAPABILITIES  — provider 이름 → capability 정의 맵
 *   getCapability(name)    — ProviderCapability 반환. 알 수 없는 provider는 오류.
 *   isPhaseSupported(name, phase)     — provider가 phase를 지원하면 true
 *   requiresWrite(phase)              — phase가 파일 변경을 필요로 하면 true (do/iter)
 *   getDefaultSandbox(name, phase)    — provider+phase 기본 sandbox 문자열 반환
 *   validateSandbox(name, phase, sandbox) — sandbox 조합 검증. 문제가 있으면 오류 문자열 반환, 없으면 null
 *
 * docs/contracts/provider-config.md 참고.
 */

'use strict';

// ---------------------------------------------------------------------------
// Phase 정책 상수
// ---------------------------------------------------------------------------

/** 파일 변경이 필요한 phase. Codex 사용 시 workspace-write sandbox 필수. */
const WRITE_REQUIRED_PHASES = new Set(['do', 'iter']);

/** 읽기 전용으로 동작하는 phase. sandbox는 read-only가 기본. */
const READ_ONLY_PHASES = new Set(['plan_synthesis', 'check', 'report']);

/** built 전체 지원 phase 목록. */
const SUPPORTED_PHASES = ['plan_synthesis', 'do', 'check', 'iter', 'report'];

// ---------------------------------------------------------------------------
// Provider capability 정의
// ---------------------------------------------------------------------------

/**
 * @typedef {object} ProviderCapability
 * @property {Set<string>} supportedPhases      - 지원하는 phase 집합
 * @property {boolean}     requiresAppServer    - codex app-server 프로세스 필요 여부
 * @property {boolean}     supportsOutputSchema - outputSchema(structured output) 지원 여부
 * @property {number}      defaultTimeoutMs     - 기본 timeout (ms)
 * @property {string|null} defaultSandbox       - 기본 sandbox 값 (null이면 sandbox 개념 없음)
 * @property {string|null} writeRequiredSandbox - write 필요 phase에서 요구하는 sandbox
 */

/** @type {{ [name: string]: ProviderCapability }} */
const PROVIDER_CAPABILITIES = {
  /**
   * Claude CLI provider.
   * - 모든 phase 지원.
   * - sandbox 개념 없음: Claude CLI는 자체적으로 파일 접근 권한을 관리하지 않음.
   * - outputSchema: --json-schema 플래그를 통한 structured output 지원.
   * - app-server 없음: claude CLI 직접 실행.
   */
  claude: {
    supportedPhases:      new Set(SUPPORTED_PHASES),
    requiresAppServer:    false,
    supportsOutputSchema: true,
    defaultTimeoutMs:     30 * 60 * 1000, // 30분
    defaultSandbox:       null,            // sandbox 개념 없음
    writeRequiredSandbox: null,            // Claude는 sandbox 제약 없음
  },

  /**
   * Codex app-server provider.
   * - 모든 phase 지원.
   * - sandbox: read-only (기본) / workspace-write (파일 변경 필요 phase).
   * - do/iter phase에서 파일 변경이 필요하므로 workspace-write 필수.
   * - check/report/plan_synthesis는 read-only로 충분.
   * - outputSchema: outputSchema 파라미터를 통한 structured output 지원.
   * - app-server 필요: codex 프로세스가 백그라운드에서 동작해야 함.
   */
  codex: {
    supportedPhases:      new Set(SUPPORTED_PHASES),
    requiresAppServer:    true,
    supportsOutputSchema: true,
    defaultTimeoutMs:     30 * 60 * 1000, // 30분
    defaultSandbox:       'read-only',
    writeRequiredSandbox: 'workspace-write',
  },
};

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * provider capability를 반환한다.
 *
 * @param {string} name  provider 이름 ('claude', 'codex')
 * @returns {ProviderCapability}
 * @throws {Error} 알 수 없는 provider 이름
 */
function getCapability(name) {
  const cap = PROVIDER_CAPABILITIES[name];
  if (!cap) {
    const known = Object.keys(PROVIDER_CAPABILITIES).join(', ');
    throw new Error(
      `알 수 없는 provider "${name}". 지원하는 provider: ${known}. ` +
      `새 provider 추가는 src/providers/capabilities.js에 먼저 등록하세요.`
    );
  }
  return cap;
}

/**
 * provider가 특정 phase를 지원하는지 확인한다.
 *
 * @param {string} name   provider 이름
 * @param {string} phase  phase 이름
 * @returns {boolean}
 */
function isPhaseSupported(name, phase) {
  try {
    return getCapability(name).supportedPhases.has(phase);
  } catch (_) {
    return false;
  }
}

/**
 * phase가 파일 변경(write)을 필요로 하는지 확인한다.
 * do/iter는 true, 나머지는 false.
 *
 * @param {string} phase
 * @returns {boolean}
 */
function requiresWrite(phase) {
  return WRITE_REQUIRED_PHASES.has(phase);
}

/**
 * provider와 phase 조합의 기본 sandbox 값을 반환한다.
 *
 * @param {string} name   provider 이름
 * @param {string} phase  phase 이름
 * @returns {string|null}  기본 sandbox 값. null이면 sandbox 미적용.
 */
function getDefaultSandbox(name, phase) {
  const cap = getCapability(name);
  if (cap.defaultSandbox === null) return null;

  if (WRITE_REQUIRED_PHASES.has(phase) && cap.writeRequiredSandbox) {
    return cap.writeRequiredSandbox;
  }
  return cap.defaultSandbox;
}

/**
 * provider + phase + sandbox 조합이 유효한지 검증한다.
 * 문제가 있으면 한글 오류 메시지 문자열을 반환한다. 유효하면 null.
 *
 * 규칙:
 * - sandbox 개념 없는 provider(claude)는 sandbox 값에 무관하게 허용.
 * - write 필요 phase(do/iter) + sandbox가 있는 provider + read-only → 오류.
 *   파일 변경이 불가능하기 때문.
 *
 * @param {string}      name     provider 이름
 * @param {string}      phase    phase 이름
 * @param {string|null} sandbox  sandbox 값 ('read-only', 'workspace-write', 등)
 * @returns {string|null}  오류 메시지 문자열 또는 null
 */
function validateSandbox(name, phase, sandbox) {
  let cap;
  try {
    cap = getCapability(name);
  } catch (e) {
    return e.message;
  }

  // sandbox 개념 없는 provider(claude)는 sandbox 검증 생략
  if (cap.defaultSandbox === null) return null;

  // write 필요 phase에서 read-only sandbox 사용 → 파일 변경 불가
  if (WRITE_REQUIRED_PHASES.has(phase) && sandbox === 'read-only' && cap.writeRequiredSandbox) {
    return (
      `"${name}" provider가 "${phase}" phase에서 "read-only" sandbox를 사용하면 ` +
      `파일 변경이 불가능합니다. "${cap.writeRequiredSandbox}"를 사용하세요.`
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = {
  PROVIDER_CAPABILITIES,
  SUPPORTED_PHASES,
  WRITE_REQUIRED_PHASES,
  READ_ONLY_PHASES,
  getCapability,
  isPhaseSupported,
  requiresWrite,
  getDefaultSandbox,
  validateSandbox,
};
