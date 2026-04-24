#!/usr/bin/env node
/**
 * kg-checker.js
 *
 * kg/ 디렉토리의 일관성을 검사한다.
 * 외부 npm 패키지 없음 (Node.js 표준 라이브러리만). deps 0 원칙.
 *
 * API:
 *   checkKg(pluginRoot) → { findings: string[], summary: string }
 *
 * 검사 항목:
 *   1. 스키마 선언 타입 대비 실제 엔트리 공백 여부
 *      - kg/goals/:     _schema.md에 goal 타입 정의됨
 *      - kg/reviews/:   _schema.md에 review 타입 정의됨
 *      - kg/workflows/: _schema.md에 workflow 타입 정의됨
 *      - kg/agents/:   _index.md에 agents/ 선언됨, _schema.md에 타입 정의 없음 (비대칭)
 *   2. kg/issues/*.md 필수 frontmatter 필드 누락 + supports_goal dangling 참조
 *   3. kg/decisions/*.md 필수 frontmatter 필드 누락 + context_issue / supports_goal dangling 참조
 *   4. kg/goals/*.md 필수 frontmatter 필드 누락
 *   5. kg/reviews/*.md 필수 frontmatter 필드 누락 + goal / drifts_from dangling 참조
 *      + status enum / status-drifts 일관성 검사 + goal 배열 마이그레이션 시점 알림
 *   6. kg/workflows/*.md 필수 frontmatter 필드 누락 (엔트리가 있는 경우)
 *
 * 주의:
 *   - kg/ 는 built 플러그인 레포 자체의 지식 그래프다. 대상 프로젝트의 .built/ 와 다른 레이어.
 *   - pluginRoot = path.join(__dirname, '..') 로 스크립트에서 호출한다.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { parse } = require('./frontmatter');

// ---------------------------------------------------------------------------
// 필수 frontmatter 필드 정의
// ---------------------------------------------------------------------------

const ISSUE_REQUIRED    = ['id', 'title', 'type', 'date', 'status', 'agent', 'branch'];
const DECISION_REQUIRED = ['id', 'title', 'type', 'date', 'status', 'context_issue'];
const GOAL_REQUIRED     = ['id', 'title', 'type', 'date', 'status', 'horizon'];
const REVIEW_REQUIRED   = ['id', 'title', 'type', 'date', 'status', 'goal'];
const WORKFLOW_REQUIRED = ['id', 'title', 'type', 'date'];
const REVIEW_STATUS_VALUES = new Set(['aligned', 'mixed', 'drifted']);

// ---------------------------------------------------------------------------
// 내부 유틸
// ---------------------------------------------------------------------------

/**
 * 디렉토리 내 .md 파일 목록 반환. 디렉토리 없으면 null.
 * @param {string} dir
 * @returns {string[] | null}
 */
function listMd(dir) {
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
}

/**
 * 파일을 읽어 frontmatter를 파싱한다. 실패 시 null 반환.
 * @param {string} filePath
 * @returns {{ data: object, content: string } | null}
 */
