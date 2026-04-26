/**
 * plan-save.js — Phase 5 저장 헬퍼
 *
 * feature-spec.md에서 [[decisions/*]], [[entities/*]], [[patterns/*]] wikilink를
 * 파싱하여 파일이 없는 항목만 §7 스키마 frontmatter로 신규 생성한다.
 *
 * API:
 *   saveAuxDocs(featureSpecPath, builtDir)
 *     - featureSpecPath: .built/features/<name>.md 절대경로
 *     - builtDir: .built 디렉토리 절대경로
 *     - returns: { created: string[], skipped: string[] }
 *
 * 외부 npm 패키지 없음 — Node.js 내장 모듈만 사용.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// wikilink 파싱
// ---------------------------------------------------------------------------

/**
 * 마크다운 텍스트에서 [[type/slug]] 형태의 wikilink를 추출한다.
 * @param {string} text
 * @param {string} type  'decisions' | 'entities' | 'patterns'
 * @returns {string[]} slug 배열 (중복 제거)
 */
function extractWikilinks(text, type) {
  const pattern = new RegExp(`\\[\\[${type}\\/([^\\]]+)\\]\\]`, 'g');
  const slugs = new Set();
  let m;
  while ((m = pattern.exec(text)) !== null) {
    slugs.add(m[1].trim());
  }
  return Array.from(slugs);
}

// ---------------------------------------------------------------------------
// 보조 문서 초안 생성 (§7 스키마)
// ---------------------------------------------------------------------------

/**
 * slug를 사람이 읽기 좋은 제목으로 변환한다.
 * @param {string} slug  kebab-case
 * @returns {string}
 */
function slugToTitle(slug) {
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * 최상위/하위 마크다운 heading으로 구분된 섹션 본문을 추출한다.
 * @param {string} text
 * @param {string[]} headingPath
 * @returns {string}
 */
function extractSection(text, headingPath) {
  const lines = text.split(/\r?\n/);
  const headingStack = [];
  const wanted = headingPath.map((h) => h.toLowerCase());
  const collected = [];
  let inSection = false;
  let sectionLevel = null;

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const name = heading[2].trim().toLowerCase();
      headingStack[level - 1] = name;
      headingStack.length = level;

      const matches = headingStack.slice(-wanted.length).every((part, idx) => part === wanted[idx]);
      if (matches) {
        inSection = true;
        sectionLevel = level;
        continue;
      }

      if (inSection && level <= sectionLevel) {
        break;
      }
    }

    if (inSection) collected.push(line);
  }

  return collected.join('\n').trim();
}

/**
 * 특정 wikilink가 포함된 줄의 인라인 설명을 추출한다.
 * @param {string} text
 * @param {string} type
 * @param {string} slug
 * @returns {string[]}
 */
function extractLinkLines(text, type, slug) {
  const link = `[[${type}/${slug}]]`;
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes(link));
}

/**
 * 링크 줄에서 "- [[x/y]] — 설명" 형태의 설명을 보존한다.
 * @param {string} line
 * @param {string} type
 * @param {string} slug
 * @returns {string}
 */
function stripLinkPrefix(line, type, slug) {
  const linkPattern = new RegExp(`^[-*]?\\s*\\[\\[${type}\\/${slug}\\]\\]\\s*(?:[—:-]\\s*)?`);
  return line.replace(linkPattern, '').trim();
}

/**
 * 빈 값이나 중복을 제거한다.
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqNonEmpty(values) {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

/**
 * feature spec에서 보조 문서별 컨텍스트를 추출한다.
 * @param {string} text
 * @param {string} type
 * @param {string} slug
 * @returns {object}
 */
function extractAuxContext(text, type, slug) {
  if (type === 'entities') {
    const entities = extractSection(text, ['Content & Data', 'Entities']);
    const lines = extractLinkLines(entities || text, type, slug);
    return {
      descriptions: uniqNonEmpty(lines.map((line) => stripLinkPrefix(line, type, slug))),
    };
  }

  if (type === 'patterns') {
    const referencePatterns = extractSection(text, ['Build Plan', 'Reference Patterns']);
    const lines = extractLinkLines(referencePatterns || text, type, slug);
    return {
      descriptions: uniqNonEmpty(lines.map((line) => stripLinkPrefix(line, type, slug))),
    };
  }

  if (type === 'decisions') {
    const architecture = extractSection(text, ['Architecture']);
    const source = architecture || text;
    const adopted = uniqNonEmpty(extractLinkLines(source, type, slug)
      .map((line) => stripLinkPrefix(line.replace(/^채택:\s*/, ''), type, slug)));
    const rejected = extractSection(source, ['선택하지 않은 대안']) ||
                     extractSection(source, ['거부된 대안']);
    const tradeoffs = extractSection(source, ['Tradeoffs']);

    return {
      adopted,
      tradeoffs: tradeoffs.trim(),
      rejected: rejected.trim(),
    };
  }

  return {};
}

/**
 * decisions/<slug>.md 초안 내용을 생성한다.
 * @param {string} slug
 * @param {string} featureName  참조하는 feature 이름
 * @returns {string}
 */
function buildDecisionDoc(slug, featureName, context) {
  const title = slugToTitle(slug);
  const hasContext = context &&
    ((context.adopted && context.adopted.length > 0) || context.tradeoffs || context.rejected);
  const intro = hasContext && context.adopted && context.adopted.length > 0
    ? context.adopted.join('\n')
    : '<!-- 이 파일은 /built:plan Phase 5에서 자동 생성된 초안입니다. 내용을 채워주세요. -->';
  const tradeoffs = context && context.tradeoffs
    ? context.tradeoffs
    : '- 장점: \n- 단점: ';
  const rejected = context && context.rejected ? context.rejected : '';

  return [
    '---',
    'type: decision',
    `slug: ${slug}`,
    'adopted_count: 1',
    'tags: []',
    '---',
    '',
    `# ${title}`,
    '',
    intro,
    '',
    '## Tradeoffs',
    tradeoffs,
    '',
    '## 채택된 feature',
    `- [[features/${featureName}]]`,
    '',
    '## 거부된 대안',
    rejected,
    '',
  ].join('\n');
}

