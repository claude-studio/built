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
 *      - kg/workflows/: _schema.md에 workflow 타입 정의됨
 *      - kg/agents/:   _index.md에 agents/ 선언됨, _schema.md에 타입 정의 없음 (비대칭)
 *   2. kg/issues/*.md 필수 frontmatter 필드 누락
 *   3. kg/decisions/*.md 필수 frontmatter 필드 누락 + context_issue dangling 참조
 *   4. kg/workflows/*.md 필수 frontmatter 필드 누락 (엔트리가 있는 경우)
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
const WORKFLOW_REQUIRED = ['id', 'title', 'type', 'date'];

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

  // ---- 4. workflows/*.md 필수 필드 (엔트리가 있는 경우) ----

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
    ? `이상 없음 (issues: ${issueFiles.length}, decisions: ${decisionFiles.length})`
    : `이슈 ${findings.length}개 발견 (issues: ${issueFiles.length}, decisions: ${decisionFiles.length})`;

  return { findings, summary };
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = { checkKg };
