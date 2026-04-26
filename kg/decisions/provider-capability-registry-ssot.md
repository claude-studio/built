---
id: ADR-18
title: provider capability registry SSOT
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-173
tags: [architecture, provider, capability, registry, sandbox]
---

## 컨텍스트

provider 전환이 진행되면서 phase 지원 범위, sandbox 정책, outputSchema 지원, app-server 필요 여부가 여러 위치에 흩어질 위험이 커졌다.
`docs/contracts/provider-config.md`는 정책을 설명하고, `src/providers/config.js`는 parser 검증을 수행하며, 각 provider adapter는 실행 특성을 암묵적으로 가진다.

새 provider가 추가될 때 이 정보가 중복 정의되면 config parser, doctor, 문서가 서로 다른 정책을 말할 수 있다.
특히 Codex는 phase별 sandbox 요구가 다르므로 drift가 생기면 사용자는 실행 시점에 늦은 실패를 보게 된다.

## 결정

`src/providers/capabilities.js`를 provider capability의 SSOT로 둔다.

registry는 provider별로 다음 정보를 가진다.

- 지원 phase 목록
- app-server 필요 여부
- outputSchema 지원 여부
- 기본 timeout
- 기본 sandbox
- write phase에서 요구하는 sandbox

config parser는 provider 목록과 sandbox 검증을 registry에서 파생한다.
doctor와 문서가 provider capability를 다룰 때도 같은 registry를 기준으로 삼는다.

## 근거

- provider 지원 범위와 sandbox 정책을 한 모듈에서 조회하면 parser, doctor, 문서 사이의 drift를 줄일 수 있다.
- Codex의 `read-only` 기본값과 `do`/`iter`의 `workspace-write` 요구를 같은 데이터 구조에 두면 phase별 예외가 명확해진다.
- Claude의 sandbox 없음과 Codex의 app-server 필요 여부를 같은 capability 모델에서 표현하면 provider별 차이를 adapter 내부 암묵 지식으로 숨기지 않아도 된다.
- 기본 provider 변경 없이 registry만 추가하므로 기존 Claude 기반 요청 파일의 하위 호환성을 유지한다.
- pure function 단위 테스트로 capability와 parser 정책을 고정할 수 있어 real provider smoke와 기본 테스트의 경계를 유지한다.

## 결과

- `VALID_PROVIDERS`와 sandbox 검증은 capability registry에서 파생된다.
- 알 수 없는 provider 오류는 registry 등록 위치를 안내한다.
- Codex `check`, `report`, `plan_synthesis`는 `read-only` sandbox를 허용하고, `do`, `iter`는 `workspace-write`를 요구한다.
- Claude는 sandbox 개념이 없는 provider로 유지된다.
- 새 provider 추가 시 첫 작업 단위는 adapter 구현이 아니라 capability 등록과 그에 대한 parser/test 갱신이다.

## 대안

- `config.js`에 provider 목록과 sandbox 정책을 계속 둔다.
  parser 중심 구현은 빠르지만 doctor와 문서가 같은 정책을 재사용하기 어렵고, adapter 특성이 계속 암묵 지식으로 남는다.
- 각 provider adapter가 capability를 직접 export한다.
  provider별 소유권은 분명하지만 전체 지원 matrix와 parser 검증을 만들 때 adapter import 순환과 실행 의존성이 생길 수 있어 선택하지 않았다.
- capability 정보를 문서에만 두고 구현이 문서를 따르게 한다.
  문서는 사람이 읽기에는 좋지만 테스트 가능한 SSOT가 아니므로 parser 회귀를 막기 어렵다.

## 되돌릴 조건

provider 수가 늘어나 capability 모델이 provider별 adapter 초기화와 강하게 결합되어야 한다는 운영 증거가 쌓이면 adapter export 방식으로 재검토한다.
그 경우에도 parser, doctor, 문서가 같은 source에서 provider 목록과 sandbox 정책을 파생해야 한다는 원칙은 유지한다.
