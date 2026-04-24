#!/usr/bin/env node
/**
 * init.js
 *
 * /built:init 스킬 헬퍼 — 대상 프로젝트에 .built/, .claude/ 기본 구조를 bootstrap.
 * 외부 npm 패키지 없음 (Node.js fs/path만).
 *
 * 멱등성: .built/config.json이 이미 존재하면 아무것도 하지 않고 종료.
 *
 * 사용법:
 *   node init.js [projectRoot]
 *
 * projectRoot 생략 시 process.cwd() 사용.
 *
 * Exit codes:
 *   0 — 초기화 완료 또는 이미 초기화됨
 *   1 — 오류
 *
 * API (모듈로도 사용 가능):
 *   init(projectRoot)  -> { status: 'created'|'already_initialized', paths: [...] }
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// 내부 유틸
// ---------------------------------------------------------------------------

/**
 * 디렉토리가 없으면 생성. 있으면 무시.
 * @param {string} dir
 */
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * 파일이 없을 때만 쓰기. 이미 존재하면 건드리지 않음.
 * @param {string} filePath
 * @param {string} content
 * @returns {boolean} true=생성됨, false=이미 존재
 */
function writeIfAbsent(filePath, content) {
  if (fs.existsSync(filePath)) return false;
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

/**
 * .gitignore 파일에 항목이 없으면 append.
 * @param {string} gitignorePath
 * @param {string[]} entries
 */
function appendGitignore(gitignorePath, entries) {
  let existing = '';
  if (fs.existsSync(gitignorePath)) {
    existing = fs.readFileSync(gitignorePath, 'utf8');
  }

  const toAdd = entries.filter((e) => {
    // 이미 정확히 일치하는 줄이 있으면 건너뜀
    return !existing.split('\n').some((line) => line.trim() === e.trim());
  });

  if (toAdd.length === 0) return;

  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const section =
    separator +
    '# built\n' +
    toAdd.join('\n') +
    '\n';

  fs.appendFileSync(gitignorePath, section, 'utf8');
}

// ---------------------------------------------------------------------------
// 초기 파일 내용
// ---------------------------------------------------------------------------

function contextMd() {
  return `---
project: ""
created_at: ${new Date().toISOString().slice(0, 10)}
stack: []
team: []
---

# 프로젝트 컨텍스트

> 이 파일을 채워주세요. /built:plan 실행 전에 Claude가 여기서 프로젝트 배경을 읽습니다.

## 프로젝트 개요

<!-- 프로젝트 목적, 주요 기능, 대상 사용자를 간단히 서술 -->

## 기술 스택

<!-- 예: Next.js 14, TypeScript, Prisma, PostgreSQL -->

## 팀 컨벤션

<!-- 브랜치 전략, 코드 리뷰 규칙, 네이밍 규칙 등 -->

## 참고 링크

<!-- 디자인 시스템, API 문서, ERD 등 -->
`;
}

function configJson() {
  return JSON.stringify(
    {
      version: 1,
      max_parallel: 1,
      default_model: 'claude-opus-4-5',
      max_iterations: 3,
      cost_warn_usd: 1.0,
    },
    null,
    2
  ) + '\n';
}

function hooksJson() {
  return JSON.stringify(
    {
      pipeline: {
        after_do: [],
        after_check: [],
        after_report: [],
      },
    },
    null,
    2
  ) + '\n';
}

function hooksLocalJsonExample() {
  return JSON.stringify(
    {
      pipeline: {
        after_do: [
          {
            run: 'echo "Do 완료: $BUILT_FEATURE"',
            halt_on_fail: false,
          },
        ],
      },
    },
    null,
    2
  ) + '\n';
}

function featuresIndexMd() {
  return `---
type: index
updated_at: ${new Date().toISOString().slice(0, 10)}
---

# Features Index

> 자동 생성 파일. /built:plan 실행 시 갱신됩니다.

| Feature | Status | Created |
|---------|--------|---------|

`;
}

function claudeSettingsJson() {
  return JSON.stringify(
    {
      extraKnownMarketplaces: {},
      enabledPlugins: {},
    },
    null,
    2
  ) + '\n';
}

function worktreeinclude() {
  return `# built .worktreeinclude
# gitignore된 파일 중 worktree에 복사할 파일 목록.
# 민감 정보(secret, private key)는 기본 포함하지 않음.
# 예: .env.local.example
`;
}

// ---------------------------------------------------------------------------
// 핵심 로직
// ---------------------------------------------------------------------------

const GITIGNORE_ENTRIES = [
  '.claude/worktrees/',
  '.claude/settings.local.json',
  '.built/config.local.json',
  '.built/hooks.local.json',
  '.built/runs/*/plan-draft.md',
  '.built/runs/*/progress.json',
  '.built/runs/*/logs/',
  '.built/runtime/',
  '.built/.obsidian/workspace.json',
  '.built/.obsidian/workspace-mobile.json',
];

/**
 * 프로젝트를 bootstrap.
 *
 * @param {string} [projectRoot] 대상 프로젝트 루트. 기본값 process.cwd().
 * @returns {{ status: 'created'|'already_initialized', paths: string[] }}
 */
function init(projectRoot) {
  const root = projectRoot || process.cwd();
  const builtDir = path.join(root, '.built');
  const clauDir = path.join(root, '.claude');
  const configPath = path.join(builtDir, 'config.json');

  // 멱등성 검사: config.json이 이미 있으면 skip
  if (fs.existsSync(configPath)) {
    return { status: 'already_initialized', paths: [] };
  }

  const created = [];

  // --- .built/ 서브디렉토리 ---
  const builtSubdirs = [
    'features',
    'decisions',
    'entities',
    'patterns',
    'runs',
    'runtime',
  ];
  for (const sub of builtSubdirs) {
    ensureDir(path.join(builtDir, sub));
  }

  // --- .claude/ 서브디렉토리 ---
  ensureDir(path.join(clauDir, 'worktrees'));

  // --- .built/ 파일 ---
  const builtFiles = [
    [path.join(builtDir, 'context.md'), contextMd()],
    [path.join(builtDir, 'config.json'), configJson()],
    [path.join(builtDir, 'hooks.json'), hooksJson()],
    [path.join(builtDir, 'hooks.local.json.example'), hooksLocalJsonExample()],
    [path.join(builtDir, 'features-index.md'), featuresIndexMd()],
  ];

  for (const [filePath, content] of builtFiles) {
    if (writeIfAbsent(filePath, content)) {
      created.push(filePath);
    }
  }

  // --- .claude/settings.json ---
  const settingsPath = path.join(clauDir, 'settings.json');
  if (writeIfAbsent(settingsPath, claudeSettingsJson())) {
    created.push(settingsPath);
  }

  // --- .worktreeinclude ---
  const worktreePath = path.join(root, '.worktreeinclude');
  if (writeIfAbsent(worktreePath, worktreeinclude())) {
    created.push(worktreePath);
  }

  // --- .gitignore ---
  const gitignorePath = path.join(root, '.gitignore');
  appendGitignore(gitignorePath, GITIGNORE_ENTRIES);
  if (!created.includes(gitignorePath)) {
    created.push(gitignorePath + ' (updated)');
  }

  return { status: 'created', paths: created };
}

// ---------------------------------------------------------------------------
// CLI 진입점
// ---------------------------------------------------------------------------

if (require.main === module) {
  const projectRoot = process.argv[2] || process.cwd();

  try {
    const result = init(projectRoot);

    if (result.status === 'already_initialized') {
      console.log('already_initialized');
      process.exit(0);
    }

    console.log('created');
    for (const p of result.paths) {
      console.log('  ' + p);
    }
    process.exit(0);
  } catch (err) {
    console.error('error: ' + err.message);
    process.exit(1);
  }
}

module.exports = { init };