function safeParse(filePath) {
  try {
    return parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * string 또는 string[] 값을 string[]로 정규화.
 * @param {any} value
 * @returns {string[]}
 */
function toStringArray(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v.length > 0);
  if (typeof value === 'string' && value.length > 0) return [value];
  return [];
}

/**
 * goal 참조 배열의 dangling 참조를 findings에 추가한다.
 * @param {string[]} refs
 * @param {Set<string>} knownGoalIds
 * @param {string[]} findings
 * @param {string} fileLabel
 * @param {string} fieldName
 */
function validateGoalRefs(refs, knownGoalIds, findings, fileLabel, fieldName) {
  for (const ref of refs) {
    if (!knownGoalIds.has(ref)) {
      findings.push(`[dangling-ref] ${fileLabel}: ${fieldName} "${ref}" 이 kg/goals/ 에 없음`);
    }
  }
}

// ---------------------------------------------------------------------------
// checkKg
// ---------------------------------------------------------------------------

/**
 * kg/ 디렉토리의 일관성을 검사한다.
 *
 * @param {string} pluginRoot  built 플러그인 루트 절대경로 (kg/ 의 부모)
 * @returns {{ findings: string[], summary: string }}
 */
function checkKg(pluginRoot) {
  const kgDir = path.join(pluginRoot, 'kg');

  if (!fs.existsSync(kgDir)) {
    return {
      findings: [],
      summary: 'kg/ 디렉토리 없음 — KG 미사용',
    };
  }

  const findings = [];

  // ---- 1. 스키마/인덱스 선언 타입 vs 실제 엔트리 공백 ----

  // goals/: _schema.md에 타입 정의됨
  const goalFiles = listMd(path.join(kgDir, 'goals'));
  if (goalFiles === null) {
    findings.push('[schema-gap] kg/goals/ 디렉토리 없음 (_schema.md에 goal 타입 정의됨)');
  } else if (goalFiles.length === 0) {
    findings.push('[schema-gap] kg/goals/ 존재하나 엔트리 없음 (스키마 선언 대비 실사용 공백)');
  }

  // reviews/: _schema.md에 타입 정의됨
  const reviewFiles = listMd(path.join(kgDir, 'reviews'));
  if (reviewFiles === null) {
    findings.push('[schema-gap] kg/reviews/ 디렉토리 없음 (_schema.md에 review 타입 정의됨)');
  } else if (reviewFiles.length === 0) {
    findings.push('[schema-gap] kg/reviews/ 존재하나 엔트리 없음 (스키마 선언 대비 실사용 공백)');
  }

  // workflows/: _schema.md에 타입 정의됨
  const workflowFiles = listMd(path.join(kgDir, 'workflows'));
  if (workflowFiles === null) {
    findings.push('[schema-gap] kg/workflows/ 디렉토리 없음 (_schema.md에 workflow 타입 정의됨)');
  } else if (workflowFiles.length === 0) {
    findings.push('[schema-gap] kg/workflows/ 존재하나 엔트리 없음 (스키마 선언 대비 실사용 공백)');
  }

  // agents/: _index.md에 선언됨, _schema.md에 타입 정의 없음 → 비대칭
  const agentFiles = listMd(path.join(kgDir, 'agents'));
  if (agentFiles === null) {
    findings.push('[schema-asymmetry] kg/agents/ 디렉토리 없음 (_index.md 선언됨, _schema.md에 agent 타입 정의 없음)');
  } else if (agentFiles.length === 0) {
    findings.push('[schema-asymmetry] kg/agents/ 존재하나 엔트리 없음 (_index.md 선언 대비 실사용 공백; _schema.md에 agent 타입 정의 없음)');
  }

  // ---- 2. issues/*.md 필수 필드 + ID 수집 ----

  const issuesDir  = path.join(kgDir, 'issues');
  const knownIds   = new Set();
  const issueFiles = listMd(issuesDir) || [];

  for (const f of issueFiles) {
    const parsed = safeParse(path.join(issuesDir, f));
    if (!parsed) {
      findings.push(`[parse-error] kg/issues/${f}: frontmatter 파싱 실패`);
      continue;
    }
    const { data } = parsed;
    const missing = ISSUE_REQUIRED.filter((k) => !data[k]);
    if (missing.length) {
      findings.push(`[missing-field] kg/issues/${f}: 필수 필드 누락 — ${missing.join(', ')}`);
    }
    if (data.id) knownIds.add(String(data.id));
  }

  // ---- 3. decisions/*.md 필수 필드 + dangling context_issue ----

  const decisionsDir  = path.join(kgDir, 'decisions');
  const decisionFiles = listMd(decisionsDir) || [];

  for (const f of decisionFiles) {
    const parsed = safeParse(path.join(decisionsDir, f));
    if (!parsed) {
      findings.push(`[parse-error] kg/decisions/${f}: frontmatter 파싱 실패`);
      continue;
    }
    const { data } = parsed;
    const missing = DECISION_REQUIRED.filter((k) => !data[k]);
    if (missing.length) {
      findings.push(`[missing-field] kg/decisions/${f}: 필수 필드 누락 — ${missing.join(', ')}`);
    }
    // context_issue dangling 참조 (kg/issues/ 엔트리가 1개 이상 있을 때만 검사)
    if (data.context_issue && knownIds.size > 0 && !knownIds.has(String(data.context_issue))) {
      findings.push(`[dangling-ref] kg/decisions/${f}: context_issue "${data.context_issue}" 가 kg/issues/ 에 없음`);
    }
  }

  // ---- 4. goals/*.md 필수 필드 ----

  const goalsDir = path.join(kgDir, 'goals');
  const knownGoalIds = new Set();

  for (const f of (goalFiles || [])) {
    const parsed = safeParse(path.join(goalsDir, f));
    if (!parsed) {
      findings.push(`[parse-error] kg/goals/${f}: frontmatter 파싱 실패`);
      continue;
    }
    const { data } = parsed;
    const missing = GOAL_REQUIRED.filter((k) => !data[k]);
    if (missing.length) {
      findings.push(`[missing-field] kg/goals/${f}: 필수 필드 누락 — ${missing.join(', ')}`);
    }
    if (data.id) knownGoalIds.add(String(data.id));
  }

  // goals가 준비된 뒤 issue/decision supports_goal 검사
  for (const f of issueFiles) {
    const parsed = safeParse(path.join(issuesDir, f));
    if (!parsed) continue;
    validateGoalRefs(
      toStringArray(parsed.data.supports_goal),
      knownGoalIds,
      findings,
      `kg/issues/${f}`,
      'supports_goal'
    );
  }

  // ---- 5. reviews/*.md 필수 필드 + dangling goal ----

  const reviewsDir = path.join(kgDir, 'reviews');

  for (const f of decisionFiles) {
    const parsed = safeParse(path.join(decisionsDir, f));
    if (!parsed) continue;
    validateGoalRefs(
      toStringArray(parsed.data.supports_goal),
      knownGoalIds,
      findings,
      `kg/decisions/${f}`,
      'supports_goal'
    );
  }

  for (const f of (reviewFiles || [])) {
    const parsed = safeParse(path.join(reviewsDir, f));
    if (!parsed) {
      findings.push(`[parse-error] kg/reviews/${f}: frontmatter 파싱 실패`);
      continue;
    }
    const { data } = parsed;
    const missing = REVIEW_REQUIRED.filter((k) => !data[k]);
    if (missing.length) {
      findings.push(`[missing-field] kg/reviews/${f}: 필수 필드 누락 — ${missing.join(', ')}`);
    }
    validateGoalRefs(
      toStringArray(data.goal),
      knownGoalIds,
      findings,
      `kg/reviews/${f}`,
      'goal'
    );
    validateGoalRefs(
      toStringArray(data.drifts_from),
      knownGoalIds,
      findings,
      `kg/reviews/${f}`,
      'drifts_from'
    );

    const validStatus = REVIEW_STATUS_VALUES.has(data.status);
    if (!validStatus) {
      findings.push(`[invalid-value] kg/reviews/${f}: status "${data.status}" 는 aligned | mixed | drifted 중 하나여야 함`);
    } else {
      const driftRefs = toStringArray(data.drifts_from);
      if (data.status === 'aligned' && driftRefs.length > 0) {
        findings.push(`[status-mismatch] kg/reviews/${f}: status가 aligned이면 drifts_from은 비어 있어야 함`);
      }
      if ((data.status === 'mixed' || data.status === 'drifted') && driftRefs.length === 0) {
        findings.push(`[status-mismatch] kg/reviews/${f}: status가 ${data.status}이면 drifts_from이 1개 이상 있어야 함`);
      }
    }

    if (knownGoalIds.size > 1 && typeof data.goal === 'string' && data.goal.length > 0) {
      findings.push(`[migration-due] kg/reviews/${f}: goal이 2개 이상 존재하므로 review.goal을 goals: []로 마이그레이션해야 함`);
    }
  }

  // ---- 6. workflows/*.md 필수 필드 (엔트리가 있는 경우) ----

  const workflowsDir = path.join(kgDir, 'workflows');
  for (const f of (workflowFiles || [])) {
    const parsed = safeParse(path.join(workflowsDir, f));
    if (!parsed) {
      findings.push(`[parse-error] kg/workflows/${f}: frontmatter 파싱 실패`);
      continue;
    }
    const { data } = parsed;
    const missing = WORKFLOW_REQUIRED.filter((k) => !data[k]);
    if (missing.length) {
      findings.push(`[missing-field] kg/workflows/${f}: 필수 필드 누락 — ${missing.join(', ')}`);
    }
  }

  // ---- 요약 ----

  const summary = findings.length === 0
    ? `이상 없음 (issues: ${issueFiles.length}, decisions: ${decisionFiles.length}, goals: ${(goalFiles || []).length}, reviews: ${(reviewFiles || []).length})`
    : `이슈 ${findings.length}개 발견 (issues: ${issueFiles.length}, decisions: ${decisionFiles.length}, goals: ${(goalFiles || []).length}, reviews: ${(reviewFiles || []).length})`;

  return { findings, summary };
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = { checkKg };
