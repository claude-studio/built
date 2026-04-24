#!/usr/bin/env node
/**
 * kg-updater.js
 *
 * report.js 완료(state.json status=completed) 시점에 호출되어
 * kg/issues/<feature-id>.md 초안을 자동 생성한다.
 *
 * 규칙:
 *   - 기존 엔트리 존재 시 덮어쓰기 금지 (skip + 경고 출력)
 *   - kg/ 없거나 파일 없어도 오류 없이 동작 (warn + return)
 *   - 외부 npm 패키지 없음 (fs/path 내장만 사용)
 *
 * API:
 *   generateKgDraft({ pluginRoot, feature, specPath, doResultPath, checkResultPath })
 *   -> { skipped: boolean, path: string | null, reason?: string }
 *
 * 생성되는 초안:
 *   - frontmatter: id, title, type, date, status, agent, branch, pr, week, tags
 *   - 본문: ## 목표 / ## 구현 내용 / ## 결정 사항 / ## 발생한 이슈 / ## 완료 기준 충족 여부
 *   - JSON-LD 블록
 *   - (DRAFT) 마킹: agent/CTO가 검토 후 완성해야 함을 명시
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { parse, stringify } = require('./frontmatter');

// ---------------------------------------------------------------------------
// 날짜 유틸
// ---------------------------------------------------------------------------

/**
 * Date -> YYYY-MM-DD 문자열
 * @param {Date} [d]
 * @returns {string}
 */
function toDateStr(d) {
  const dt = d || new Date();
  return dt.toISOString().slice(0, 10);
}

/**
 * ISO 날짜 문자열로부터 해당 연도의 몇 번째 주인지 반환 (1~53).
 * @param {Date} d
 * @returns {number}
 */
function isoWeek(d) {
  const jan1 = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
}

// ---------------------------------------------------------------------------
// 안전 읽기
// ---------------------------------------------------------------------------

/**
 * 파일이 존재하면 내용을 반환, 없으면 null.
 * @param {string} p
 * @returns {string | null}
 */
