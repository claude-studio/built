#!/usr/bin/env node
/**
 * update-index.js
 *
 * .built/features/*.md 를 스캔해 .built/features-index.md 를 재생성한다.
 * 외부 npm 패키지 없음 (Node.js fs/path만).
 *
 * 사용:
 *   node src/update-index.js [--built-dir <path>]
 *
 * --built-dir: .built 디렉토리 경로 (기본값: process.cwd()/.built)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { parse } = require('./frontmatter');

// ---------------------------------------------------------------------------
// CLI 인자 파싱
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  let builtDir = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--built-dir' && args[i + 1]) {
      builtDir = args[++i];
    }
  }

  return { builtDir };
}

// ---------------------------------------------------------------------------
// features/*.md 스캔
// ---------------------------------------------------------------------------

/**
 * .built/features/ 하위 .md 파일 목록 반환.
 * @param {string} featuresDir
 * @returns {string[]} 파일 절대경로 배열 (이름순 정렬)
 */
function scanFeatureFiles(featuresDir) {
  if (!fs.existsSync(featuresDir)) return [];

  return fs.readdirSync(featuresDir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => path.join(featuresDir, f));
}

// ---------------------------------------------------------------------------
// 각 feature 파일에서 메타데이터 추출
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} FeatureMeta
 * @property {string}   name     - feature 식별자 (파일명 기준)
 * @property {string}   status   - planned / in-progress / completed / archived
 * @property {string[]} tags     - 태그 배열
 * @property {string}   filePath - 원본 파일 절대경로
 */

/**
 * feature spec 파일에서 메타데이터를 읽는다.
 * @param {string} filePath
 * @returns {FeatureMeta}
 */
function extractMeta(filePath) {
  let data = {};

  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const parsed = parse(text);
    data = parsed.data || {};
  } catch (_) {
    // 파싱 실패 시 기본값으로 fallback
  }

  const baseName = path.basename(filePath, '.md');

  return {
    name:     data.feature || baseName,
    status:   data.status  || 'planned',
    tags:     Array.isArray(data.tags) ? data.tags : [],
    filePath,
  };
}

// ---------------------------------------------------------------------------
// features-index.md 생성
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES    = new Set(['planned', 'in-progress', 'in_progress']);
const COMPLETED_STATUSES = new Set(['completed', 'done']);

/**
 * FeatureMeta 배열로 features-index.md 내용을 생성한다.
 * @param {FeatureMeta[]} features
 * @returns {string}
 */
function buildIndex(features) {
  const active    = features.filter(f => ACTIVE_STATUSES.has(f.status));
  const completed = features.filter(f => COMPLETED_STATUSES.has(f.status));
  const archived  = features.filter(f => f.status === 'archived');
  const other     = features.filter(f =>
    !ACTIVE_STATUSES.has(f.status) &&
    !COMPLETED_STATUSES.has(f.status) &&
    f.status !== 'archived'
  );

  // 태그별 역인덱스
  const byTag = {};
  for (const f of features) {
    for (const tag of f.tags) {
      if (!byTag[tag]) byTag[tag] = [];
      byTag[tag].push(f.name);
    }
  }

  const lines = [
    '# Features Index',
    '',
    '자동 생성 파일. `/built:plan` 완료 시마다 갱신된다.',
    '',
  ];

  // Active
  lines.push('## Active');
  if (active.length === 0) {
    lines.push('_없음_');
  } else {
    for (const f of active) {
      const tagStr = f.tags.length ? ' — ' + f.tags.map(t => `#${t}`).join(' ') : '';
      lines.push(`- [[features/${f.name}]] — ${f.status}${tagStr}`);
    }
  }
  lines.push('');

  // Completed
  lines.push('## Completed');
  if (completed.length === 0) {
    lines.push('_없음_');
  } else {
    for (const f of completed) {
      const tagStr = f.tags.length ? ' — ' + f.tags.map(t => `#${t}`).join(' ') : '';
      lines.push(`- [[features/${f.name}]] — ${f.status}${tagStr}`);
    }
  }
  lines.push('');

  // Archived
  if (archived.length > 0) {
    lines.push('## Archived');
    for (const f of archived) {
      lines.push(`- [[features/${f.name}]]`);
    }
    lines.push('');
  }

  // Other (알 수 없는 status)
  if (other.length > 0) {
    lines.push('## Other');
    for (const f of other) {
      lines.push(`- [[features/${f.name}]] — ${f.status}`);
    }
    lines.push('');
  }

  // By Tag
  const sortedTags = Object.keys(byTag).sort();
  if (sortedTags.length > 0) {
    lines.push('## By Tag');
    for (const tag of sortedTags) {
      const refs = byTag[tag].map(n => `[[features/${n}]]`).join(', ');
      lines.push(`- **#${tag}**: ${refs}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------

function main() {
  const { builtDir: argBuiltDir } = parseArgs(process.argv);
  const builtDir = argBuiltDir
    ? path.resolve(argBuiltDir)
    : path.join(process.cwd(), '.built');

  const featuresDir = path.join(builtDir, 'features');
  const indexPath   = path.join(builtDir, 'features-index.md');

  const filePaths = scanFeatureFiles(featuresDir);
  const features  = filePaths.map(extractMeta);
  const content   = buildIndex(features);

  // .built 디렉토리가 없으면 생성
  fs.mkdirSync(builtDir, { recursive: true });

  fs.writeFileSync(indexPath, content, 'utf8');

  console.log(`features-index.md 갱신 완료 (${features.length}개 feature): ${indexPath}`);
}

main();
