#!/usr/bin/env node
/**
 * scripts/do-kg-context.js
 *
 * Do phase prompt에 넣을 KG context를 bounded selection으로 구성한다.
 * provider adapter가 아니라 control plane에서 prompt 크기와 KG 포함 범위를 제한한다.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_PROMPT_CHARS = 200000;
const DEFAULT_WARN_PROMPT_CHARS = 160000;

const MAX_FULL_DECISIONS = 8;
const MAX_FULL_ISSUES = 8;
const MAX_FULL_WORKFLOWS = 4;
const MAX_INDEX_DECISIONS = 60;
const MAX_INDEX_ISSUES = 40;
const MAX_SUMMARY_CHARS = 320;

const ALWAYS_INCLUDE = [
  'kg/goals/north-star.md',
  'kg/workflows/plan-synthesis-provider-validation.md',
];

const TOPIC_KEYWORDS = [
  'do',
  'run',
  'provider',
  'providers',
  'prompt',
  'context',
  'budget',
  'kg',
  'failure',
  'taxonomy',
  'plan_synthesis',
  'workflow',
];

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getPromptBudgetFromEnv(env = process.env) {
  return {
    maxChars: parsePositiveInt(env.BUILT_DO_PROMPT_MAX_CHARS, DEFAULT_MAX_PROMPT_CHARS),
    warnChars: parsePositiveInt(env.BUILT_DO_PROMPT_WARN_CHARS, DEFAULT_WARN_PROMPT_CHARS),
  };
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch (_) {
    return null;
  }
}

function listMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .sort()
      .map((name) => path.join(dir, name));
  } catch (_) {
    return [];
  }
}

function parseFrontmatter(content) {
  if (!content || !content.startsWith('---\n')) return {};
  const end = content.indexOf('\n---', 4);
  if (end === -1) return {};
  const block = content.slice(4, end).trim();
  const result = {};

  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    const rawValue = match[2].trim();
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      result[key] = rawValue.slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else {
      result[key] = rawValue.replace(/^['"]|['"]$/g, '');
    }
  }

  return result;
}

function firstHeading(content) {
  const match = String(content || '').match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function stripFrontmatter(content) {
  if (!content || !content.startsWith('---\n')) return content || '';
  const end = content.indexOf('\n---', 4);
  return end === -1 ? content : content.slice(end + 4).trim();
}

function compactSummary(content, meta = {}) {
  if (meta.summary) return String(meta.summary).slice(0, MAX_SUMMARY_CHARS);

  const body = stripFrontmatter(content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('```'))
    .join(' ');

  return body.slice(0, MAX_SUMMARY_CHARS);
}

function extractSignals(...values) {
  const text = values
    .filter((value) => value !== null && value !== undefined)
    .map((value) => typeof value === 'string' ? value : JSON.stringify(value))
    .join('\n')
    .toLowerCase();

  const buis = new Set();
  const paths = new Set();
  const keywords = new Set();

  for (const match of text.matchAll(/\bbui-\d+\b/g)) buis.add(match[0].toUpperCase());
  for (const match of text.matchAll(/\b(?:kg|docs|scripts|src|test)\/[A-Za-z0-9._/-]+/g)) {
    paths.add(match[0].replace(/[),.;:]+$/, ''));
  }
  for (const keyword of TOPIC_KEYWORDS) {
    if (text.includes(keyword.toLowerCase())) keywords.add(keyword.toLowerCase());
  }

  return { buis, paths, keywords };
}

function scalarList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value === null || value === undefined || value === '') return [];
  return String(value).split(/[,\s]+/).filter(Boolean);
}

function loadKgDoc(projectRoot, filePath, kind) {
  const content = readText(filePath);
  if (!content) return null;
  const relPath = toPosixPath(path.relative(projectRoot, filePath));
  const meta = parseFrontmatter(content);
  const title = meta.title || firstHeading(content) || path.basename(filePath, '.md');
  const id = meta.id || path.basename(filePath, '.md');
  const tags = scalarList(meta.tags);
  const keywords = scalarList(meta.keywords);
  const refs = [
    ...scalarList(meta.context_issue),
    ...scalarList(meta.kg_files),
    ...scalarList(meta.related),
  ];

  return {
    relPath,
    kind,
    content,
    meta,
    id: String(id),
    title: String(title),
    status: meta.status ? String(meta.status) : '',
    tags,
    keywords,
    refs,
    summary: compactSummary(content, meta),
  };
}

function scoreDoc(doc, signals, alwaysInclude) {
  if (alwaysInclude.has(doc.relPath)) return 1000;

  let score = 0;
  const haystack = [
    doc.relPath,
    doc.id,
    doc.title,
    doc.status,
    ...doc.tags,
    ...doc.keywords,
    ...doc.refs,
  ].join(' ').toLowerCase();

  for (const bui of signals.buis) {
    if (haystack.includes(bui.toLowerCase())) score += 120;
  }
  for (const kgPath of signals.paths) {
    if (doc.relPath.toLowerCase() === kgPath || haystack.includes(kgPath)) score += 90;
  }
  for (const keyword of signals.keywords) {
    if (haystack.includes(keyword)) score += 20;
  }
  if (doc.kind === 'decision' && doc.status === 'accepted') score += 15;
  if (doc.kind === 'workflow' && signals.keywords.has('workflow')) score += 25;

  return score;
}

function indexLine(doc) {
  const tags = doc.tags.length > 0 ? ` tags=${doc.tags.join(',')}` : '';
  const keywords = doc.keywords.length > 0 ? ` keywords=${doc.keywords.join(',')}` : '';
  const status = doc.status ? ` status=${doc.status}` : '';
  const summary = doc.summary ? ` summary=${doc.summary}` : '';
  return `- ${doc.relPath}: ${doc.id} ${doc.title}${status}${tags}${keywords}${summary}`;
}

function rankedDocs(projectRoot, featureSpec, planSynthesis, providerSpec, runRequest) {
  const kgRoot = path.join(projectRoot, 'kg');
  const signals = extractSignals(featureSpec, planSynthesis, providerSpec, runRequest);
  const alwaysInclude = new Set(ALWAYS_INCLUDE);

  const docSpecs = [
    ...ALWAYS_INCLUDE.map((relPath) => ({ filePath: path.join(projectRoot, relPath), kind: relPath.split('/')[1] })),
    ...listMarkdownFiles(path.join(kgRoot, 'decisions')).map((filePath) => ({ filePath, kind: 'decision' })),
    ...listMarkdownFiles(path.join(kgRoot, 'issues')).map((filePath) => ({ filePath, kind: 'issue' })),
    ...listMarkdownFiles(path.join(kgRoot, 'workflows')).map((filePath) => ({ filePath, kind: 'workflow' })),
  ];

  const byPath = new Map();
  for (const spec of docSpecs) {
    const doc = loadKgDoc(projectRoot, spec.filePath, spec.kind);
    if (doc) byPath.set(doc.relPath, doc);
  }

  return Array.from(byPath.values())
    .map((doc) => ({ doc, score: scoreDoc(doc, signals, alwaysInclude) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.doc.relPath.localeCompare(b.doc.relPath);
    });
}

function selectKgDocs(projectRoot, featureSpec, planSynthesis, providerSpec, runRequest) {
  const ranked = rankedDocs(projectRoot, featureSpec, planSynthesis, providerSpec, runRequest);
  const full = [];
  const indexes = { decision: [], issue: [] };
  const skipped = { decision: 0, issue: 0, workflow: 0, other: 0 };
  let fullDecisionCount = 0;
  let fullIssueCount = 0;
  let fullWorkflowCount = 0;

  for (const { doc, score } of ranked) {
    const mandatory = ALWAYS_INCLUDE.includes(doc.relPath);
    const selectedDecision = doc.kind === 'decision' && score > 0 && fullDecisionCount < MAX_FULL_DECISIONS;
    const selectedIssue = doc.kind === 'issue' && score > 0 && fullIssueCount < MAX_FULL_ISSUES;
    const selectedWorkflow = doc.kind === 'workflow' && score > 0 && fullWorkflowCount < MAX_FULL_WORKFLOWS;

    if (mandatory || selectedDecision || selectedIssue || selectedWorkflow) {
      full.push(doc);
      if (doc.kind === 'decision') fullDecisionCount++;
      if (doc.kind === 'issue') fullIssueCount++;
      if (doc.kind === 'workflow') fullWorkflowCount++;
      continue;
    }

    if (doc.kind === 'decision' && indexes.decision.length < MAX_INDEX_DECISIONS) {
      indexes.decision.push(doc);
    } else if (doc.kind === 'issue' && indexes.issue.length < MAX_INDEX_ISSUES) {
      indexes.issue.push(doc);
    } else {
      skipped[doc.kind] = (skipped[doc.kind] || 0) + 1;
    }
  }

  return { full, indexes, skipped, total: ranked.length };
}

function buildSectionFromSelection(selection) {
  const parts = [];
  if (selection.full.length > 0 || selection.indexes.decision.length > 0 || selection.indexes.issue.length > 0) {
    parts.push('', '## Relevant Knowledge Context (kg/)');
  }

  if (selection.full.length > 0) {
    parts.push('', '### Selected KG Documents');
    for (const doc of selection.full) {
      parts.push('', `#### ${doc.relPath}`, doc.content);
    }
  }

  if (selection.indexes.decision.length > 0 || selection.indexes.issue.length > 0) {
    parts.push('', '### KG Index (bounded)');
    if (selection.indexes.decision.length > 0) {
      parts.push('', '#### Decisions');
      selection.indexes.decision.forEach((doc) => parts.push(indexLine(doc)));
    }
    if (selection.indexes.issue.length > 0) {
      parts.push('', '#### Issues');
      selection.indexes.issue.forEach((doc) => parts.push(indexLine(doc)));
    }
  }

  return parts.join('\n');
}

function trimSelectionToBudget(selection, maxSectionChars) {
  const trimmed = {
    full: [...selection.full],
    indexes: {
      decision: [...selection.indexes.decision],
      issue: [...selection.indexes.issue],
    },
    skipped: { ...selection.skipped },
    total: selection.total,
  };

  while (buildSectionFromSelection(trimmed).length > maxSectionChars && trimmed.indexes.issue.length > 0) {
    trimmed.indexes.issue.pop();
    trimmed.skipped.issue++;
  }
  while (buildSectionFromSelection(trimmed).length > maxSectionChars && trimmed.indexes.decision.length > 0) {
    trimmed.indexes.decision.pop();
    trimmed.skipped.decision++;
  }
  while (buildSectionFromSelection(trimmed).length > maxSectionChars && trimmed.full.length > 0) {
    const removed = trimmed.full.pop();
    trimmed.skipped[removed.kind] = (trimmed.skipped[removed.kind] || 0) + 1;
  }

  return trimmed;
}

function buildDoKgContext({ projectRoot, featureSpec, planSynthesis, providerSpec, runRequest, maxSectionChars } = {}) {
  const selection = selectKgDocs(projectRoot, featureSpec, planSynthesis, providerSpec, runRequest);
  const bounded = trimSelectionToBudget(selection, Math.max(0, maxSectionChars || DEFAULT_MAX_PROMPT_CHARS));
  const text = buildSectionFromSelection(bounded);

  const stats = {
    total_docs: bounded.total,
    full_docs: bounded.full.length,
    indexed_decisions: bounded.indexes.decision.length,
    indexed_issues: bounded.indexes.issue.length,
    skipped_decisions: bounded.skipped.decision || 0,
    skipped_issues: bounded.skipped.issue || 0,
    skipped_workflows: bounded.skipped.workflow || 0,
    chars: text.length,
  };

  return { text, stats, selection: bounded };
}

module.exports = {
  DEFAULT_MAX_PROMPT_CHARS,
  DEFAULT_WARN_PROMPT_CHARS,
  getPromptBudgetFromEnv,
  buildDoKgContext,
  selectKgDocs,
  extractSignals,
};
