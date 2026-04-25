/**
 * test/fixtures/provider-common-input.js
 *
 * Provider 간 동등성 검증을 위한 공통 입력 fixture.
 *
 * 목적:
 *   - 여러 테스트 시나리오에서 동일한 fake 입력 데이터를 재사용한다.
 *   - provider별로 달라도 되는 필드와 반드시 같아야 하는 필드를 명시한다.
 *   - 이 상수를 기준으로 provider 전환 후에도 동등성 검증을 통과해야 한다.
 *
 * 외부 npm 패키지 없음 (Node.js 내장 모듈만 사용).
 */

'use strict';

// ---------------------------------------------------------------------------
// 공통 feature spec (plan_synthesis 입력)
// ---------------------------------------------------------------------------

/**
 * 모든 provider가 같은 입력으로 처리해야 하는 feature spec.
 * plan_synthesis → do → check 파이프라인의 공통 출발점.
 */
const FAKE_FEATURE_SPEC = `# Feature: user-auth

## 요약
이메일/비밀번호 기반 로그인 기능을 구현한다.

## 완료 기준
- 올바른 이메일/비밀번호로 로그인하면 JWT 토큰을 반환한다.
- 잘못된 자격 증명으로 요청하면 401을 반환한다.
- 토큰은 24시간 유효하다.

## 범위 외
- 소셜 로그인
- 2FA
`;

// ---------------------------------------------------------------------------
// plan_synthesis phase — fake provider 출력
// ---------------------------------------------------------------------------

/**
 * fake Claude plan_synthesis 출력 (Claude가 반환하는 JSON).
 * PLAN_SYNTHESIS_SCHEMA를 충족한다.
 */
const FAKE_CLAUDE_PLAN_SYNTHESIS_OUTPUT = {
  summary: 'JWT 기반 로그인 API를 구현한다. POST /auth/login 엔드포인트를 생성하고 bcrypt로 비밀번호를 검증한다.',
  steps: [
    {
      id: 'step-1',
      title: '사용자 모델 및 DB 스키마 정의',
      files: ['src/models/user.js', 'migrations/001_create_users.sql'],
      intent: 'email + password_hash 컬럼을 포함한 users 테이블을 정의한다.',
    },
    {
      id: 'step-2',
      title: 'POST /auth/login 핸들러 구현',
      files: ['src/routes/auth.js'],
      intent: '이메일로 사용자를 조회하고 bcrypt.compare로 비밀번호를 검증한다.',
    },
    {
      id: 'step-3',
      title: 'JWT 발급 유틸리티 추가',
      files: ['src/utils/jwt.js'],
      intent: 'sign/verify 함수를 구현하고 24시간 만료 토큰을 발급한다.',
    },
  ],
  acceptance_criteria: [
    { criterion: '올바른 자격 증명으로 로그인 시 JWT 반환', verification: 'POST /auth/login 200 응답에 token 필드 존재 확인' },
    { criterion: '잘못된 자격 증명 시 401 반환', verification: 'POST /auth/login 401 응답 확인' },
    { criterion: '토큰 만료 시간 24시간', verification: 'JWT payload의 exp 필드 검증' },
  ],
  risks: ['bcrypt 라이브러리 미설치 시 빌드 실패', 'JWT secret 미설정 시 런타임 오류'],
  out_of_scope: ['소셜 로그인', '2FA', 'refresh token'],
};

/**
 * fake Codex plan_synthesis 출력 (Codex가 반환하는 JSON).
 * 같은 feature spec을 다른 표현으로 계획한다 — 내용은 다를 수 있지만 구조는 같아야 한다.
 */
const FAKE_CODEX_PLAN_SYNTHESIS_OUTPUT = {
  summary: 'User authentication via email/password. Implement login endpoint with JWT issuance.',
  steps: [
    {
      id: 'step-1',
      title: 'Define User schema',
      files: ['src/models/user.js'],
      intent: 'Create user model with email and hashed password fields.',
    },
    {
      id: 'step-2',
      title: 'Implement /auth/login route',
      files: ['src/routes/auth.js', 'src/middleware/auth.js'],
      intent: 'Validate credentials and return signed JWT on success.',
    },
  ],
  acceptance_criteria: [
    { criterion: 'Valid credentials return JWT', verification: 'Integration test: POST /auth/login returns 200 with token' },
    { criterion: 'Invalid credentials return 401', verification: 'Integration test: POST /auth/login returns 401' },
    { criterion: 'Token expires in 24h', verification: 'Check JWT exp claim' },
  ],
  risks: ['Missing bcrypt dependency', 'JWT_SECRET env var not configured'],
  out_of_scope: ['Social login', '2FA'],
};

