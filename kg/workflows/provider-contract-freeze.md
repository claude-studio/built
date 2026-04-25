---
id: WF-3
title: Provider Contract Freeze
type: workflow
date: 2026-04-26
validated_by: [BUI-114]
tags: [provider, contract-test, regression]
---

## 패턴 설명

provider 전환처럼 실행 주체를 바꾸는 작업에서는 먼저 사용자-facing 산출물 계약을 테스트로 고정하고,
그 다음 provider와 runner 책임을 분리한다.

## 언제 사용하나

- Claude provider 외에 Codex provider 등 새 provider를 추가할 때
- provider 설정 parser, 이벤트 정규화, runner lifecycle을 바꿀 때
- `state.json`, `progress.json`, `do-result.md`, `check-result.md`, `report.md` 구조에 영향이 있을 수 있는 변경을 할 때

## 단계

1. 관련 계약 문서 확인: `docs/contracts/file-contracts.md`, `docs/contracts/provider-events.md`, `docs/contracts/provider-config.md`.
2. 현재 동작을 contract/snapshot 테스트로 고정한다.
3. provider는 이벤트 전달, runner/writer는 파일 normalize/write 책임을 갖도록 경계를 유지한다.
4. 기존 pipeline 테스트와 신규 provider 단위 테스트를 함께 실행한다.
5. 리뷰에서 산출물 위치, CLI 호출 방식, 진행 상태 기록이 외부 동작 불변인지 확인한다.
6. KG에는 issue record와 provider architecture decision을 분리해 남긴다.

## 주의사항

- provider 파일에서 `state.json`, `progress.json`, markdown 결과 파일을 직접 쓰지 않는다.
- `pipeline-runner.js`에 provider별 `spawn` 로직을 재도입하지 않는다.
- stream-json 경로와 json-schema 경로가 같은 provider 경계를 따르는지 확인한다.
- 테스트 mock이 provider 모듈 이동 후에도 의도대로 적용되는지 확인한다.
