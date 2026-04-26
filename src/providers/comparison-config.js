/**
 * src/providers/comparison-config.js
 *
 * run-request.json의 comparison 필드를 파싱하고 검증한다.
 *
 * API:
 *   parseComparisonConfig(runRequest)
 *     → ComparisonConfig | null
 *     null: comparison.enabled: true가 아닌 경우
 *
 *   generateComparisonId()
 *     → string  KST 기준 timestamp ID
 *
 * ComparisonConfig:
 *   {
 *     id:           string,
 *     phase:        'do',      // MVP는 do만 허용
 *     base_ref:     string,
 *     candidates:   Array<{ id: string, provider: { name: string, ... } }>,
 *     verification: { commands: string[], smoke: boolean },
 *     report:       { format: string },
 *   }
 *
 * docs/ops/provider-comparison-mode.md 참고.
 * kg/decisions/provider-comparison-mode-boundary.md (ADR-12) 참고.
 */

'use strict';

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------

/**
 * KST 기준 타임스탬프 비교 ID를 생성한다.
 * 형식: YYYYMMDDHHmmSS-do
 *
 * @returns {string}
 */
function generateComparisonId() {
  const now = new Date();
  // KST = UTC+9
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const p   = (n, l = 2) => String(n).padStart(l, '0');
  return (
    kst.getUTCFullYear() +
    p(kst.getUTCMonth() + 1) +
    p(kst.getUTCDate()) +
    '-' +
    p(kst.getUTCHours()) +
    p(kst.getUTCMinutes()) +
    p(kst.getUTCSeconds()) +
    '-do'
  );
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * run-request.json 또는 요청 객체의 comparison 필드를 파싱해 ComparisonConfig를 반환한다.
 *
 * @param {object|null|undefined} runRequest  run-request 객체 전체
 * @returns {ComparisonConfig|null}  enabled: true가 아니면 null
 * @throws {Error} 필수 필드 누락 또는 MVP 범위 위반
 */
function parseComparisonConfig(runRequest) {
  const comp = runRequest && runRequest.comparison;

  // comparison 필드 없거나 enabled: true가 아니면 비교 모드 비활성
  if (!comp) return null;
  if (comp.enabled !== true) return null;

  // phase 검증: MVP는 do만 허용
  const phase = typeof comp.phase === 'string' ? comp.phase : 'do';
  if (phase !== 'do') {
    throw new Error(
      `comparison.phase: MVP는 "do"만 지원합니다. "${phase}"는 지원하지 않습니다.`
    );
  }

  // candidates 검증
  if (!Array.isArray(comp.candidates) || comp.candidates.length === 0) {
    throw new Error('comparison.candidates: 최소 1개 이상의 candidate가 필요합니다.');
  }

  for (let i = 0; i < comp.candidates.length; i++) {
    const c = comp.candidates[i];
    if (!c.id || typeof c.id !== 'string') {
      throw new Error(`comparison.candidates[${i}].id: 필수 문자열 필드입니다.`);
    }
    if (!c.provider || typeof c.provider !== 'object' || Array.isArray(c.provider)) {
      throw new Error(`comparison.candidates[${i}].provider: 필수 객체 필드입니다.`);
    }
    if (!c.provider.name || typeof c.provider.name !== 'string') {
      throw new Error(`comparison.candidates[${i}].provider.name: 필수 문자열 필드입니다.`);
    }
  }

  return {
    id:         (typeof comp.id === 'string' && comp.id) ? comp.id : generateComparisonId(),
    phase,
    base_ref:   (typeof comp.base_ref === 'string' && comp.base_ref) ? comp.base_ref : 'HEAD',
    candidates: comp.candidates.map((c) => ({
      id:       c.id,
      provider: { ...c.provider },
    })),
    verification: {
      commands: Array.isArray(comp.verification && comp.verification.commands)
        ? comp.verification.commands
        : [],
      smoke: !!(comp.verification && comp.verification.smoke),
    },
    report: (comp.report && typeof comp.report === 'object')
      ? comp.report
      : { format: 'markdown' },
  };
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = { parseComparisonConfig, generateComparisonId };
