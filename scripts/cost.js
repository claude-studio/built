#!/usr/bin/env node
/**
 * cost.js
 *
 * /built:cost 스킬 헬퍼 — feature별/전체 비용 집계 조회.
 * .built/features/<feature>/progress.json의 cost_usd 필드를 읽어 출력한다.
 *
 * 사용법:
 *   node scripts/cost.js --feature <name>            # 특정 feature 비용 조회
 *   node scripts/cost.js --all                       # 전체 feature 비용 합산 + 테이블
 *   node scripts/cost.js --all --format json         # JSON 출력
 *   node scripts/cost.js --feature <name> --format json
 *
 * 옵션:
 *   --feature <name>  특정 feature의 비용 조회
 *   --all             모든 feature 비용 합산 출력
 *   --format json     JSON 형식으로 출력
 *
 * Exit codes:
 *   0 — 성공
 *   1 — 오류 (feature 없음 등)
 *
 * API (모듈로도 사용 가능):
 *   readFeatureCost(projectRoot, featureName) -> { feature, cost_usd, phase, input_tokens, output_tokens, updated_at } | null
 *   collectAllFeatureCosts(projectRoot)       -> Array<{ feature, cost_usd, ... }>
 *   formatTable(costs)                        -> string
 *   costCommand(projectRoot, opts)            -> { output: string, ok: boolean, data: object }
 *
 * 외부 npm 패키지 없음 (Node.js fs/path만).
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// 내부 유틸
// ---------------------------------------------------------------------------

/**
 * JSON 파일을 읽어 파싱. 파일이 없거나 파싱 실패 시 null 반환.
 * @param {string} filePath
 * @returns {object|null}
 */
function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * 숫자를 달러 문자열로 포맷 ($0.0000 형식).
 * @param {number} usd
 * @returns {string}
 */
function formatUsd(usd) {
  return `$${usd.toFixed(4)}`;
}

/**
 * 텍스트를 주어진 너비로 좌측 정렬 (공백 패딩).
 * @param {string} str
 * @param {number} width
 * @returns {string}
 */
function padEnd(str, width) {
  return String(str).padEnd(width);
}

/**
 * 텍스트를 주어진 너비로 우측 정렬 (공백 패딩).
 * @param {string} str
 * @param {number} width
 * @returns {string}
 */
function padStart(str, width) {
  return String(str).padStart(width);
}

// ---------------------------------------------------------------------------
// 핵심 읽기 함수
// ---------------------------------------------------------------------------

/**
 * 특정 feature의 비용 정보를 읽어 반환한다.
 * .built/features/<featureName>/progress.json을 읽는다.
 *
 * @param {string} projectRoot  프로젝트 루트 절대경로
 * @param {string} featureName  feature 이름
 * @returns {{ feature: string, cost_usd: number, phase: string|null, input_tokens: number, output_tokens: number, updated_at: string|null } | null}
 *          progress.json이 없거나 파싱 실패 시 null 반환
 */
function readFeatureCost(projectRoot, featureName) {
  const progressPath = path.join(projectRoot, '.built', 'features', featureName, 'progress.json');
  const data = readJsonSafe(progressPath);
  if (!data) return null;

  return {
    feature:       featureName,
    cost_usd:      typeof data.cost_usd === 'number' ? data.cost_usd : 0,
    phase:         data.phase || null,
    input_tokens:  typeof data.input_tokens === 'number' ? data.input_tokens : 0,
    output_tokens: typeof data.output_tokens === 'number' ? data.output_tokens : 0,
    updated_at:    data.updated_at || null,
  };
}

/**
 * 모든 feature의 비용 정보를 수집한다.
 * registry.json → .built/features/ 디렉토리 순서로 탐색한다.
 *
 * @param {string} projectRoot
 * @returns {Array<{ feature: string, cost_usd: number, phase: string|null, input_tokens: number, output_tokens: number, updated_at: string|null }>}
 */
