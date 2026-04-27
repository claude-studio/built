/**
 * plan-draft.js — .built/runs/<feature>/plan-draft.md 읽기/쓰기/삭제 헬퍼
 *
 * plan-draft.md는 /built:plan 인터뷰 중 세션 중단 시 복구를 위한 중간 저장 파일이다.
 * .gitignore로 추적 제외되며 Phase 5 완료 후 자동 삭제된다.
 *
 * 외부 npm 패키지 없음 — Node.js 내장 모듈만 사용.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function projectRootFromArgv(argv) {
  const idx = argv.indexOf('--project-root');
  if (idx === -1) return null;
  const value = argv[idx + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('--project-root requires a path');
  }
  return value;
}

function resolveProjectRoot(options) {
  const explicitRoot = typeof options === 'string'
    ? options
    : options && options.projectRoot;

  return path.resolve(
    explicitRoot ||
    projectRootFromArgv(process.argv) ||
    process.env.BUILT_PROJECT_ROOT ||
    process.cwd()
  );
}

/**
 * plan-draft.md 경로를 반환한다.
 * @param {string} feature  kebab-case feature 이름
 * @param {object|string} [options]  { projectRoot } 또는 project root path
 * @returns {string}
 */
function draftPath(feature, options) {
  return path.join(resolveProjectRoot(options), '.built', 'runs', feature, 'plan-draft.md');
}

/**
 * 해당 feature의 plan-draft.md가 존재하는지 확인한다.
 * @param {string} feature
 * @param {object|string} [options]
 * @returns {boolean}
 */
function exists(feature, options) {
  return fs.existsSync(draftPath(feature, options));
}

/**
 * plan-draft.md를 읽어 내용을 반환한다. 파일이 없으면 null을 반환한다.
 * @param {string} feature
 * @param {object|string} [options]
 * @returns {string|null}
 */
function read(feature, options) {
  const p = draftPath(feature, options);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

/**
 * plan-draft.md에 내용을 저장한다 (디렉토리 자동 생성).
 * @param {string} feature
 * @param {string} content  저장할 마크다운 내용
 * @param {object|string} [options]
 */
function write(feature, content, options) {
  const p = draftPath(feature, options);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

/**
 * plan-draft.md를 삭제한다. 파일이 없어도 에러 없이 종료한다.
 * @param {string} feature
 * @param {object|string} [options]
 */
function remove(feature, options) {
  const p = draftPath(feature, options);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
  }
}

/**
 * 현재 Phase와 수집된 응답으로 draft 마크다운을 생성한다.
 * @param {object} opts
 * @param {string}  opts.feature
 * @param {number}  opts.phase           완료된 Phase 번호 (1~4)
 * @param {string}  [opts.intentPurpose]
 * @param {string}  [opts.intentScope]
 * @param {string}  [opts.intentData]
 * @param {string}  [opts.intentConstraints]
 * @param {string}  [opts.archDecision]
 * @param {string}  [opts.buildPlan]
 * @returns {string} 마크다운 문자열
 */
function buildContent(opts) {
  const {
    feature,
    phase,
    intentPurpose = '',
    intentScope = '',
    intentData = '',
    intentConstraints = '',
    archDecision = '',
    buildPlan = '',
  } = opts;

  const savedAt = new Date().toISOString();

  return `---
feature: ${feature}
saved_at: ${savedAt}
phase_completed: ${phase}
---

# plan-draft — ${feature}

> 자동 저장 파일입니다. Phase 5 완료 후 삭제됩니다.
> 세션을 재시작하면 이 파일을 감지해 이어서 진행할 수 있습니다.

## Phase 1: Intent

### Purpose & Context
${intentPurpose}

### Scope & Anti-Goals
${intentScope}

### Content & Data
${intentData}

### Constraints
${intentConstraints}

## Phase 2: Architecture Decision
${archDecision}

## Phase 3: Build Plan
${buildPlan}
`;
}

module.exports = { resolveProjectRoot, draftPath, exists, read, write, remove, buildContent };
