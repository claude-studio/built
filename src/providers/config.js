/**
 * src/providers/config.js
 *
 * phase별 provider 설정 parser.
 * run-request.json 또는 요청 설정 객체의 `providers` 필드를 normalize한다.
 *
 * API:
 *   parseProviderConfig(raw)
 *     → { [phase]: ProviderSpec }
 *     ProviderSpec: { name, model?, timeout_ms?, sandbox?, effort?, output_mode? }
 *
 *   getProviderForPhase(config, phase)
 *     → ProviderSpec
 *
 * 단축형:
 *   { "providers": { "do": "codex" } }
 *
 * 상세형:
 *   { "providers": { "do": { "name": "codex", "model": "gpt-5.5", "sandbox": "workspace-write" } } }
 *
 * 설정 없음: 모든 phase에서 claude 기본값 반환.
 *
 * docs/contracts/provider-config.md 참고.
 */

'use strict';

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

const VALID_PROVIDERS = new Set(['claude', 'codex']);

/** 지원 phase 목록 */
const SUPPORTED_PHASES = ['plan_synthesis', 'do', 'check', 'iter', 'report'];

/**
 * phase별 sandbox 정책.
 * write가 필요한 phase에서 read-only sandbox를 사용하면 오류.
 */
const WRITE_REQUIRED_PHASES = new Set(['do', 'iter']);

const VALID_SANDBOXES = new Set(['read-only', 'workspace-write']);

// ---------------------------------------------------------------------------
// 내부 유틸
// ---------------------------------------------------------------------------

/**
 * 단축형(문자열) 또는 상세형(객체) provider 설정을 ProviderSpec으로 normalize.
 *
 * @param {string|object} raw  단축형: "claude" | "codex", 상세형: { name, ... }
 * @param {string} phase       phase 이름 (sandbox 검증에 사용)
 * @returns {{ name: string, model?: string, timeout_ms?: number, sandbox?: string, effort?: string, output_mode?: string }}
 * @throws {Error} 잘못된 provider 이름 또는 sandbox 조합
 */
function _normalizeSpec(raw, phase) {
  let spec;

  if (typeof raw === 'string') {
    // 단축형: provider 이름만
    spec = { name: raw };
  } else if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    // 상세형: name 필수
    if (!raw.name) {
      throw new Error(`providers.${phase}: "name" 필드가 필요합니다.`);
    }
    spec = { ...raw };
  } else {
    throw new Error(`providers.${phase}: 유효하지 않은 provider 설정 형식입니다. 문자열 또는 객체여야 합니다.`);
  }

  // provider 이름 검증
  if (!VALID_PROVIDERS.has(spec.name)) {
    throw new Error(
      `providers.${phase}: 알 수 없는 provider "${spec.name}". 유효한 provider: ${[...VALID_PROVIDERS].join(', ')}.`
    );
  }

  // sandbox 값 검증
  if (spec.sandbox !== undefined && !VALID_SANDBOXES.has(spec.sandbox)) {
    throw new Error(
      `providers.${phase}: 유효하지 않은 sandbox 값 "${spec.sandbox}". 유효한 값: ${[...VALID_SANDBOXES].join(', ')}.`
    );
  }

  // sandbox 정책 검증: do/iter에서 claude가 아닌 provider + read-only 조합
  // claude는 sandbox 개념 없음; Codex + read-only + write 필요 phase는 명확한 실패
  if (
    WRITE_REQUIRED_PHASES.has(phase) &&
    spec.name !== 'claude' &&
    spec.sandbox === 'read-only'
  ) {
    throw new Error(
      `providers.${phase}: "${spec.name}" provider가 "${phase}" phase에서 "read-only" sandbox를 사용하면 파일 변경이 불가능합니다. "workspace-write"를 사용하세요.`
    );
  }

  // 불필요한 필드 제거 (알려지지 않은 키는 유지하되 허용 필드만 명시적으로 추출)
  const result = { name: spec.name };
  if (spec.model       !== undefined) result.model       = spec.model;
  if (spec.timeout_ms  !== undefined) result.timeout_ms  = spec.timeout_ms;
  if (spec.sandbox     !== undefined) result.sandbox     = spec.sandbox;
  if (spec.effort      !== undefined) result.effort      = spec.effort;
  if (spec.output_mode !== undefined) result.output_mode = spec.output_mode;

  return result;
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * 요청 설정(또는 providers 맵 직접)을 받아 phase별 ProviderSpec 맵을 반환한다.
 *
 * @param {object|null|undefined} rawConfig  run-request 객체 또는 providers 맵
 *   - rawConfig.providers: phase → spec 맵
 *   - rawConfig 자체가 null/undefined이면 기본값 반환
 * @returns {{ [phase: string]: ProviderSpec }}  phase별 normalized ProviderSpec
 * @throws {Error} 잘못된 provider 이름, sandbox 조합, 형식 오류
 */
function parseProviderConfig(rawConfig) {
  const rawProviders = (rawConfig && rawConfig.providers) || {};

  if (typeof rawProviders !== 'object' || Array.isArray(rawProviders)) {
    throw new Error('"providers" 필드는 객체여야 합니다.');
  }

  const result = {};

  for (const phase of Object.keys(rawProviders)) {
    result[phase] = _normalizeSpec(rawProviders[phase], phase);
  }

  return result;
}

/**
 * 파싱된 provider config에서 특정 phase의 ProviderSpec을 반환한다.
 * 설정이 없으면 기본값(claude)을 반환한다.
 *
 * @param {{ [phase: string]: ProviderSpec }} config  parseProviderConfig 반환값
 * @param {string} phase
 * @returns {ProviderSpec}  최소 { name: 'claude' }
 */
function getProviderForPhase(config, phase) {
  if (config && config[phase]) {
    return config[phase];
  }
  // phase별 기본값: 모두 claude
  return { name: 'claude' };
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = { parseProviderConfig, getProviderForPhase, SUPPORTED_PHASES, VALID_PROVIDERS };
