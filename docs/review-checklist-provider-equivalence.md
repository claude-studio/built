# Provider 결과 동등성 리뷰 체크리스트

작성일: 2026-04-26 KST

provider(Claude/Codex)를 전환하거나 새 provider를 추가할 때 동등성을 판정하는 기준을 정의한다.
동등성은 "같은 코드 diff"가 아니라 "같은 파일 계약 + 같은 acceptance criteria 충족 여부"로 판단한다.

## 1. 완료 판정 원칙

- 완료는 provider 응답 내용이 아니라 **phase 산출물 파일의 status 필드**로 판정한다.
- do phase 완료: `do-result.md` frontmatter의 `status: completed`
- check phase 통과: `check-result.md` frontmatter의 `status: approved`
- plan_synthesis 완료: `plan-synthesis.json` 존재 + `output.steps` 최소 1개 + `output.acceptance_criteria` 최소 1개

provider A와 provider B가 각각 다른 코드를 생성해도, 동일한 acceptance criteria를 충족하면 동등하다.

## 2. provider 불변 필드 (반드시 같아야 하는 필드)

아래 필드는 provider가 무엇이든 동일한 값 또는 동일한 타입/의미를 가져야 한다.

### plan-synthesis.json

| 필드 | 동일성 조건 |
|------|-------------|
| `feature_id` | 입력 feature ID와 정확히 일치 |
| `phase` | 항상 `'plan_synthesis'` |
| `created_at` | 유효한 ISO 8601 타임스탬프 (값은 다를 수 있음) |
| `output` | 객체, 아래 output 필드 포함 |
| `output.summary` | 비어있지 않은 문자열 |
| `output.steps` | 배열, 최소 1개, 각 step에 `id`/`title`/`files`/`intent` 포함 |
| `output.acceptance_criteria` | 배열, 각 항목에 `criterion`/`verification` 포함 |
| `output.risks` | 배열 (빈 배열 허용) |
| `output.out_of_scope` | 배열 (빈 배열 허용) |

### progress.json (do phase)

| 필드 | 동일성 조건 |
|------|-------------|
| `feature` | 입력 featureId와 정확히 일치 |
| `phase` | 입력 phase와 정확히 일치 |
| `status` | `'completed'` / `'failed'` / `'crashed'` 중 하나 |
| `turn` | number (>= 0) |
| `tool_calls` | number (>= 0) |
| `started_at` | 유효한 ISO 8601 타임스탬프 |
| `updated_at` | 유효한 ISO 8601 타임스탬프 |

### do-result.md frontmatter

| 필드 | 동일성 조건 |
|------|-------------|
| `feature_id` | 입력 featureId와 정확히 일치 |
| `status` | `'completed'` 또는 `'failed'` |
| `duration_ms` | number |
| `created_at` | 유효한 ISO 8601 타임스탬프 |

### check-result.md frontmatter

| 필드 | 동일성 조건 |
|------|-------------|
| `feature` | do phase feature와 정확히 일치 |
| `status` | `'approved'` 또는 `'needs_changes'` |
| `checked_at` | 유효한 ISO 8601 타임스탬프 |

## 3. provider 고유 필드 (달라도 되는 필드)

아래 필드는 provider에 따라 다른 값을 가질 수 있으며, 동등성 판정에 포함하지 않는다.

### plan-synthesis.json

| 필드 | 이유 |
|------|------|
| `provider` | provider 이름 자체가 다름 |
| `model` | 모델명이 다름 (`claude-opus-4-5` vs `gpt-5.5`) |
| `output.summary` 내용 | 같은 기능을 다른 표현으로 설명할 수 있음 |
| `output.steps` 내용 | 구현 접근 방식이 달라도 acceptance criteria를 충족하면 동등 |

### progress.json (do phase)

