#!/usr/bin/env node
/**
 * smoke-artifact.js
 *
 * smoke 실행 결과를 구조화된 artifact로 저장하는 유틸리티.
 * 저장 경로: .built/runtime/smoke/<id>/summary.json
 *
 * secret, token, raw debug dump는 저장하지 않는다.
 * sanitize.js의 redaction 함수를 재사용한다.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { sanitizeJson } = require('./sanitize');

// ---------------------------------------------------------------------------
// failure taxonomy
// ---------------------------------------------------------------------------

/**
 * 표준 실패 분류.
 * smoke 스크립트에서 원인축을 판정할 때 이 값을 사용한다.
 */
const FAILURE_KINDS = [
  'provider_unavailable',
  'app_server',
  'auth',
  'sandbox',
  'timeout',
  'model_response',
  'unknown',
];

// ---------------------------------------------------------------------------
// artifact 생성
// ---------------------------------------------------------------------------

/**
 * smoke summary artifact를 생성한다.
 *
 * @param {object} params
 * @param {string} params.provider        - 'codex'
 * @param {string} params.phase           - 'plan_synthesis' | 'do'
 * @param {string} [params.model]         - 사용된 모델 (알 수 있으면)
 * @param {number} params.duration_ms     - 실행 시간 (ms)
 * @param {boolean} params.skipped        - opt-in 환경변수 없이 skip된 경우
 * @param {boolean} params.success        - 성공 여부
 * @param {string|null} [params.failure_kind] - FAILURE_KINDS 중 하나
 * @param {string|null} [params.failure_message] - 사람이 읽을 수 있는 한글 실패 요약
 * @param {object|null} [params.verification]    - 검증 명령 결과
 * @param {object|null} [params.extra]           - 추가 메타 (provider별 정보)
 * @returns {object} summary artifact 객체
 */
function createSummary(params) {
  const now = new Date();
  const summary = {
    schema_version: '1.0.0',
    id: formatTimestamp(now),
    created_at: now.toISOString(),
    provider: params.provider,
    phase: params.phase,
    model: params.model || null,
    duration_ms: params.duration_ms,
    skipped: params.skipped || false,
    success: params.success,
    failure: null,
    verification: params.verification || null,
  };

  if (!params.success && !params.skipped) {
    summary.failure = {
      kind: params.failure_kind || 'unknown',
      message: params.failure_message || null,
    };
  }

  // sanitize: secret/token/홈경로 등 redaction
  return sanitizeJson(summary, { maskSession: true });
}

// ---------------------------------------------------------------------------
// 저장
// ---------------------------------------------------------------------------

/**
 * summary artifact를 .built/runtime/smoke/<id>/summary.json에 저장한다.
 *
 * @param {string} projectRoot - 프로젝트 루트 (보통 process.cwd() 또는 built 루트)
 * @param {object} summary     - createSummary()로 생성된 artifact
 * @returns {string} 저장된 파일의 절대 경로
 */
function saveSummary(projectRoot, summary) {
  const dir = path.join(projectRoot, '.built', 'runtime', 'smoke', summary.id);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'summary.json');
  fs.writeFileSync(filePath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  return filePath;
}

// ---------------------------------------------------------------------------
// 한글 실패 요약 생성
// ---------------------------------------------------------------------------

/**
 * failure_kind에 따라 사용자가 이슈/코멘트에 붙일 수 있는 짧은 한글 요약을 반환한다.
 *
 * @param {string} kind     - FAILURE_KINDS 중 하나
 * @param {string} phase    - 'plan_synthesis' | 'do'
 * @param {string} [detail] - 추가 상세 정보
 * @returns {string}
 */
function formatFailureSummary(kind, phase, detail) {
  const phaseLabel = phase === 'plan_synthesis' ? 'plan' : phase;
  const prefix = `[smoke:${phaseLabel}]`;

  const messages = {
    provider_unavailable: `${prefix} Codex CLI 미설치 또는 PATH 문제`,
    app_server: `${prefix} Codex CLI가 app-server 명령을 지원하지 않음 (CLI 업데이트 필요)`,
    auth: `${prefix} Codex 인증 실패 (codex login 필요)`,
    sandbox: `${prefix} sandbox 설정 불일치 (workspace-write 필요)`,
    timeout: `${prefix} 실행 시간 초과`,
    model_response: `${prefix} 모델 출력 파싱 실패 또는 산출물 구조 불일치`,
    unknown: `${prefix} 미분류 실패`,
  };

  let msg = messages[kind] || messages.unknown;
  if (detail) {
    msg += ` — ${detail}`;
  }
  return msg;
}

// ---------------------------------------------------------------------------
// 타임스탬프 포맷
// ---------------------------------------------------------------------------

function formatTimestamp(date) {
  const pad = (n, len) => String(n).padStart(len || 2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = {
  FAILURE_KINDS,
  createSummary,
  saveSummary,
  formatFailureSummary,
  formatTimestamp,
};
