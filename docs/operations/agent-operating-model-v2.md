# built 에이전트 운영모델 v2

상태: 초안
날짜: 2026-04-25
범위: built 프로젝트를 운영하는 Multica 에이전트

## 목적

이 문서는 built 프로젝트 에이전트 운영모델 v2를 정의한다.

즉시 목표는 Codex provider 도입을 포함한 provider 전환 작업을 안전하게 시작할 수 있도록, 현재 CTO 에이전트에 집중된 책임을 역할별로 분리하는 것이다. 장기 목표는 built가 provider, contract, 자동화, KG를 계속 확장해도 같은 운영 구조로 처리할 수 있게 만드는 것이다.

## 비목표

- built 런타임 코드를 변경하지 않는다.
- Codex provider 자체를 구현하지 않는다.
- live Multica 에이전트 지침을 이 문서만으로 즉시 변경하지 않는다.
- built provider 라우팅과 Multica agent runtime 라우팅을 섞지 않는다.

## 용어

**built provider**는 built의 feature phase를 실행하는 백엔드다. 예: `plan_synthesis`, `do`, `check`, `iter`, `report` phase에서 사용하는 `claude`, `codex`.

**Multica agent runtime**은 프로젝트 이슈를 처리하는 운영 에이전트가 어떤 모델/런타임으로 동작하는지를 뜻한다. 예: CTO는 Claude, `고급모델`은 Codex/GPT-5.5.

이 둘은 별개 축이다. Claude 기반 Developer가 Codex built provider를 구현할 수 있고, 나중에는 built의 `do` phase가 Codex로 실행되더라도 이슈 조율은 Claude 기반 CTO가 계속 맡을 수 있다.

## 설계 방향

설계는 한 번에 v2 목표 형태로 잡고, 적용은 단계적으로 한다.

즉 역할 경계는 지금 명확하게 재정의하되, live Multica 에이전트 지침 변경은 안전 순서대로 진행한다. 현재 freeze된 backlog는 v2 운영모델이 문서화되고 검토될 때까지 `blocked`와 unassigned 상태를 유지한다.

## Phase 1 역할

Phase 1은 최소 안정 운영팀만 만든다.

| 역할 | 기본 런타임 | 핵심 책임 |
| --- | --- | --- |
| CTO | Claude | backlog drain, 라우팅, 에스컬레이션, 최종 상태 관리 |
| Architect | Claude large context | 구조 설계, contract, reference research, 티켓 분해 |
| Developer | Claude | 일반 구현과 테스트 |
| Reviewer | Claude | 일반 PR 리뷰와 완료 기준 검증 |
| KG Recorder | Claude 또는 lightweight Claude | KG issue/decision/workflow 기록 |
| Operator | Claude 또는 lightweight Claude | heartbeat, stuck 감지, autopilot 이슈 triage |

Phase 2에서는 provider refactoring이 구현 중심 단계에 들어갈 때 Advanced Developer를 별도로 추가하거나 `고급모델`을 해당 모드로 활성화한다.

Phase 3에서는 실제 Codex provider의 `plan_synthesis`나 `do` 단계 검토에 별도 고급 리뷰가 필요할 때 Advanced Reviewer를 추가한다.

Phase 3 전까지는 `고급모델` 1개를 고복잡도 capability lane으로 유지한다. 구현 또는 review-assist에 사용할 수 있지만, 자신이 구현한 PR을 최종 리뷰하면 안 된다.

## 런타임 배치 기준

| 작업 유형 | 기본 역할/런타임 | 에스컬레이션 |
| --- | --- | --- |
| 큐 triage와 backlog drain | CTO / Claude | 사용자 |
| 대규모 repo/docs 분석 | Architect / Claude large context | 제한된 대안 분석만 고급모델 |
| contract 설계와 PR 분해 | Architect / Claude large context | 어려운 tradeoff만 고급모델 |
| 일반 구현 | Developer / Claude | 고복잡도 생성은 고급모델 |
| 고복잡도 구현 | 고급모델 / Codex GPT-5.5 | Reviewer / Claude 교차 검토 필수 |
| 일반 리뷰 | Reviewer / Claude | second opinion만 고급모델 |
| KG 기록과 decision | KG Recorder / Claude | 논쟁적 결정은 Architect |
| heartbeat, stuck, autopilot hygiene | Operator / Claude | 라우팅 결정은 CTO |

Architect는 기본적으로 Claude large context를 사용한다. built의 구조 설계는 넓은 repo 문맥, 한국어 KG/문서 스타일, 기존 운영 맥락을 한 번에 읽는 능력이 중요하기 때문이다. Codex/GPT-5.5는 입력 계약이 명확한 고복잡도 생성, synthesis, 독립 검토에 쓴다.

## 기본 워크플로우

