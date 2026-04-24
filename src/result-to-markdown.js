#!/usr/bin/env node
/**
 * result-to-markdown.js
 *
 * pipeline-runner의 stream-json result 이벤트 객체를 받아
 * do-result.md (YAML frontmatter + 본문) 형식으로 변환 저장.
 *
 * API:
 *   convert(result, outputPath) -> void
 *
 * result 객체 필드:
 *   feature_id   {string}           피처 식별자
 *   subtype      {string}           'success' | 'error'  (status 미제공 시 사용)
 *   status       {string?}          'completed' | 'failed'  (직접 지정 시 우선)
 *   model        {string?}          모델 이름
 *   total_cost_usd {number?}        총 비용 (cost_usd 미제공 시 사용)
 *   cost_usd     {number?}          총 비용
 *   duration_ms  {number?}          소요 시간(ms)  (미제공 시 started_at/updated_at으로 계산)
 *   started_at   {string?}          시작 ISO 타임스탬프
 *   updated_at   {string?}          종료 ISO 타임스탬프
 *   created_at   {string?}          frontmatter created_at 값 (미제공 시 updated_at 또는 현재)
 *   result       {string?}          Claude 응답 전문 (본문)
 *
 * BUILT-DESIGN.md §8 기준.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { stringify } = require('./frontmatter');

// ---------------------------------------------------------------------------
// 내부 헬퍼
// ---------------------------------------------------------------------------

/**
 * status 결정: 명시 제공 → subtype 파생 → 'completed' 기본값
 */
function resolveStatus(result) {
  if (result.status === 'completed' || result.status === 'failed') {
    return result.status;
  }
  if (result.subtype === 'success') return 'completed';
  if (result.subtype === 'error') return 'failed';
  return 'completed';
}

/**
 * cost_usd 결정: cost_usd → total_cost_usd → null
 */
function resolveCostUsd(result) {
  if (typeof result.cost_usd === 'number') return result.cost_usd;
  if (typeof result.total_cost_usd === 'number') return result.total_cost_usd;
  return null;
}

/**
 * duration_ms 결정: duration_ms → started_at/updated_at 차이 → null
 */
function resolveDurationMs(result) {
  if (typeof result.duration_ms === 'number') return result.duration_ms;
  if (result.started_at && result.updated_at) {
    const diff = Date.parse(result.updated_at) - Date.parse(result.started_at);
    if (!isNaN(diff)) return diff;
  }
  return null;
}

/**
 * created_at 결정: created_at → updated_at → 현재 시각 ISO
 */
function resolveCreatedAt(result) {
  if (result.created_at) return result.created_at;
  if (result.updated_at) return result.updated_at;
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// convert
// ---------------------------------------------------------------------------

/**
 * stream-json result 이벤트 객체를 do-result.md 형식으로 변환 후 outputPath에 저장.
 *
 * @param {object} result      pipeline-runner가 제공하는 결과 객체
 * @param {string} outputPath  저장 경로 (예: .built/runs/<feature>/do-result.md)
 */
function convert(result, outputPath) {
  if (result === null || typeof result !== 'object') {
    throw new TypeError('convert: result must be a non-null object');
  }
  if (typeof outputPath !== 'string' || outputPath === '') {
    throw new TypeError('convert: outputPath must be a non-empty string');
  }

  const frontmatterData = {
    feature_id: result.feature_id != null ? String(result.feature_id) : null,
    status: resolveStatus(result),
    model: result.model != null ? String(result.model) : null,
    cost_usd: resolveCostUsd(result),
    duration_ms: resolveDurationMs(result),
    created_at: resolveCreatedAt(result),
  };

  const body = typeof result.result === 'string' ? result.result : '';

  const content = stringify(frontmatterData, body);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, content, 'utf8');
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = { convert };
