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
 * decisions/<slug>.md 초안 내용을 생성한다.
 * @param {string} slug
 * @param {string} featureName  참조하는 feature 이름
 * @returns {string}
 */
function buildDecisionDoc(slug, featureName) {
  const title = slugToTitle(slug);
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
    '<!-- 이 파일은 /built:plan Phase 5에서 자동 생성된 초안입니다. 내용을 채워주세요. -->',
    '',
    '## Tradeoffs',
    '- 장점: ',
    '- 단점: ',
    '',
    '## 채택된 feature',
    `- [[features/${featureName}]]`,
    '',
    '## 거부된 대안',
    '',
  ].join('\n');
}

/**
 * entities/<slug>.md 초안 내용을 생성한다.
 * @param {string} slug
 * @param {string} featureName
 * @returns {string}
 */
function buildEntityDoc(slug, featureName) {
  const title = slugToTitle(slug);
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
    '<!-- 이 파일은 /built:plan Phase 5에서 자동 생성된 초안입니다. 내용을 채워주세요. -->',
    '',
    '## 사용하는 feature',
    `- [[features/${featureName}]]`,
    '',
  ].join('\n');
}

/**
 * patterns/<slug>.md 초안 내용을 생성한다.
 * @param {string} slug
 * @param {string} featureName
 * @returns {string}
 */
function buildPatternDoc(slug, featureName) {
  const title = slugToTitle(slug);
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
    '<!-- 이 파일은 /built:plan Phase 5에서 자동 생성된 초안입니다. 내용을 채워주세요. -->',
    '',
    '## 이 패턴을 쓰는 feature',
    `- [[features/${featureName}]]`,
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

      const content = builder(slug, featureName);
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