1. backlog 이슈는 특정 역할에 즉시 준비된 상태가 아니면 assignee 없이 생성한다.
2. backlog 중 하나를 CTO에 assign해서 drain loop를 트리거한다.
3. CTO는 assigned issue 하나만 보지 않고 프로젝트 전체 backlog를 조회한다.
4. CTO는 ready 상태인 이슈를 역할별로 라우팅하고, comment에 역할/이유/기대 산출물/완료 기준을 남긴다.
5. assigned role은 라우팅된 scope 안에서만 작업한다.
6. 구현 이슈는 Developer가 PR을 만든다.
7. Reviewer가 PR을 검토하고 통과 또는 반려한다.
8. KG Recorder가 완료 이슈와 decision을 기록한다.
9. CTO가 최종 상태를 확인하고 다음 backlog를 처리한다.

## 핸드오프 불변조건

- status와 assignee는 함께 움직여야 한다.
- `backlog`는 아직 실행 대상으로 선택되지 않은 상태다.
- `in_progress`는 현재 작업 중인 역할에게 assign된 상태다.
- `in_review`는 Reviewer에게 assign된 상태다. Developer에게 남아 있으면 안 된다.
- `blocked`는 구체적 blocker comment가 있고 CTO 또는 사용자 조치가 필요한 상태다.
- `done`은 review, merge 또는 승인된 non-code 산출물, 필요한 KG 기록이 끝난 상태다.
- status만 바꾸는 핸드오프는 invalid다.
- assignee만 바꾸는 핸드오프는 invalid다.
- 모든 핸드오프 comment는 다음 역할과 이유를 명시해야 한다.

이 규칙은 status만 `in_review`로 바뀌고 assignee가 구현 에이전트에 남는 실패 모드를 막기 위한 것이다.

## CTO 규칙

CTO는 queue owner다. 구현자가 아니다.

CTO가 할 수 있는 일:

- `backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done` 큐 조회
- 다음 ready backlog 선정
- 역할 라우팅
- blocked 이슈 에스컬레이션
- status/assignee 일관성 확인
- freeze된 backlog를 재개할 수 있는지 판단

CTO가 하면 안 되는 일:

- 코드 구현
- Architect 티켓으로 분리해야 하는 구조 문서를 직접 재작성
- KG Recorder가 생긴 뒤 routine KG 기록 직접 수행
- Operator가 생긴 뒤 heartbeat cleanup 직접 수행
- 자신이 라우팅한 결과를 Reviewer처럼 자체 승인

backlog 하나를 CTO에게 assign하면 전체 queue sweep이 트리거되어야 한다. CTO는 프로젝트의 모든 ready backlog를 확인하고, 안전하게 라우팅할 수 있는 항목이 없을 때 멈춘다.

## Architect 규칙

Architect는 구조, contract, 분해를 담당한다.

Architect가 처리하는 일:

- `codex-plugin-cc` 같은 reference research
- provider architecture와 contract 설계
- PR 분할 설계
- phase input/output contract
- risk/dependency mapping
- 구현 phase용 ticket description 작성

Architect는 일반 구현을 하지 않는다. 코드 변경이 필요하면 구현 티켓을 만들거나 갱신한 뒤 CTO에게 돌려보낸다.

## Developer 규칙

Developer는 일반 구현을 담당한다.

Developer가 해야 하는 일:

- issue description과 모든 comment 읽기
- 관련 KG와 선례 확인
- 지정된 scope 안에서 작업
- focused test 실행
- PR 생성 또는 갱신
- 준비되면 `in_review`로 변경하고 Reviewer assign

Developer가 하면 안 되는 일:

- 큐 정책 변경
- 에이전트 운영 지침 변경
- 자기 구현 자체 승인
- CTO 또는 Architect 라우팅 없이 provider architecture로 scope 확장

## Reviewer 규칙

Reviewer는 일반 quality gate를 담당한다.

Reviewer가 확인하는 것:

- issue 완료 기준
- PR diff와 blast radius
- 테스트 또는 명시된 test gap
- contract compatibility
- 필요한 KG/docs 갱신 여부
- 올바른 역할이 작업했는지 여부

Reviewer는 실패한 작업을 구체적 findings와 함께 Developer에게 돌려보낸다. 3회 이상 반려되면 `blocked`로 바꾸고 CTO에게 라우팅한다.

## KG Recorder 규칙

KG Recorder는 knowledge record를 담당한다.

KG Recorder가 작성하는 것:

- `kg/issues/<BUI-ID>.md`
- 구현 선택이 설계와 다르거나 지속 정책을 만들 때 `kg/decisions/<slug>.md`
- 워크플로우 자체가 바뀔 때 `kg/workflows/*.md`
- live agent behavior가 바뀔 때 `kg/agents/*.md`

Phase 1 commit policy:

- 이미 완료된 이슈를 기록하는 KG-only 변경은 `main`에 직접 커밋할 수 있다.
- 운영 정책, workflow, schema, provider architecture를 바꾸는 KG 변경은 Architect 또는 Reviewer 확인 후 커밋한다.
- secrets, access token, raw private environment 값은 절대 기록하지 않는다.