function safeRead(p) {
  if (!p || !fs.existsSync(p)) return null;
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 초안 본문 생성
// ---------------------------------------------------------------------------

/**
 * feature spec frontmatter, do-result, check-result 로부터 KG 초안 본문을 생성한다.
 *
 * @param {object} specData    feature spec frontmatter 데이터
 * @param {string|null} doResult
 * @param {string|null} checkResult
 * @returns {string}
 */
function buildDraftBody(specData, doResult, checkResult) {
  const goal = specData.goal || specData.description || specData.summary
    || '(spec에서 목표를 추출할 수 없음 -- 직접 작성 필요)';

  const doSummary = doResult
    ? doResult.trim().slice(0, 800) + (doResult.length > 800 ? '\n...(이하 생략 -- do-result.md 참조)' : '')
    : '(do-result.md 없음)';

  const checkSummary = checkResult
    ? checkResult.trim().slice(0, 500) + (checkResult.length > 500 ? '\n...(이하 생략 -- check-result.md 참조)' : '')
    : '(check-result.md 없음)';

  return [
    '> [DRAFT] 이 파일은 자동 생성된 초안입니다. agent/CTO가 검토 후 완성해야 합니다.',
    '',
    '## 목표',
    '',
    goal,
    '',
    '## 구현 내용',
    '',
    '_(do-result.md 요약)_',
    '',
    doSummary,
    '',
    '## 결정 사항',
    '',
    '_(검토 후 직접 작성)_',
    '',
    '## 발생한 이슈',
    '',
    '_(check-result.md 요약)_',
    '',
    checkSummary,
    '',
    '## 완료 기준 충족 여부',
    '',
    '_(검토 후 직접 작성)_',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// JSON-LD 블록 생성
// ---------------------------------------------------------------------------

/**
 * @param {string} identifier  예: "BUI-44"
 * @param {string} title
 * @param {string} prUrl
 * @returns {string}
 */
function buildJsonLd(identifier, title, prUrl) {
  const obj = {
    '@context': 'https://schema.org',
    '@type': 'Action',
    identifier,
    name: title,
    agent: { '@type': 'SoftwareAgent', name: '개발' },
    result: { '@type': 'CreativeWork', url: prUrl || '(PR URL 미확인)' },
    actionStatus: 'CompletedActionStatus',
  };

  return [
    '```json-ld',
    JSON.stringify(obj, null, 2),
    '```',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 메인 API
// ---------------------------------------------------------------------------

/**
 * kg/issues/<feature-id>.md 초안을 생성한다.
 *
 * @param {object} opts
 * @param {string}      opts.pluginRoot       built 플러그인 레포 루트 (kg/ 가 여기에 있음)
 * @param {string}      opts.feature          feature 식별자 (예: "bui-44")
 * @param {string}      opts.specPath         .built/features/<feature>.md 절대경로
 * @param {string}      [opts.doResultPath]   .built/features/<feature>/do-result.md 절대경로
 * @param {string}      [opts.checkResultPath] .built/features/<feature>/check-result.md 절대경로
 * @returns {{ skipped: boolean, path: string | null, reason?: string }}
 */
function generateKgDraft({ pluginRoot, feature, specPath, doResultPath, checkResultPath }) {
  const kgIssuesDir = path.join(pluginRoot, 'kg', 'issues');
  const outFileName = `${feature.toUpperCase()}.md`;
  const outPath     = path.join(kgIssuesDir, outFileName);

  // kg/issues/ 디렉토리 없으면 경고 후 스킵
  if (!fs.existsSync(kgIssuesDir)) {
    console.warn(`[kg-updater] kg/issues/ 디렉토리 없음 -- 초안 생성 스킵: ${kgIssuesDir}`);
    return { skipped: true, path: null, reason: 'kg/issues/ not found' };
  }

  // 기존 엔트리 존재 시 스킵
  if (fs.existsSync(outPath)) {
    console.warn(`[kg-updater] 이미 존재하므로 스킵 (덮어쓰기 금지): ${outPath}`);
    return { skipped: true, path: outPath, reason: 'already exists' };
  }

  // feature spec 읽기
  const specRaw = safeRead(specPath);
  if (!specRaw) {
    console.warn(`[kg-updater] feature spec 없음 -- 초안 생성 스킵: ${specPath}`);
    return { skipped: true, path: null, reason: 'spec not found' };
  }

  const { data: specData } = parse(specRaw);

  // do-result / check-result 읽기 (없어도 계속 진행)
  const doResult    = safeRead(doResultPath)    || null;
  const checkResult = safeRead(checkResultPath) || null;

  // frontmatter 구성
  const today     = toDateStr();
  const weekNum   = isoWeek(new Date());
  const featureId = (specData.id || feature).toString().toUpperCase();
  const title     = specData.title || specData.name || feature;
  const branch    = specData.branch || feature;
  const prUrl     = specData.pr || '';
  const tags      = Array.isArray(specData.tags) ? specData.tags : [];

  const frontmatter = {
    id:     featureId,
    title,
    type:   'issue',
    date:   today,
    status: 'completed',
    agent:  '개발',
    branch,
    pr:     prUrl || '(PR URL 미확인 -- 직접 입력 필요)',
    week:   weekNum,
    tags:   tags.length > 0 ? tags : ['draft'],
  };

  // 본문 + JSON-LD 생성
  const body    = buildDraftBody(specData, doResult, checkResult);
  const jsonLd  = buildJsonLd(featureId, title, prUrl);
  const content = body + jsonLd;

  // 파일 쓰기
  const fileContent = stringify(frontmatter, content);
  try {
    fs.writeFileSync(outPath, fileContent, 'utf8');
  } catch (err) {
    console.warn(`[kg-updater] 파일 쓰기 실패: ${err.message}`);
    return { skipped: true, path: null, reason: `write error: ${err.message}` };
  }

  console.log(`[kg-updater] KG 초안 생성 완료: ${outPath}`);
  return { skipped: false, path: outPath };
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = { generateKgDraft };