/**
 * entities/<slug>.md 초안 내용을 생성한다.
 * @param {string} slug
 * @param {string} featureName
 * @returns {string}
 */
function buildEntityDoc(slug, featureName, context) {
  const title = slugToTitle(slug);
  const description = context && context.descriptions && context.descriptions.length > 0
    ? context.descriptions.join('\n')
    : '<!-- 이 파일은 /built:plan Phase 5에서 자동 생성된 초안입니다. 내용을 채워주세요. -->';
  const featureLine = context && context.descriptions && context.descriptions.length > 0
    ? `- [[features/${featureName}]] — ${context.descriptions.join(' / ')}`
    : `- [[features/${featureName}]]`;

  return [
    '---',
    'type: entity',
    `slug: ${slug}`,
    'size_estimate: null',
    'growth: null',
    'defined_in: []',
    '---',
    '',
    `# ${title}`,
    '',
    description,
    '',
    '## 사용하는 feature',
    featureLine,
    '',
  ].join('\n');
}

/**
 * patterns/<slug>.md 초안 내용을 생성한다.
 * @param {string} slug
 * @param {string} featureName
 * @returns {string}
 */
function buildPatternDoc(slug, featureName, context) {
  const title = slugToTitle(slug);
  const description = context && context.descriptions && context.descriptions.length > 0
    ? context.descriptions.join('\n')
    : '<!-- 이 파일은 /built:plan Phase 5에서 자동 생성된 초안입니다. 내용을 채워주세요. -->';
  const featureLine = context && context.descriptions && context.descriptions.length > 0
    ? `- [[features/${featureName}]] — ${context.descriptions.join(' / ')}`
    : `- [[features/${featureName}]]`;

  return [
    '---',
    'type: pattern',
    `slug: ${slug}`,
    'reference_file: null',
    'tags: []',
    '---',
    '',
    `# ${title}`,
    '',
    description,
    '',
    '## 이 패턴을 쓰는 feature',
    featureLine,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 핵심 API
// ---------------------------------------------------------------------------

/**
 * feature-spec.md의 wikilink를 파싱해 누락된 보조 문서를 생성한다.
 *
 * @param {string} featureSpecPath  .built/features/<name>.md 절대경로
 * @param {string} builtDir         .built 디렉토리 절대경로
 * @returns {{ created: string[], skipped: string[] }}
 */
function saveAuxDocs(featureSpecPath, builtDir) {
  if (!fs.existsSync(featureSpecPath)) {
    throw new Error(`feature spec 파일을 찾을 수 없습니다: ${featureSpecPath}`);
  }

  const text        = fs.readFileSync(featureSpecPath, 'utf8');
  const featureName = path.basename(featureSpecPath, '.md');

  const created  = [];
  const skipped  = [];

  // 각 타입별로 wikilink 추출 후 파일 생성 (없는 경우만)
  const types = [
    {
      dir:     'decisions',
      slugs:   extractWikilinks(text, 'decisions'),
      builder: buildDecisionDoc,
    },
    {
      dir:     'entities',
      slugs:   extractWikilinks(text, 'entities'),
      builder: buildEntityDoc,
    },
    {
      dir:     'patterns',
      slugs:   extractWikilinks(text, 'patterns'),
      builder: buildPatternDoc,
    },
  ];

  for (const { dir, slugs, builder } of types) {
    const targetDir = path.join(builtDir, dir);
    fs.mkdirSync(targetDir, { recursive: true });

    for (const slug of slugs) {
      const filePath = path.join(targetDir, `${slug}.md`);

      if (fs.existsSync(filePath)) {
        skipped.push(`${dir}/${slug}.md`);
        continue;
      }

      const content = builder(slug, featureName, extractAuxContext(text, dir, slug));
      fs.writeFileSync(filePath, content, 'utf8');
      created.push(`${dir}/${slug}.md`);
    }
  }

  return { created, skipped };
}

// ---------------------------------------------------------------------------
// CLI 실행 지원
// ---------------------------------------------------------------------------

if (require.main === module) {
  // 사용: node scripts/plan-save.js <featureSpecPath> [builtDir]
  const [,, featureSpecPath, builtDirArg] = process.argv;

  if (!featureSpecPath) {
    console.error('사용: node scripts/plan-save.js <featureSpecPath> [builtDir]');
    process.exit(1);
  }

  const resolvedSpec    = path.resolve(featureSpecPath);
  const resolvedBuilt   = builtDirArg
    ? path.resolve(builtDirArg)
    : path.join(path.dirname(resolvedSpec), '..');

  try {
    const { created, skipped } = saveAuxDocs(resolvedSpec, resolvedBuilt);

    if (created.length > 0) {
      console.log('신규 생성:');
      for (const f of created) console.log(`  + ${f}`);
    }
    if (skipped.length > 0) {
      console.log('이미 존재 (skip):');
      for (const f of skipped) console.log(`  - ${f}`);
    }
    if (created.length === 0 && skipped.length === 0) {
      console.log('생성할 보조 문서가 없습니다.');
    }
  } catch (err) {
    console.error(`오류: ${err.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = { saveAuxDocs, extractWikilinks };