이 정책은 현재 direct KG commit 흐름을 유지하되, 그 책임을 CTO에서 분리한다.

## Operator 규칙

Operator는 operational hygiene을 담당한다.

Operator가 처리하는 것:

- heartbeat 결과
- stuck issue 감지
- zombie 또는 stale task 감지
- orphan worktree cleanup 권고
- autopilot-created operational issue triage
- backlog count와 freeze-window health report

Operator는 product priority나 architecture priority를 정하지 않는다. 운영 이슈가 구현이나 설계를 요구하면 evidence와 함께 CTO에게 라우팅한다.

Autopilot issue policy:

- 순수 heartbeat/status report 이슈는 Operator가 처리한다.
- Daily 또는 weekly KG report가 기록을 요구하면 KG Recorder에게 라우팅한다.
- architecture drift는 Architect에게 라우팅한다.
- implementation defect는 CTO에게 evidence와 함께 전달하고 일반 backlog routing을 따른다.

## 고급모델 규칙

`고급모델`은 queue owner가 아니라 고복잡도 capability lane이다.

사용 조건:

- 작업의 reasoning 또는 generation complexity가 높다.
- 입력 계약이 명확하다.
- 결과를 다른 model/runtime이 검토할 수 있다.
- 비용과 latency가 task risk 대비 정당하다.

사용하지 않을 조건:

- 단순 backlog routing
- 넓은 repo reading이 주이고 bounded prompt가 없는 작업
- 자신이 구현한 결과를 직접 최종 리뷰하는 경우
- live instruction이 아직 CTO-style backlog drain을 설명하는 경우

실제 이슈를 `고급모델`에 assign하기 전에는 instruction을 v2 high-complexity role로 바꾸거나, 해당 issue comment에서 기존 역할을 명확히 override해야 한다.

## Provider Migration 정렬

현재 provider migration 계획은 유효하지만, v2 운영모델에 의존한다.

1. PR 0a: `codex-plugin-cc` reference research.
2. PR 0b: dependency, vendor, reimplementation 전략 결정.
3. PR 1a: file contract와 provider event contract.
4. PR 1b: provider config, sandbox policy, review gate non-coupling.
5. PR 1c: `plan_synthesis` input contract.
6. PR 2: current behavior contract test와 Claude provider 추출.
7. PR 3: provider config parser와 fake Codex provider.
8. PR 4: fake provider E2E 조합 테스트.
9. PR 5a: real Codex provider for `plan_synthesis`.
10. PR 5b: real Codex provider for `do`.
11. PR 6: KG와 Multica 문서 갱신.

PR 0a는 v2 운영모델이 최소한 Architect와 Reviewer를 식별할 수 있을 만큼 확정된 뒤 시작한다.

## 현재 Freeze된 Backlog

다음 backlog는 v2 운영모델과 provider contract에 의존하므로 freeze했다.

- BUI-92
- BUI-93
- BUI-94
- BUI-95
- BUI-96
- BUI-97
- BUI-98
- BUI-99
- BUI-100

이 이슈들은 v2 rollout issue가 승인될 때까지 `blocked`와 unassigned 상태를 유지한다. 재개할 때는 이 문서를 기준으로 description과 완료 기준을 다시 점검한다.

## 전환 계획

1. 신규 backlog drain을 freeze한다.
2. 기존 `in_progress`와 `in_review` 이슈는 v1 규칙으로 끝내거나, comment로 명시적으로 v2 migration한다.
3. v2 docs와 role instruction draft를 추가한다.
4. v1 agent profile을 보존한다.
5. CTO를 제외한 Phase 1 agent를 만들거나 갱신한다.
6. 작은 E2E 테스트 이슈 1개를 v2로 통과시킨다: backlog drain, assign, implementation, review, KG record, done.
7. CTO를 마지막에 갱신한다.
8. ready backlog를 unfreeze하고 v2로 라우팅한다.

CTO는 queue entry point이므로 마지막에 바꾼다. CTO instruction이 잘못되면 전체 backlog drain loop가 멈추거나 잘못 라우팅될 수 있다.

## 준비 완료 체크리스트

- `docs/operations/agent-operating-model-v2.md`가 존재한다.
- Phase 1 역할에 대한 `docs/operations/agents-v2/*.md`가 존재한다.
- v1 profile이 `docs/operations/agents-v1/` 아래에 보존되어 있다.
- freeze window가 문서화되어 있다.
- KG Recorder commit policy가 문서화되어 있다.
- Operator autopilot issue routing이 문서화되어 있다.
- `고급모델`이 CTO 대체가 아니라 capability lane으로 문서화되어 있다.
- PR 0a가 v2 운영모델에 의존한다는 점이 문서화되어 있다.
- 테스트 이슈 1개가 status/assignee drift 없이 v2를 통과할 수 있다.