function collectAllFeatureCosts(projectRoot) {
  const featuresDir = path.join(projectRoot, '.built', 'features');
  const runtimeDir  = path.join(projectRoot, '.built', 'runtime');

  // registry.json에서 feature 목록 시도
  const registry = readJsonSafe(path.join(runtimeDir, 'registry.json'));
  let featureNames = null;

  if (registry && registry.features && typeof registry.features === 'object') {
    featureNames = Object.keys(registry.features);
  }

  // registry 없으면 .built/features/ 디렉토리 탐색
  if (!featureNames) {
    if (!fs.existsSync(featuresDir)) return [];
    try {
      featureNames = fs.readdirSync(featuresDir).filter((entry) => {
        try {
          return fs.statSync(path.join(featuresDir, entry)).isDirectory();
        } catch (_) {
          return false;
        }
      });
    } catch (_) {
      return [];
    }
  }

  return featureNames
    .map((name) => readFeatureCost(projectRoot, name))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// 포맷 함수
// ---------------------------------------------------------------------------

/**
 * 비용 목록을 텍스트 테이블로 포맷한다.
 *
 * @param {Array<{ feature: string, cost_usd: number, phase: string|null, input_tokens: number, output_tokens: number }>} costs
 * @returns {string}
 */
function formatTable(costs) {
  if (costs.length === 0) {
    return 'No feature cost data found.';
  }

  // 컬럼 너비 계산
  const featureWidth = Math.max(7, ...costs.map((c) => c.feature.length));
  const costWidth    = Math.max(10, ...costs.map((c) => formatUsd(c.cost_usd).length));
  const phaseWidth   = Math.max(5, ...costs.map((c) => (c.phase || '-').length));
  const tokenWidth   = Math.max(6, ...costs.map((c) => String(c.input_tokens + c.output_tokens).length));

  const header = [
    padEnd('feature', featureWidth),
    padStart('cost', costWidth),
    padEnd('phase', phaseWidth),
    padStart('tokens', tokenWidth),
  ].join('  ');

  const separator = '-'.repeat(header.length);

  const rows = costs.map((c) => [
    padEnd(c.feature, featureWidth),
    padStart(formatUsd(c.cost_usd), costWidth),
    padEnd(c.phase || '-', phaseWidth),
    padStart(String(c.input_tokens + c.output_tokens), tokenWidth),
  ].join('  '));

  const totalCost   = costs.reduce((sum, c) => sum + c.cost_usd, 0);
  const totalTokens = costs.reduce((sum, c) => sum + c.input_tokens + c.output_tokens, 0);

  const totalRow = [
    padEnd('TOTAL', featureWidth),
    padStart(formatUsd(totalCost), costWidth),
    padEnd('', phaseWidth),
    padStart(String(totalTokens), tokenWidth),
  ].join('  ');

  return [header, separator, ...rows, separator, totalRow].join('\n');
}

/**
 * 단일 feature 비용을 텍스트로 포맷한다.
 *
 * @param {{ feature: string, cost_usd: number, phase: string|null, input_tokens: number, output_tokens: number, updated_at: string|null }} costInfo
 * @returns {string}
 */
function formatSingle(costInfo) {
  const lines = [
    `feature:       ${costInfo.feature}`,
    `cost:          ${formatUsd(costInfo.cost_usd)}`,
    `phase:         ${costInfo.phase || '-'}`,
    `input_tokens:  ${costInfo.input_tokens}`,
    `output_tokens: ${costInfo.output_tokens}`,
    `total_tokens:  ${costInfo.input_tokens + costInfo.output_tokens}`,
    `updated_at:    ${costInfo.updated_at || '-'}`,
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 명령 실행 함수
// ---------------------------------------------------------------------------

/**
 * /built:cost 명령을 실행한다.
 *
 * @param {string} projectRoot
 * @param {{ feature?: string, all?: boolean, format?: string }} opts
 * @returns {{ output: string, ok: boolean, data: object }}
 */
function costCommand(projectRoot, opts = {}) {
  const { feature, all, format } = opts;
  const jsonMode = format === 'json';

  // --feature <name>: 특정 feature 조회
  if (feature && !all) {
    const costInfo = readFeatureCost(projectRoot, feature);

    if (!costInfo) {
      const msg = `No cost data found for feature: ${feature}\n` +
                  `(.built/features/${feature}/progress.json 없음)`;
      if (jsonMode) {
        return { output: JSON.stringify({ error: msg }, null, 2), ok: false, data: { error: msg } };
      }
      return { output: msg, ok: false, data: { error: msg } };
    }

    if (jsonMode) {
      return { output: JSON.stringify(costInfo, null, 2), ok: true, data: costInfo };
    }

    return { output: formatSingle(costInfo), ok: true, data: costInfo };
  }

  // --all: 전체 feature 비용 집계
  if (all) {
    const costs = collectAllFeatureCosts(projectRoot);

    if (costs.length === 0) {
      const msg = 'No feature cost data found.\n' +
                  '(.built/features/ 에 progress.json이 있는 feature가 없습니다)';
      if (jsonMode) {
        const data = { features: [], total_cost_usd: 0, total_tokens: 0 };
        return { output: JSON.stringify(data, null, 2), ok: true, data };
      }
      return { output: msg, ok: true, data: { features: [], total_cost_usd: 0, total_tokens: 0 } };
    }

    const totalCostUsd = costs.reduce((sum, c) => sum + c.cost_usd, 0);
    const totalTokens  = costs.reduce((sum, c) => sum + c.input_tokens + c.output_tokens, 0);

    const data = {
      features:       costs,
      total_cost_usd: totalCostUsd,
      total_tokens:   totalTokens,
    };

    if (jsonMode) {
      return { output: JSON.stringify(data, null, 2), ok: true, data };
    }

    return { output: formatTable(costs), ok: true, data };
  }

  // 인자 없음
  const usage = [
    'Usage:',
    '  node scripts/cost.js --feature <name>           # 특정 feature 비용 조회',
    '  node scripts/cost.js --all                      # 전체 feature 비용 합산 + 테이블',
    '  node scripts/cost.js --all --format json        # JSON 출력',
    '  node scripts/cost.js --feature <name> --format json',
  ].join('\n');

  return { output: usage, ok: false, data: {} };
}

// ---------------------------------------------------------------------------
// 모듈 exports (테스트용)
// ---------------------------------------------------------------------------

module.exports = {
  readFeatureCost,
  collectAllFeatureCosts,
  formatTable,
  formatSingle,
  costCommand,
};

// ---------------------------------------------------------------------------
// CLI 진입점
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args    = process.argv.slice(2);
  const featureIdx = args.indexOf('--feature');
  const feature    = featureIdx !== -1 ? args[featureIdx + 1] : undefined;
  const all        = args.includes('--all');
  const formatIdx  = args.indexOf('--format');
  const format     = formatIdx !== -1 ? args[formatIdx + 1] : undefined;

  const projectRoot = process.cwd();
  const { output, ok } = costCommand(projectRoot, { feature, all, format });

  console.log(output);
  process.exit(ok ? 0 : 1);
}
