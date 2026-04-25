---
id: ADR-7
title: plan_synthesis 계약과 opt-in Codex smoke
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-118
tags: [architecture, provider, plan_synthesis, codex, contracts]
---

## 컨텍스트

built는 사용자와의 interactive discovery를 host가 수행하고, 그 결과를 provider가 구현 계획으로 구조화하는 phase가 필요하다.
이 phase는 이후 `do` phase가 참조할 수 있어야 하며, Claude와 Codex provider가 같은 입력과 산출물 계약을 공유해야 한다.

동시에 실제 Codex 호출은 인증, app-server, 로컬 runtime 상태에 의존한다.
따라서 provider 전환 과정에서 기본 테스트 안정성을 유지하면서도 실제 Codex `plan_synthesis` 경로를 수동 검증할 방법이 필요했다.

## 결정

`plan_synthesis`는 opt-in read-only phase로 추가한다.
`run-request.json`의 `plan_synthesis: true` 또는 `providers.plan_synthesis` 설정이 있을 때만 `do` 앞에서 실행한다.

입력 payload는 `docs/contracts/plan-synthesis-input.md`를 기준으로 `feature_spec`, `questions`, `answers`, `repo_context`, `acceptance_criteria`, `constraints`를 포함하고, 구현에서는 추적성을 위해 `feature_id`, `feature_spec_path`, `prior_art`도 함께 둔다.

산출물은 provider와 무관하게 `.built/features/<feature>/plan-synthesis.json`과 `.built/features/<feature>/plan-synthesis.md`에 쓴다.
provider는 파일을 직접 쓰지 않고, runner/helper가 provider output을 `summary`, `steps`, `acceptance_criteria`, `risks`, `out_of_scope` 구조로 정규화해 기록한다.

`do` phase는 canonical `plan-synthesis.json`이 있을 때 `output`만 읽어 implementation plan으로 사용한다.

실제 Codex smoke는 `BUILT_CODEX_PLAN_SYNTHESIS_SMOKE=1 node scripts/smoke-codex-plan-synthesis.js`로만 실행한다.
기본 테스트는 fake provider와 file contract 검증으로 유지한다.

Codex adapter의 `phase_end` 이벤트는 최종 text를 `result`에 연결한다.
이는 `standard-writer`가 provider별 차이 없이 phase result를 기록하게 하기 위한 terminal event 계약이다.

## 근거

- `plan_synthesis`는 discovery와 implementation 사이의 계약이므로 provider별 prompt나 파일 구조가 갈라지면 `do` phase의 입력이 불안정해진다.
- opt-in activation은 기존 pipeline 사용자에게 새 phase 비용과 실패 모드를 강제로 부과하지 않는다.
- 실제 Codex smoke는 로컬 인증과 app-server 상태에 의존하므로 기본 CI 회귀 테스트로 적합하지 않다.
- fake provider/file contract 테스트는 산출물 구조 회귀를 빠르게 잡고, opt-in smoke는 실제 provider 연결만 별도로 확인한다.
- provider가 파일을 직접 쓰지 않아야 ADR-3의 provider/runner 책임 경계와 ADR-5의 standard writer 계약을 유지할 수 있다.
- `phase_end.result`가 terminal text를 포함해야 writer가 provider output을 일관된 markdown/result 산출물로 남길 수 있다.

## 결과

- legacy `run-request.json`은 기존 `do -> check -> iter -> report` 순서를 유지한다.
- `plan_synthesis`가 활성화되면 pipeline은 0번째 phase로 계획을 만들고, 이후 `do` phase가 그 계획을 참조한다.
- Codex는 낮은 위험의 read-only phase에서 실제 provider smoke를 먼저 검증할 수 있다.
- Claude와 Codex 모두 같은 canonical `plan-synthesis.json`/`plan-synthesis.md` 계약을 따른다.
- provider별 품질 비교나 `do` phase Codex 구현은 별도 후속 범위로 남는다.

## 대안

- `plan_synthesis`를 항상 실행한다: 기존 pipeline 동작과 비용, 실패 조건이 바뀌므로 선택하지 않았다.
- 실제 Codex smoke를 기본 테스트에 포함한다: 인증/환경 의존성 때문에 CI 안정성을 해칠 수 있어 선택하지 않았다.
- provider가 각자 plan 파일을 쓴다: 산출물 drift가 발생하고 runner/writer 책임 경계를 깨므로 선택하지 않았다.
- `do` phase prompt에 raw `plan-synthesis.json` 전체를 넣는다: provider/model/timestamp 같은 실행 메타가 구현 계획과 섞일 수 있어 선택하지 않았다.

## 되돌릴 조건

`plan_synthesis`가 제품 기본 flow로 확정되고 모든 지원 provider에서 안정적으로 동작하면 opt-in activation을 기본값으로 바꾸는 별도 결정이 필요하다.
실제 Codex smoke가 hermetic fixture나 안정적인 hosted test runtime으로 대체되면 기본 테스트 포함 여부를 재검토할 수 있다.
