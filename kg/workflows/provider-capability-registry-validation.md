---
id: WF-15
title: Provider Capability Registry Validation
type: workflow
date: 2026-04-26
validated_by: [BUI-173]
tags: [provider, capability, registry, validation, regression]
---

## 패턴 설명

provider 지원 범위나 sandbox 정책을 바꿀 때는 `src/providers/capabilities.js`를 먼저 갱신하고, config parser와 문서/doctor가 같은 capability 정보를 참조하는지 검증한다.
registry는 provider 정책의 SSOT이고, adapter는 실제 실행을 담당한다.

## 언제 사용하나

- 새 provider를 추가할 때
- provider별 지원 phase를 늘리거나 줄일 때
- `do`, `iter`, `check`, `report`, `plan_synthesis`의 sandbox 정책을 바꿀 때
- outputSchema 지원 여부, app-server 필요 여부, 기본 timeout을 문서나 doctor에 노출할 때
- provider-config 계약과 parser 검증 사이의 drift가 의심될 때

## 단계

1. `docs/contracts/provider-config.md`와 `docs/contracts/provider-events.md`에서 현재 provider 계약을 확인한다.
2. `src/providers/capabilities.js`에 provider capability를 등록하거나 수정한다.
3. provider 이름, 지원 phase, app-server 필요 여부, outputSchema 지원 여부, 기본 timeout, 기본 sandbox, write phase sandbox를 모두 명시한다.
4. `src/providers/config.js`가 provider 목록과 sandbox 검증을 registry에서 파생하는지 확인한다.
5. `test/providers-capabilities.test.js`에 Claude/Codex 또는 새 provider의 phase 조합과 sandbox 조합을 추가한다.
6. write phase인 `do`, `iter`와 read-only phase인 `check`, `report`, `plan_synthesis`를 분리해 테스트한다.
7. 알 수 없는 provider 오류가 한글 사용자 조치 중심 메시지이며 registry 등록 위치를 안내하는지 확인한다.
8. 기본 테스트에는 real provider smoke를 섞지 않는다.
   capability 검증은 외부 provider 실행 없이 pure function 테스트로 끝낸다.
9. 문서나 doctor가 capability 표를 제공한다면 registry를 기준으로 파생되었거나 동기화 테스트가 있는지 확인한다.

## 주의사항

- `config.js`, doctor, 문서에 provider 목록을 수기로 다시 만들지 않는다.
- Claude에 Codex sandbox 정책을 적용하지 않는다.
  Claude는 현재 sandbox 개념이 없는 provider로 모델링된다.
- Codex `do`/`iter`에서 `read-only`를 허용하지 않는다.
  파일 변경 phase는 parser 단계에서 `workspace-write` 요구를 빠르게 알려야 한다.
- capability registry는 provider subprocess를 실행하거나 산출물 파일을 쓰지 않는다.
- 기본 provider 변경은 별도 decision으로 다룬다.
  capability registry 추가만으로 Claude 기본값을 Codex로 바꾸지 않는다.
