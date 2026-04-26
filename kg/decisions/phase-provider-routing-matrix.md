---
id: ADR-11
title: phase별 provider routing matrix와 cross-provider review 정책
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-136
tags: [architecture, provider, routing, matrix, cross-review, high-risk]
---

## 컨텍스트

Codex provider가 연결된 뒤 어떤 phase에서 Claude/Codex를 기본 또는 opt-in으로 둘지 명확한 기준이 없었다.
특히 다음 세 가지가 불명확했다.

1. phase별 기본 provider와 opt-in 조건이 코드, 설정 문서, 사용자 문서에서 일관되게 표현되지 않았다.
2. 구현 provider(`do`)와 리뷰 provider(`check`)를 분리하는 패턴이 공식화되지 않았다.
3. 고위험 변경에서 built provider 선택과 Multica agent Specialist/Reviewer 역할 분기의 관계가 모호했다.

## 결정

### phase별 기본값

모든 phase의 기본 provider는 Claude다. 설정이 없으면 기존 동작이 그대로 유지된다.
Codex는 명시적 설정으로만 opt-in할 수 있다. 기본 pipeline(`do → check → iter → report`)은 변경되지 않는다.
`plan_synthesis`는 opt-in 전용 phase다. `run-request.json`에 `plan_synthesis: true` 또는 `providers.plan_synthesis` 설정이 있을 때만 활성화된다.

### do/iter sandbox 정책

`do`, `iter`에서 Claude 외 provider를 사용하면 `workspace-write` sandbox가 필수다.
`read-only` sandbox 조합은 parser 단계에서 즉시 오류로 처리한다. (ADR-4에서 확립)

### cross-provider review 원칙

구현 provider와 리뷰 provider를 달리 설정하는 것을 권장한다.
- Codex로 구현(`do`)하면 Claude로 리뷰(`check`).
- Claude로 구현하면 Codex로 리뷰 (opt-in 시).

이 패턴은 provider 고유 blind spot을 줄이고 check 결과의 독립성을 높인다.

### Multica agent runtime 분리

built provider 선택(`do`/`check`/`plan_synthesis` 등)과 Multica Specialist/Reviewer agent 역할 분기는 별개 축이다.
- built provider는 feature phase를 실행하는 로컬 subprocess 엔진이다.
- Multica Reviewer agent는 PR 코드를 이슈 시스템에서 검토하는 운영 역할이다.
- Multica Reviewer 승인이 built `check` phase를 자동 트리거하지 않는다.
- 이 두 축을 혼동하는 표현은 문서와 코멘트에서 쓰지 않는다.

## 근거

- 기본값을 모두 Claude로 유지해야 기존 사용자에게 변경 없는 동작을 보장한다(ADR-4 연속).
- cross-provider review는 추가 인프라 없이 `providers.check` 설정 하나로 활성화할 수 있다.
- plan_synthesis opt-in 원칙은 ADR-7에서 확립되었으며 이 결정은 그 내용을 routing matrix에 통합한 것이다.
- Multica agent runtime 분리를 명시적으로 문서화해야 운영 가이드에서 반복되는 혼동을 방지할 수 있다.

## 결과

- `docs/ops/provider-routing-matrix.md`가 phase별 matrix, 선택 기준, 설정 예시, 고위험 변경 지침의 단일 참조 문서가 된다.
- README와 BUILT-DESIGN은 provider 기본값과 Codex opt-in 원칙을 이미 반영하고 있으며(BUI-120 결과), routing matrix 문서를 별도 참조로 안내한다.
- `docs/contracts/provider-config.md`의 "provider 결과 품질 정책" 절과 "기본값" 절이 이 결정과 일관된다.
- BUI-166 구현으로 `iter`는 `providers.iter`가 없을 때 `providers.do`를 fallback으로 사용하고, 그마저 없을 때 Claude 기본값을 유지하는 실행 정책이 검증되었다.
  이는 `iter`가 `do`의 수정 루프라는 routing matrix 원칙을 코드 경로에 반영한 것이다.
- BUI-166 구현으로 `report`는 `providers.report`가 명시된 경우에만 provider를 override하고, 기본값은 Claude + 저비용 report 모델 흐름으로 유지한다.
  `report.md` frontmatter의 `provider`와 `model`은 실제 실행 providerSpec 기준 실행 메타로 기록된다.
- iter 내부 check 재실행은 별도 provider 상태를 복사하지 않고 `scripts/check.js` subprocess가 동일 `run-request.json`을 직접 읽는 방식으로 `providers.check` 설정을 유지한다.

## 대안

- phase별 기본 provider를 달리 설정한다(예: plan_synthesis=codex): 기존 동작이 바뀌고 Codex 인증 상태에 따라 기본 pipeline이 실패할 수 있어 선택하지 않았다.
- cross-provider review를 강제(기본값)로 설정한다: Codex 인증이 없는 환경에서 check phase가 실패하므로 선택하지 않았다.
- routing matrix를 README에 직접 포함한다: README가 길어지고 운영 정책과 사용자 문서가 섞여 유지보수가 어려워지므로 별도 ops 문서로 분리했다.

## 되돌릴 조건

Codex provider가 모든 phase에서 안정적으로 동작하고 기본 CI에 포함될 수 있는 수준이 되면
phase별 기본 provider를 재검토하는 별도 결정이 필요하다.
그 경우에도 cross-provider review 원칙과 Multica agent runtime 분리 원칙은 유지한다.
