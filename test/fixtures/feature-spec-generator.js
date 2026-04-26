/**
 * test/fixtures/feature-spec-generator.js
 *
 * 테스트용 feature spec / frontmatter 생성 헬퍼.
 *
 * 목적:
 *   - provider, check, iter, report 테스트에서 반복되는 feature spec fixture를 일관되게 생성한다.
 *   - acceptance criteria, excludes, build_files, provider config 변형을 쉽게 만들 수 있게 한다.
 *   - 생성된 frontmatter가 docs/contracts/file-contracts.md 및 BUILT-DESIGN.md §7 계약과 일치함을 보장한다.
 *
 * 외부 npm 패키지 없음 (Node.js 내장 모듈만 사용).
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// 기본 fixture 값
// ---------------------------------------------------------------------------

const DEFAULT_FEATURE_ID = 'user-auth';

const DEFAULT_ACCEPTANCE_CRITERIA = [
  '올바른 이메일/비밀번호로 로그인하면 JWT 토큰을 반환한다.',
  '잘못된 자격 증명으로 요청하면 401을 반환한다.',
  '토큰은 24시간 유효하다.',
];

const DEFAULT_EXCLUDES = [
  '소셜 로그인',
  '2FA',
];

const DEFAULT_BUILD_FILES = [
  'src/routes/auth.js',
  'src/utils/jwt.js',
  'src/models/user.js',
];

/** 기본 provider config (run-request.json providers 필드용) */
const DEFAULT_PROVIDER_CONFIG = {
  plan_synthesis: 'claude',
  do: {
    name:       'claude',
    model:      null,
    effort:     null,
    sandbox:    'workspace-write',
    timeout_ms: 1800000,
  },
  check: 'claude',
};

// ---------------------------------------------------------------------------
// feature spec 마크다운 생성
// ---------------------------------------------------------------------------

/**
 * feature spec markdown (frontmatter + 본문)을 생성한다.
 * BUILT-DESIGN.md §7 스키마를 준수한다.
 *
 * @param {object} [opts]
 * @param {string}   [opts.featureId='user-auth']        feature 식별자 (kebab-case)
 * @param {string[]} [opts.acceptanceCriteria]           완료 기준 목록 (본문 ## 완료 기준 섹션)
 * @param {string[]} [opts.excludes]                     비범위 항목 (frontmatter excludes)
 * @param {string[]} [opts.buildFiles]                   빌드 파일 목록 (frontmatter build_files)
 * @param {string}   [opts.status='planned']             feature 상태
 * @param {string}   [opts.createdAt]                    ISO 날짜 (YYYY-MM-DD), 미지정 시 오늘
 * @param {string}   [opts.primaryUserAction]            primary_user_action 값
 * @param {string}   [opts.summary]                      ## Intent 본문 요약
 * @returns {string}  완성된 feature spec 마크다운
 */
