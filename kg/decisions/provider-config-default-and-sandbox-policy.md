---
id: ADR-4
title: provider 설정 기본값과 sandbox 정책
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-115
tags: [architecture, provider, config, sandbox]
---

## 컨텍스트

provider 전환 로드맵에서는 phase별로 Claude/Codex provider를 선택할 수 있어야 한다.
하지만 기존 요청 파일에는 `providers` 필드가 없고, 현재 실행 동작은 Claude provider를 전제로 한다.

또한 `do`, `iter` phase는 산출물 생성과 수정 작업을 포함할 수 있으므로,
쓰기 권한이 없는 sandbox에서 새 provider를 실행하면 실패 원인이 늦게 드러나거나 잘못된 성공으로 보일 수 있다.

## 결정

`providers` 설정이 없거나 특정 phase 설정이 없으면 기본 provider는 `{ name: "claude" }`로 둔다.

`do`, `iter` phase에서 `claude` 외 provider를 사용하는 경우 `sandbox`는 `workspace-write`여야 한다.
`read-only` 또는 허용되지 않은 sandbox 값은 parser 단계에서 명확한 오류로 실패시킨다.

`check`, `report`, `plan_synthesis` phase는 현재 정책상 `read-only` sandbox를 허용한다.

## 근거

- 기존 요청 파일과 기존 Claude 기반 실행을 변경 없이 유지할 수 있다.
- provider 전환을 점진적으로 진행하면서 phase별 opt-in 구성을 지원할 수 있다.
- 쓰기 phase에서 권한 부족을 늦게 발견하면 실패 원인과 책임 경계가 흐려진다.
- sandbox 정책을 parser 단위 테스트로 고정하면 실제 Codex adapter가 붙기 전에도 설정 회귀를 잡을 수 있다.

## 결과

- `parseProviderConfig`는 단축형 문자열과 상세형 객체를 모두 정규화한다.
- `getProviderForPhase`는 미설정 phase에 대해 `{ name: "claude" }`를 반환한다.
- 잘못된 provider 이름, 알 수 없는 필드, 잘못된 sandbox 값은 즉시 실패한다.
- `do`, `iter`에서 `claude` 외 provider와 `read-only` sandbox 조합은 허용하지 않는다.

## 대안

- 기본 provider를 phase별로 다르게 둔다: 초기 전환 단계에서 기존 동작이 바뀔 위험이 커서 선택하지 않았다.
- `providers`가 없으면 오류로 처리한다: 기존 요청 파일 하위 호환을 깨므로 선택하지 않았다.
- sandbox 오류를 실제 provider 실행 시점까지 미룬다: 실패가 늦어지고 사용자에게 보이는 원인이 불명확해져 선택하지 않았다.

## 되돌릴 조건

Codex adapter와 fake provider E2E가 안정화된 뒤 phase별 기본 provider를 바꾸는 별도 정책이 승인되면 재검토한다.
그 경우에도 기존 요청 파일 하위 호환과 쓰기 phase sandbox 실패 메시지는 별도 테스트로 유지해야 한다.