// ---------------------------------------------------------------------------
// do phase — fake provider 이벤트 시퀀스
// ---------------------------------------------------------------------------

/**
 * fake Claude raw 이벤트 시퀀스 (do phase).
 * Claude CLI 없이 정상 do phase 흐름을 시뮬레이션한다.
 */
const FAKE_CLAUDE_RAW_EVENTS = [
  { type: 'system', subtype: 'init', session_id: 'sess-claude-001', model: 'claude-opus-4-5' },
  {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: '기능 구현을 시작합니다.' }],
      usage:   { input_tokens: 200, output_tokens: 50 },
    },
  },
  {
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: 'tu_write_1', name: 'Write', input: { path: 'src/auth.js' } },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
    },
  },
  { type: 'tool_result', tool_use_id: 'tu_write_1' },
  {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: '구현이 완료되었습니다.' }],
      usage:   { input_tokens: 50, output_tokens: 30 },
    },
  },
  {
    type:           'result',
    subtype:        'success',
    result:         '# 구현 완료\n\nsrc/auth.js 파일 생성 완료.',
    total_cost_usd: 0.0042,
    duration_ms:    12000,
  },
];

/**
 * fake Codex 표준 이벤트 시퀀스 (do phase).
 * 동일한 논리적 흐름을 Codex 표준 이벤트로 표현한다.
 */
const FAKE_CODEX_STANDARD_EVENTS = [
  {
    type:      'phase_start',
    provider:  'codex',
    model:     'gpt-5.5',
    timestamp: '2026-04-26T00:00:00.000Z',
  },
  {
    type:      'text_delta',
    text:      '기능 구현을 시작합니다.',
    timestamp: '2026-04-26T00:00:01.000Z',
  },
  {
    type:      'tool_call',
    id:        'cmd_1',
    name:      'commandExecution',
    summary:   'src/auth.js 파일 생성',
    timestamp: '2026-04-26T00:00:02.000Z',
  },
  {
    type:      'tool_result',
    id:        'cmd_1',
    name:      'commandExecution',
    status:    'completed',
    exit_code: 0,
    timestamp: '2026-04-26T00:00:08.000Z',
  },
  {
    type:          'usage',
    input_tokens:  260,
    output_tokens: 100,
    cost_usd:      null,
    timestamp:     '2026-04-26T00:01:00.000Z',
  },
  {
    type:      'text_delta',
    text:      '구현이 완료되었습니다.',
    timestamp: '2026-04-26T00:01:01.000Z',
  },
  {
    type:        'phase_end',
    status:      'completed',
    duration_ms: 12000,
    result:      '# 구현 완료\n\nsrc/auth.js 파일 생성 완료.',
    timestamp:   '2026-04-26T00:01:02.000Z',
  },
];

// ---------------------------------------------------------------------------
// check phase — fake check 결과
// ---------------------------------------------------------------------------

/**
 * fake approved check 결과 (Claude가 검토했을 때).
 * check.js가 생성하는 check-result.md의 source data.
 */
const FAKE_CHECK_APPROVED = {
  feature:  'user-auth',
  status:   'approved',
  summary:  'All acceptance criteria are met. Implementation is complete and correct.',
  issues:   [],
  acceptance_criteria_results: [
    { criterion: '올바른 자격 증명으로 로그인 시 JWT 반환', passed: true },
    { criterion: '잘못된 자격 증명 시 401 반환', passed: true },
    { criterion: '토큰 만료 시간 24시간', passed: true },
  ],
};

/**
 * fake needs_changes check 결과 (Codex do phase 산출물을 Claude가 검토했을 때).
 * 완료 판정은 provider가 아니라 acceptance criteria 충족 여부로 결정된다.
 */
const FAKE_CHECK_NEEDS_CHANGES = {
  feature:  'user-auth',
  status:   'needs_changes',
  summary:  'Token expiry is not implemented correctly.',
  issues:   ['JWT exp claim is not set to 24h', 'Missing 401 response for invalid email'],
  acceptance_criteria_results: [
    { criterion: '올바른 자격 증명으로 로그인 시 JWT 반환', passed: true },
    { criterion: '잘못된 자격 증명 시 401 반환', passed: false },
    { criterion: '토큰 만료 시간 24시간', passed: false },
  ],
};

// ---------------------------------------------------------------------------
// 필드 분리: provider 불변 vs provider 고유
// ---------------------------------------------------------------------------