function buildFeatureSpec(opts) {
  const {
    featureId          = DEFAULT_FEATURE_ID,
    acceptanceCriteria = DEFAULT_ACCEPTANCE_CRITERIA,
    excludes           = DEFAULT_EXCLUDES,
    buildFiles         = DEFAULT_BUILD_FILES,
    status             = 'planned',
    createdAt          = new Date().toISOString().slice(0, 10),
    primaryUserAction  = '이메일/비밀번호로 로그인한다.',
    summary            = `${featureId} feature 구현`,
  } = opts || {};

  const excludesYaml  = excludes.map(e => `  - "${e}"`).join('\n');
  const buildFilesYaml = buildFiles.map(f => `  - "${f}"`).join('\n');
  const acLines       = acceptanceCriteria.map(c => `- ${c}`).join('\n');

  return [
    '---',
    `feature: ${featureId}`,
    'version: 1',
    `created_at: ${createdAt}`,
    'confirmed_by_user: true',
    `status: ${status}`,
    'tags: []',
    `primary_user_action: "${primaryUserAction}"`,
    'persona:',
    '  role: "테스트 사용자"',
    '  context: "테스트 환경"',
    '  frequency: "테스트 실행마다"',
    '  state_of_mind: "기능 검증 중"',
    'success_criteria: []',
    'includes: []',
    'excludes:',
    excludesYaml,
    'anti_goals: []',
    'architecture_decision: ""',
    'build_files:',
    buildFilesYaml,
    'constraints:',
    '  technical: []',
    '  timeline: ""',
    '  accessibility: ""',
    '---',
    '',
    `# ${featureId}`,
    '',
    '## Intent',
    '',
    summary,
    '',
    '## 완료 기준',
    '',
    acLines,
    '',
    '## 범위 외',
    '',
    excludes.map(e => `- ${e}`).join('\n'),
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// frontmatter만 생성 (기계 파싱 검증용)
// ---------------------------------------------------------------------------

/**
 * do-result.md 최소 frontmatter를 생성한다.
 * docs/contracts/file-contracts.md 'do-result.md 최소 frontmatter' 계약 기준.
 *
 * @param {object} [opts]
 * @param {string}  [opts.featureId='user-auth']
 * @param {string}  [opts.status='completed']       'completed' | 'failed'
 * @param {string}  [opts.model='claude-opus-4-5']
 * @param {number}  [opts.costUsd=0]
 * @param {number}  [opts.durationMs=12000]
 * @param {string}  [opts.createdAt]                ISO 타임스탬프
 * @returns {object}  frontmatter 데이터 객체
 */
function buildDoResultFrontmatter(opts) {
  const {
    featureId  = DEFAULT_FEATURE_ID,
    status     = 'completed',
    model      = 'claude-opus-4-5',
    costUsd    = 0,
    durationMs = 12000,
    createdAt  = new Date().toISOString(),
  } = opts || {};

  return {
    feature_id:  featureId,
    status,
    model,
    cost_usd:    costUsd,
    duration_ms: durationMs,
    created_at:  createdAt,
  };
}

/**
 * check-result.md 최소 frontmatter를 생성한다.
 * docs/contracts/file-contracts.md 'check-result.md 최소 의미' 계약 기준.
 *
 * @param {object} [opts]
 * @param {string}  [opts.featureId='user-auth']
 * @param {string}  [opts.status='approved']        'approved' | 'needs_changes'
 * @param {string}  [opts.checkedAt]                ISO 타임스탬프
 * @returns {object}  frontmatter 데이터 객체
 */
function buildCheckResultFrontmatter(opts) {
  const {
    featureId = DEFAULT_FEATURE_ID,
    status    = 'approved',
    checkedAt = new Date().toISOString(),
  } = opts || {};

  return {
    feature:    featureId,
    status,
    checked_at: checkedAt,
  };
}

// ---------------------------------------------------------------------------
// provider config 변형
// ---------------------------------------------------------------------------

/**
 * run-request.json providers 필드 변형을 생성한다.
 *
 * @param {object} [overrides]  DEFAULT_PROVIDER_CONFIG를 덮어쓸 필드
 * @returns {object}  providers 설정 객체
 */
function buildProviderConfig(overrides) {
  return Object.assign({}, DEFAULT_PROVIDER_CONFIG, overrides || {});
}

/**
 * Codex do provider 설정을 반환한다.
 * @param {object} [opts]
 * @param {string}  [opts.model='gpt-5.5']
 * @param {string}  [opts.effort='high']
 * @returns {object}
 */
function buildCodexDoConfig(opts) {
  const { model = 'gpt-5.5', effort = 'high' } = opts || {};
  return {
    name:       'codex',
    model,
    effort,
    sandbox:    'workspace-write',
    timeout_ms: 1800000,
  };
}

// ---------------------------------------------------------------------------
// 파일시스템 헬퍼 — 임시 디렉토리에 feature spec 작성
// ---------------------------------------------------------------------------

/**
 * 임시 프로젝트 디렉토리를 생성하고 feature spec 파일을 작성한다.
 * 테스트에서 tmp 프로젝트 루트가 필요할 때 사용한다.
 *
 * @param {object} [opts]
 * @param {string}  [opts.featureId]          feature 식별자
 * @param {string}  [opts.specContent]        명시적으로 주입할 spec 내용 (미지정 시 buildFeatureSpec 생성값)
 * @param {object}  [opts.specOpts]           buildFeatureSpec에 전달할 옵션
 * @param {string}  [opts.tmpPrefix='feat-']  mkdtemp 프리픽스
 * @returns {{ projectRoot: string, specPath: string, featureId: string, cleanup: Function }}
 */
function makeFeatureSpecProject(opts) {
  const {
    featureId   = DEFAULT_FEATURE_ID,
    specContent,
    specOpts    = {},
    tmpPrefix   = 'feat-',
  } = opts || {};

  const projectRoot  = fs.mkdtempSync(path.join(os.tmpdir(), tmpPrefix));
  const featuresDir  = path.join(projectRoot, '.built', 'features');
  fs.mkdirSync(featuresDir, { recursive: true });

  const content  = specContent !== undefined
    ? specContent
    : buildFeatureSpec(Object.assign({ featureId }, specOpts));

  const specPath = path.join(featuresDir, `${featureId}.md`);
  fs.writeFileSync(specPath, content, 'utf8');

  return {
    projectRoot,
    specPath,
    featureId,
    cleanup: () => fs.rmSync(projectRoot, { recursive: true, force: true }),
  };
}

/**
 * 테스트용 run-request.json을 프로젝트 디렉토리에 작성한다.
 *
 * @param {string} projectRoot   프로젝트 루트
 * @param {string} featureId     feature 식별자
 * @param {object} [providers]   providers 설정 (미지정 시 DEFAULT_PROVIDER_CONFIG)
 * @returns {string}  작성된 파일 경로
 */
function writeRunRequest(projectRoot, featureId, providers) {
  const runDir = path.join(projectRoot, '.built', 'runtime', 'runs', featureId);
  fs.mkdirSync(runDir, { recursive: true });

  const runRequest = {
    featureId,
    planPath:   path.join('.built', 'features', `${featureId}.md`),
    model:      'claude-opus-4-5',
    createdAt:  new Date().toISOString(),
    providers:  providers || DEFAULT_PROVIDER_CONFIG,
  };

  const filePath = path.join(runDir, 'run-request.json');
  fs.writeFileSync(filePath, JSON.stringify(runRequest, null, 2), 'utf8');
  return filePath;
}

// ---------------------------------------------------------------------------
// 계약 검증 헬퍼
// ---------------------------------------------------------------------------

/**
 * feature spec frontmatter가 BUILT-DESIGN.md §7 필수 필드를 포함하는지 검증한다.
 * 테스트에서 assert 전에 호출해 fixture와 계약의 일치를 보장한다.
 *
 * @param {object} fm  파싱된 frontmatter 데이터 객체
 * @throws {Error}     누락된 필드가 있을 때
 */
function assertFeatureSpecFrontmatter(fm) {
  const REQUIRED = [
    'feature', 'version', 'created_at', 'confirmed_by_user',
    'status', 'primary_user_action', 'excludes', 'build_files',
  ];
  for (const key of REQUIRED) {
    if (!(key in fm)) {
      throw new Error(`feature spec frontmatter 누락 필드: ${key}`);
    }
  }
  if (typeof fm.feature !== 'string' || !fm.feature) {
    throw new Error('feature는 비어있지 않은 문자열이어야 한다.');
  }
  if (!Array.isArray(fm.excludes)) {
    throw new Error('excludes는 배열이어야 한다.');
  }
  if (!Array.isArray(fm.build_files)) {
    throw new Error('build_files는 배열이어야 한다.');
  }
}

/**
 * do-result.md frontmatter가 file-contracts.md 필수 필드를 포함하는지 검증한다.
 *
 * @param {object} fm  파싱된 frontmatter 데이터 객체
 * @throws {Error}
 */
function assertDoResultFrontmatter(fm) {
  const REQUIRED = ['feature_id', 'status', 'duration_ms', 'created_at'];
  for (const key of REQUIRED) {
    if (!(key in fm)) {
      throw new Error(`do-result.md frontmatter 누락 필드: ${key}`);
    }
  }
  const validStatuses = ['completed', 'failed'];
  if (!validStatuses.includes(fm.status)) {
    throw new Error(`do-result.md status는 '${validStatuses.join("' | '")}' 이어야 한다. got: ${fm.status}`);
  }
}

/**
 * check-result.md frontmatter가 file-contracts.md 필수 필드를 포함하는지 검증한다.
 *
 * @param {object} fm  파싱된 frontmatter 데이터 객체
 * @throws {Error}
 */
function assertCheckResultFrontmatter(fm) {
  const REQUIRED = ['feature', 'status', 'checked_at'];
  for (const key of REQUIRED) {
    if (!(key in fm)) {
      throw new Error(`check-result.md frontmatter 누락 필드: ${key}`);
    }
  }
  const validStatuses = ['approved', 'needs_changes'];
  if (!validStatuses.includes(fm.status)) {
    throw new Error(`check-result.md status는 '${validStatuses.join("' | '")}' 이어야 한다. got: ${fm.status}`);
  }
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = {
  // 상수
  DEFAULT_FEATURE_ID,
  DEFAULT_ACCEPTANCE_CRITERIA,
  DEFAULT_EXCLUDES,
  DEFAULT_BUILD_FILES,
  DEFAULT_PROVIDER_CONFIG,

  // 생성 함수
  buildFeatureSpec,
  buildDoResultFrontmatter,
  buildCheckResultFrontmatter,
  buildProviderConfig,
  buildCodexDoConfig,

  // 파일시스템 헬퍼
  makeFeatureSpecProject,
  writeRunRequest,

  // 계약 검증
  assertFeatureSpecFrontmatter,
  assertDoResultFrontmatter,
  assertCheckResultFrontmatter,
};
