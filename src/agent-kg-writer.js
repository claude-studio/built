#!/usr/bin/env node
/**
 * agent-kg-writer.js
 *
 * Codex PDCA agent-local Markdown KG writer.
 * built target project repo에는 KG 파일을 쓰지 않고, agent folder 내부
 * ~/Desktop/agents/codex-pdca-agent/projects/<project-slug>/kg/ 아래에만 쓴다.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parse, stringify } = require('./frontmatter');

const DEFAULT_AGENT_ROOT = path.join(os.homedir(), 'Desktop', 'agents', 'codex-pdca-agent');
const KG_TYPES = ['issues', 'decisions', 'patterns', 'entities', 'workflows'];

function toDateStr(d) {
  return (d || new Date()).toISOString().slice(0, 10);
}

function safeRead(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return null;
  }
}

function slugify(value, fallback = 'project') {
  const raw = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return raw || fallback;
}

function projectNameFromPackage(projectRoot) {
  const pkgPath = path.join(projectRoot || '', 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.name || null;
  } catch (_) {
    return null;
  }
}

function inferProjectSlug(projectRoot, env = process.env) {
  if (env.BUILT_AGENT_PROJECT_SLUG) return slugify(env.BUILT_AGENT_PROJECT_SLUG);
  const packageName = projectNameFromPackage(projectRoot);
  if (packageName) return slugify(packageName);
  return slugify(path.basename(path.resolve(projectRoot || process.cwd())));
}

function resolveAgentKgRoot({ projectRoot, agentRoot, projectSlug, env = process.env } = {}) {
  const root = path.resolve(agentRoot || env.BUILT_AGENT_ROOT || DEFAULT_AGENT_ROOT);
  const slug = slugify(projectSlug || inferProjectSlug(projectRoot, env));
  return path.join(root, 'projects', slug, 'kg');
}

function ensureKgDirs(kgRoot) {
  fs.mkdirSync(kgRoot, { recursive: true });
  for (const type of KG_TYPES) {
    fs.mkdirSync(path.join(kgRoot, type), { recursive: true });
  }
}

function titleFromSlug(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function truncate(text, limit) {
  const normalized = String(text || '').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit).trim()}\n...(이하 생략)`;
}

function writeFileIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) {
    return { skipped: true, path: filePath, reason: 'already exists' };
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return { skipped: false, path: filePath };
}

function writeIndex({ kgRoot, projectSlug, projectRoot }) {
  const frontmatter = {
    id: `${projectSlug}-kg-index`,
    title: `${projectSlug} KG Index`,
    type: 'index',
    updated: toDateStr(),
    project: projectSlug,
  };
  const body = [
    `# ${projectSlug} KG`,
    '',
    '## 문서 위치',
    '',
    `이 KG는 agent-local folder 내부 \`${kgRoot}\` 에만 위치한다.`,
    '대상 프로젝트 repo와 built plugin repo에는 KG 산출물을 쓰지 않는다.',
    '',
    '## 컬렉션',
    '',
    '- [[issues/]]: run 결과, 목표, 완료/blocked 근거, 검증 요약',
    '- [[decisions/]]: 결정, 대안, 근거, 되돌릴 조건',
    '- [[patterns/]]: 반복 가능한 패턴과 재사용 조건',
    '- [[entities/]]: 프로젝트, 모듈, 개념 기록',
    '- [[workflows/]]: 반복 가능한 절차와 검증 흐름',
    '',
    '## Frontmatter 규칙',
    '',
    '- 모든 문서는 `id`, `title`, `type`, `date`, `project`, `status`, `source_issue`를 우선 기록한다.',
    '- `type`은 `issue`, `decision`, `pattern`, `entity`, `workflow`, `index` 중 하나를 사용한다.',
    '- 반복 참조는 `related`, `kg_files`, `supports`, `supersedes` 배열에 wikilink 없이 상대 경로로 기록한다.',
    '- 본문 참조는 `[[decisions/<slug>]]`, `[[patterns/<slug>]]`, `[[entities/<slug>]]`, `[[workflows/<slug>]]`, `[[issues/<id>]]` 형태의 wikilink를 사용한다.',
    '',
    '## 다음 Plan 재사용 경로',
    '',
    '다음 `/built:plan <feature>`의 Prior Art 단계는 이 index와 `issues/`, `decisions/`, `patterns/`, `entities/`, `workflows/` 문서를 읽어 기존 결정과 반복 패턴을 먼저 확인한다.',
    projectRoot ? `대상 프로젝트 루트: \`${projectRoot}\`` : '',
    '',
  ].filter((line) => line !== '').join('\n');

  const outPath = path.join(kgRoot, '_index.md');
  fs.writeFileSync(outPath, stringify(frontmatter, body), 'utf8');
  return outPath;
}

function normalizeCandidate(type, candidate) {
  if (!candidate) return null;
  if (typeof candidate === 'string') {
    const slug = slugify(candidate);
    return { slug, title: titleFromSlug(slug), body: candidate };
  }
  const slug = slugify(candidate.slug || candidate.id || candidate.title);
  if (!slug) return null;
  return {
    slug,
    title: candidate.title || titleFromSlug(slug),
    body: candidate.body || candidate.summary || candidate.description || '',
    alternatives: candidate.alternatives || '',
    rationale: candidate.rationale || '',
    rollback: candidate.rollback || candidate.revert_condition || '',
    reuse: candidate.reuse || candidate.reuse_condition || '',
    status: candidate.status || 'draft',
    type,
  };
}

function parseCandidateLine(line) {
  const trimmed = line.replace(/^[-*]\s+/, '').trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^`?([a-zA-Z0-9._-]+)`?\s*[:：-]\s*(.+)$/);
  if (match) {
    return { slug: slugify(match[1]), title: match[2].split(/[—-]/)[0].trim(), body: trimmed };
  }
  const slug = slugify(trimmed.slice(0, 60));
  return { slug, title: titleFromSlug(slug), body: trimmed };
}

function extractCandidateSections(reportMarkdown) {
  const result = { decisions: [], patterns: [], entities: [], workflows: [] };
  const lines = String(reportMarkdown || '').split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^#{2,4}\s+(.+?)\s*$/);
    if (heading) {
      const text = heading[1].toLowerCase();
      if (/decision|결정/.test(text)) current = 'decisions';
      else if (/pattern|패턴/.test(text)) current = 'patterns';
      else if (/entity|entities|엔티티|개념|모듈/.test(text)) current = 'entities';
      else if (/workflow|절차|흐름/.test(text)) current = 'workflows';
      else if (/kg|knowledge|후보/.test(text)) current = current;
      else current = null;
      continue;
    }
    if (current && /^\s*[-*]\s+/.test(line)) {
      const parsed = parseCandidateLine(line);
      if (parsed) result[current].push(parsed);
    }
  }
  return result;
}

function mergeCandidates(...sets) {
  const merged = { decisions: [], patterns: [], entities: [], workflows: [] };
  for (const set of sets) {
    if (!set) continue;
    for (const type of Object.keys(merged)) {
      for (const candidate of set[type] || []) {
        const normalized = normalizeCandidate(type, candidate);
        if (normalized && !merged[type].some((item) => item.slug === normalized.slug)) {
          merged[type].push(normalized);
        }
      }
    }
  }
  return merged;
}

function candidateDoc(type, candidate, context) {
  const base = {
    id: `${type.slice(0, -1)}-${candidate.slug}`,
    title: candidate.title,
    type: type.slice(0, -1),
    date: context.date,
    project: context.projectSlug,
    status: candidate.status,
    source_issue: context.featureId,
    related: [`issues/${context.issueFile}`],
  };

  const bodyByType = {
    decisions: [
      `# ${candidate.title}`,
      '',
      '## 결정',
      '',
      candidate.body || '_(결정 내용을 작성해야 함)_',
      '',
      '## 대안',
      '',
      candidate.alternatives || '_(대안을 작성해야 함)_',
      '',
      '## 근거',
      '',
      candidate.rationale || '_(근거를 작성해야 함)_',
      '',
      '## 되돌릴 조건',
      '',
      candidate.rollback || '_(되돌릴 조건을 작성해야 함)_',
    ],
    patterns: [
      `# ${candidate.title}`,
      '',
      '## 패턴',
      '',
      candidate.body || '_(반복 가능한 패턴을 작성해야 함)_',
      '',
      '## 재사용 조건',
      '',
      candidate.reuse || '_(재사용 조건을 작성해야 함)_',
    ],
    entities: [
      `# ${candidate.title}`,
      '',
      '## 설명',
      '',
      candidate.body || '_(프로젝트/모듈/개념 설명을 작성해야 함)_',
      '',
      '## 관련 문서',
      '',
      `- [[issues/${context.featureId}]]`,
    ],
    workflows: [
      `# ${candidate.title}`,
      '',
      '## 절차',
      '',
      candidate.body || '_(반복 가능한 절차를 작성해야 함)_',
      '',
      '## 검증 흐름',
      '',
      candidate.reuse || '_(검증 흐름을 작성해야 함)_',
    ],
  };

  return stringify(base, bodyByType[type].join('\n') + '\n');
}

function writeCandidateDocs({ kgRoot, candidates, context }) {
  const created = [];
  const skipped = [];
  for (const type of Object.keys(candidates)) {
    for (const candidate of candidates[type]) {
      const filePath = path.join(kgRoot, type, `${candidate.slug}.md`);
      const result = writeFileIfMissing(filePath, candidateDoc(type, candidate, context));
      const rel = `${type}/${candidate.slug}.md`;
      if (result.skipped) skipped.push(rel);
      else created.push(rel);
    }
  }
  return { created, skipped };
}

function buildIssueDoc({ feature, specData, doResult, checkResult, report, context, candidateRefs }) {
  const status = specData.status || 'completed';
  const goal = specData.goal || specData.description || specData.summary || '_(목표를 작성해야 함)_';
  const frontmatter = {
    id: context.featureId,
    title: specData.title || specData.name || feature,
    type: 'issue',
    date: context.date,
    project: context.projectSlug,
    status,
    source_issue: context.featureId,
    kg_files: candidateRefs,
  };

  return stringify(frontmatter, [
    `# ${frontmatter.title}`,
    '',
    '## 목표',
    '',
    goal,
    '',
    '## Run 결과',
    '',
    truncate(report, 1200) || '_(report.md 없음)_',
    '',
    '## 완료/Blocked 근거',
    '',
    status === 'blocked' ? 'blocked 상태입니다. blocker 근거를 보완해야 합니다.' : 'report 단계가 완료되어 completed로 기록합니다.',
    '',
    '## 검증 요약',
    '',
    truncate(checkResult, 800) || '_(check-result.md 없음)_',
    '',
    '## 구현 요약',
    '',
    truncate(doResult, 800) || '_(do-result.md 없음)_',
    '',
    '## 분리된 KG 후보',
    '',
    candidateRefs.length > 0 ? candidateRefs.map((ref) => `- [[${ref.replace(/\.md$/, '')}]]`).join('\n') : 'KG 후보 없음',
    '',
    '## 다음 Plan 재사용',
    '',
    '다음 Plan의 Prior Art 단계는 `kg/_index.md`에서 이 문서와 분리된 decision/pattern/entity/workflow 문서를 찾아 맥락으로 재사용한다.',
    '',
  ].join('\n'));
}

function generateAgentKgDrafts(opts) {
  const {
    projectRoot,
    agentRoot,
    projectSlug,
    feature,
    specPath,
    doResultPath,
    checkResultPath,
    reportPath,
    candidates,
    now,
    env = process.env,
  } = opts || {};

  if (!feature) throw new TypeError('generateAgentKgDrafts: feature is required');

  const kgRoot = resolveAgentKgRoot({ projectRoot, agentRoot, projectSlug, env });
  const slug = path.basename(path.dirname(kgRoot));
  ensureKgDirs(kgRoot);
  const indexPath = writeIndex({ kgRoot, projectSlug: slug, projectRoot });

  const specRaw = safeRead(specPath);
  const specData = specRaw ? parse(specRaw).data : {};
  const doResult = safeRead(doResultPath) || '';
  const checkResult = safeRead(checkResultPath) || '';
  const report = safeRead(reportPath) || '';
  const extractedCandidates = extractCandidateSections(report);
  const allCandidates = mergeCandidates(extractedCandidates, candidates);

  const date = toDateStr(now || new Date());
  const featureId = feature.toString().toUpperCase();
  const issueFile = `${featureId}.md`;
  const context = { date, projectSlug: slug, featureId, issueFile };
  const candidateResult = writeCandidateDocs({ kgRoot, candidates: allCandidates, context });
  const candidateRefs = candidateResult.created.concat(candidateResult.skipped);
  const issuePath = path.join(kgRoot, 'issues', issueFile);
  const issueResult = writeFileIfMissing(issuePath, buildIssueDoc({
    feature,
    specData,
    doResult,
    checkResult,
    report,
    context,
    candidateRefs,
  }));

  return {
    kgRoot,
    indexPath,
    issuePath: issueResult.path,
    issueSkipped: Boolean(issueResult.skipped),
    candidates: candidateResult,
  };
}

module.exports = {
  DEFAULT_AGENT_ROOT,
  resolveAgentKgRoot,
  inferProjectSlug,
  extractCandidateSections,
  generateAgentKgDrafts,
};