/**
 * Provider 불변 필드 (INVARIANT_FIELDS).
 *
 * 두 provider 모두 반드시 동일한 의미로 제공해야 하는 필드.
 * - 필드 존재 여부: 양 provider 모두 포함해야 함
 * - 값 동일 조건: 같은 feature/phase 입력을 받으면 같은 값이어야 하는 필드 (*로 표시)
 *
 * plan-synthesis.json:
 *   - feature_id*: 입력 feature와 일치
 *   - phase*: 'plan_synthesis'
 *   - created_at: ISO 타임스탬프 (값은 다를 수 있음)
 *   - output.steps: 최소 1개 이상의 step 배열
 *   - output.acceptance_criteria: 배열 (criterion, verification 필드 포함)
 *   - output.risks: 배열
 *   - output.out_of_scope: 배열
 *   - output.summary: 비어있지 않은 문자열
 *
 * progress.json (do phase):
 *   - feature*: 입력 featureId와 일치
 *   - phase*: 'do'
 *   - status*: 'completed' | 'failed' | 'crashed'
 *   - turn: number (>= 0)
 *   - tool_calls: number (>= 0)
 *   - started_at: ISO 타임스탬프
 *   - updated_at: ISO 타임스탬프
 *
 * do-result.md frontmatter:
 *   - feature_id*: 입력 featureId와 일치
 *   - status*: 'completed' | 'failed'
 *   - duration_ms: number
 *   - created_at: ISO 타임스탬프
 *
 * check-result.md frontmatter:
 *   - feature*: 입력 feature와 일치
 *   - status*: 'approved' | 'needs_changes'
 *   - checked_at: ISO 타임스탬프
 */
const PROVIDER_INVARIANT_FIELDS = {
  'plan-synthesis.json': ['feature_id', 'phase', 'created_at', 'output'],
  'plan-synthesis.json.output': ['summary', 'steps', 'acceptance_criteria', 'risks', 'out_of_scope'],
  'progress.json': ['feature', 'phase', 'status', 'turn', 'tool_calls', 'started_at', 'updated_at'],
  'do-result.md': ['feature_id', 'status', 'duration_ms', 'created_at'],
  'check-result.md': ['feature', 'status', 'checked_at'],
};

/**
 * Provider 고유 필드 (PROVIDER_SPECIFIC_FIELDS).
 *
 * provider에 따라 값이 달라도 되는 필드.
 * - 이 필드들은 provider 전환 시 값이 변하는 것이 정상이다.
 * - 동등성 판정(완료 판정, approval)은 이 필드 값에 의존하지 않는다.
 *
 * plan-synthesis.json:
 *   - provider: 'claude' vs 'codex'
 *   - model: 'claude-opus-4-5' vs 'gpt-5.5' 등
 *   - output.summary 내용: 표현 방식이 다를 수 있음
 *   - output.steps 내용: 같은 목표를 다른 구조로 표현할 수 있음
 *
 * progress.json (do phase):
 *   - session_id: provider 내부 식별자
 *   - cost_usd: provider별 pricing 차이
 *   - input_tokens / output_tokens: 토크나이저 차이
 *   - last_text: provider 응답 내용
 *   - stop_reason: 'end_turn' vs provider별 표현
 *
 * do-result.md frontmatter:
 *   - model: 사용된 모델명
 *   - cost_usd: provider별 pricing
 *
 * check-result.md body:
 *   - issues 내용: 검토 의견은 provider별로 다를 수 있음
 *   - acceptance_criteria_results 내용: 각 criterion 설명은 다를 수 있음
 *   - summary 내용: 검토 요약 표현
 */
const PROVIDER_SPECIFIC_FIELDS = {
  'plan-synthesis.json': ['provider', 'model'],
  'plan-synthesis.json.output.content': ['summary', 'steps content', 'acceptance_criteria content'],
  'progress.json': ['session_id', 'cost_usd', 'input_tokens', 'output_tokens', 'last_text', 'stop_reason'],
  'do-result.md': ['model', 'cost_usd'],
  'check-result.md.body': ['issues content', 'acceptance_criteria_results content', 'summary content'],
};

module.exports = {
  FAKE_FEATURE_SPEC,
  FAKE_CLAUDE_PLAN_SYNTHESIS_OUTPUT,
  FAKE_CODEX_PLAN_SYNTHESIS_OUTPUT,
  FAKE_CLAUDE_RAW_EVENTS,
  FAKE_CODEX_STANDARD_EVENTS,
  FAKE_CHECK_APPROVED,
  FAKE_CHECK_NEEDS_CHANGES,
  PROVIDER_INVARIANT_FIELDS,
  PROVIDER_SPECIFIC_FIELDS,
};