| 필드 | 이유 |
|------|------|
| `session_id` | provider 내부 식별자가 다름 |
| `cost_usd` | provider별 pricing 차이 |
| `input_tokens` / `output_tokens` | 토크나이저가 달라 수치가 다름 |
| `last_text` | provider 응답 내용이 다를 수 있음 |
| `stop_reason` | `end_turn` vs provider별 표현 |

### do-result.md frontmatter

| 필드 | 이유 |
|------|------|
| `model` | 사용된 모델명이 다름 |
| `cost_usd` | provider별 pricing |

### check-result.md body

| 필드 | 이유 |
|------|------|
| `issues` 내용 | 검토 의견은 Claude/다른 검토자가 다를 수 있음 |
| `acceptance_criteria_results` 내용 | 설명 표현이 다를 수 있음 |
| `summary` 내용 | 검토 요약 표현이 다를 수 있음 |

## 4. 리뷰 체크리스트

PR/코드 리뷰 시 provider 전환 관련 변경에 대해 아래 항목을 확인한다.

### 필수 확인 항목

- [ ] `test/e2e/scenarios/05-provider-equivalence-contracts.js`가 통과하는가?
- [ ] `plan-synthesis.json`의 불변 필드(`feature_id`, `phase`, `output` 구조)가 유지되는가?
- [ ] `progress.json`의 불변 필드(`feature`, `phase`, `status`, `turn`, `tool_calls`)가 유지되는가?
- [ ] `do-result.md`의 불변 frontmatter 필드(`feature_id`, `status`, `duration_ms`, `created_at`)가 유지되는가?
- [ ] `check-result.md`의 불변 frontmatter 필드(`feature`, `status`, `checked_at`)가 유지되는가?
- [ ] provider가 결과 파일을 직접 쓰지 않고 runner/writer 계층을 통해 쓰는가?

### provider 전환 시 추가 확인

- [ ] 신규 provider의 이벤트가 `event-normalizer.js`를 통해 표준 이벤트로 변환되는가?
- [ ] `standard-writer`가 신규 provider 이벤트를 처리할 수 있는가?
- [ ] `normalizePlanSynthesisOutput`이 신규 provider 출력을 올바르게 정규화하는가?
- [ ] `PROVIDER_INVARIANT_FIELDS`와 `PROVIDER_SPECIFIC_FIELDS` 상수가 최신 상태인가?
  - 경로: `test/fixtures/provider-common-input.js`

### 완료 판정 기준 확인

- [ ] 완료 판정이 provider 이름/응답 내용이 아닌 파일 `status` 필드로 이루어지는가?
- [ ] acceptance criteria 충족 여부가 `check-result.md`의 `acceptance_criteria_results`로 기록되는가?
- [ ] `status: needs_changes` 시 `issues` 목록이 명확한가?

## 5. 동등성 검증 범위

| phase | 검증 대상 | 검증 방법 |
|-------|-----------|-----------|
| plan_synthesis | plan-synthesis.json, plan-synthesis.md | `test/e2e/scenarios/05-...` 섹션 1 |
| do | progress.json, do-result.md | `test/e2e/scenarios/05-...` 섹션 2 |
| check | check-result.md | `test/e2e/scenarios/05-...` 섹션 3 |
| 완료 판정 | status 필드 기반 판정 | `test/e2e/scenarios/05-...` 섹션 4 |

기존 do phase 단위 파일 계약:
- `test/e2e/scenarios/04-fake-provider-file-contracts.js` — do phase 상세 이벤트 검증

## 6. 불변 원칙 (north-star 연계)

이 체크리스트는 `kg/goals/north-star.md`의 아래 원칙을 테스트로 구체화한다.

- provider 파일 직접 작성 금지 — runner/writer 계층 위임
- 상태 SSOT 단일화 — state.json, progress.json, do-result.md 계약 유지
- built provider와 Multica agent runtime 분리 — 파일 계약이 그 경계를 보장
- real provider smoke와 기본 테스트 분리 — 이 파일의 모든 테스트는 fake provider 기반, 오프라인 실행 가능
