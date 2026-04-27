/**
 * src/providers/config.js
 *
 * phase별 provider 설정 parser.
 * run-request.json 또는 요청 설정 객체의 `providers` 필드를 normalize한다.
 *
 * API:
 *   parseProviderConfig(raw)
 *     → { [phase]: ProviderSpec }
 *     ProviderSpec: { name, model?, timeout_ms?, max_retries?, retry_delay_ms?, sandbox?, effort?, output_mode? }
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

const {
  PROVIDER_CAPABILITIES,
  SUPPORTED_PHASES,
  WRITE_REQUIRED_PHASES,
  getDefaultSandbox,
  validateSandbox: capValidateSandbox,
} = require('./capabilities');

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

const VALID_PROVIDERS = new Set(Object.keys(PROVIDER_CAPABILITIES));

const VALID_SANDBOXES = new Set(['read-only', 'workspace-write']);

const DEFAULT_RUN_PROFILE_PHASES = ['do', 'check', 'iter', 'report'];

// ---------------------------------------------------------------------------
// 내부 유틸
// ---------------------------------------------------------------------------

/**
 * 단축형(문자열) 또는 상세형(객체) provider 설정을 ProviderSpec으로 normalize.
 *
 * @param {string|object} raw  단축형: "claude" | "codex", 상세형: { name, ... }
 * @param {string} phase       phase 이름 (sandbox 검증에 사용)
 * @returns {{ name: string, model?: string, timeout_ms?: number, max_retries?: number, retry_delay_ms?: number, sandbox?: string, effort?: string, output_mode?: string }}
 * @throws {Error} 잘못된 provider 이름 또는 sandbox 조합
 */
function _normalizeSpec(raw, phase) {
  let spec;

  const isShorthand = typeof raw === 'string';

  if (isShorthand) {
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

  if (spec.timeout_ms !== undefined && (!Number.isFinite(Number(spec.timeout_ms)) || Number(spec.timeout_ms) <= 0)) {
    throw new Error(`providers.${phase}: timeout_ms는 양수 숫자여야 합니다.`);
  }

  if (spec.max_retries !== undefined && (!Number.isFinite(Number(spec.max_retries)) || Number(spec.max_retries) < 0)) {
    throw new Error(`providers.${phase}: max_retries는 0 이상의 숫자여야 합니다.`);
  }

  if (spec.retry_delay_ms !== undefined && (!Number.isFinite(Number(spec.retry_delay_ms)) || Number(spec.retry_delay_ms) < 0)) {
    throw new Error(`providers.${phase}: retry_delay_ms는 0 이상의 숫자여야 합니다.`);
  }

  // sandbox 정책 검증: capability registry에서 파생된 규칙을 적용한다.
  const sandboxError = capValidateSandbox(spec.name, phase, spec.sandbox);
  if (sandboxError) {
    throw new Error(`providers.${phase}: ${sandboxError}`);
  }

  // 불필요한 필드 제거 (알려지지 않은 키는 유지하되 허용 필드만 명시적으로 추출)
  const result = { name: spec.name };
  if (spec.model       !== undefined) result.model       = spec.model;
  if (spec.timeout_ms  !== undefined) result.timeout_ms  = Number(spec.timeout_ms);
  if (spec.max_retries !== undefined) result.max_retries = Math.floor(Number(spec.max_retries));
  if (spec.retry_delay_ms !== undefined) result.retry_delay_ms = Number(spec.retry_delay_ms);
  if (spec.sandbox     !== undefined) result.sandbox     = spec.sandbox;
  else if (isShorthand) {
    const defaultSandbox = getDefaultSandbox(spec.name, phase);
    if (defaultSandbox) result.sandbox = defaultSandbox;
  }
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

/**
 * default_run_profile.providers의 문자열 provider map을 검증하고 run-request용 ProviderSpec map으로 변환한다.
 * config에는 provider name만 저장하고, sandbox 같은 detail은 snapshot 생성 시 capability 정책으로 부여한다.
 *
 * @param {object} profile  { providers: { do, check, iter, report } }
 * @returns {{ [phase: string]: ProviderSpec }}
 * @throws {Error} 누락 phase, object ProviderSpec, 알 수 없는 provider 이름 등
 */
function normalizeDefaultRunProfileProviders(profile) {
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('default_run_profile은 객체여야 합니다.');
  }

  const providers = profile.providers;
  if (providers === null || typeof providers !== 'object' || Array.isArray(providers)) {
    throw new Error('default_run_profile.providers는 객체여야 합니다.');
  }

  const result = {};
  for (const phase of DEFAULT_RUN_PROFILE_PHASES) {
    if (!Object.prototype.hasOwnProperty.call(providers, phase)) {
      throw new Error(`default_run_profile.providers.${phase}: 필수 phase가 누락되었습니다.`);
    }

    const providerName = providers[phase];
    if (typeof providerName !== 'string' || providerName.length === 0) {
      throw new Error(
        `default_run_profile.providers.${phase}: provider name 문자열이어야 합니다. ` +
        'config에는 ProviderSpec 객체를 저장하지 않습니다.'
      );
    }

    if (!VALID_PROVIDERS.has(providerName)) {
      throw new Error(
        `default_run_profile.providers.${phase}: 알 수 없는 provider "${providerName}". ` +
        `유효한 provider: ${[...VALID_PROVIDERS].join(', ')}.`
      );
    }

    const sandbox = getDefaultSandbox(providerName, phase);
    result[phase] = sandbox ? { name: providerName, sandbox } : { name: providerName };
  }

  const unknownPhases = Object.keys(providers).filter((phase) => !DEFAULT_RUN_PROFILE_PHASES.includes(phase));
  if (unknownPhases.length > 0) {
    throw new Error(`default_run_profile.providers: 알 수 없는 phase ${unknownPhases.map((p) => `"${p}"`).join(', ')}.`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = {
  parseProviderConfig,
  getProviderForPhase,
  normalizeDefaultRunProfileProviders,
  SUPPORTED_PHASES,
  VALID_PROVIDERS,
  DEFAULT_RUN_PROFILE_PHASES,
};
