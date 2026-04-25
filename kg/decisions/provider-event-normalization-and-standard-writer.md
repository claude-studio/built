---
id: ADR-5
title: provider event normalize와 standard writer 계약
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-116
tags: [architecture, provider, events, writer, contracts]
---

## 컨텍스트

provider 전환 과정에서 Claude stream-json과 Codex app-server notification은 raw event 형식이 다를 수밖에 없다.
하지만 built 사용자에게 보이는 산출물은 provider와 무관하게 같은 파일 경로와 필수 구조를 유지해야 한다.

BUI-114에서 provider와 runner의 산출물 책임 경계를 분리했고, BUI-115에서 phase별 provider 설정 parser와 sandbox 정책을 고정했다.
BUI-116에서는 실제 Codex 호출 전에도 provider별 이벤트 차이와 파일 계약 차이를 오프라인으로 검증할 방법이 필요했다.

## 결정

provider별 raw event는 표준 provider event로 normalize한 뒤 writer에 전달한다.
표준 이벤트 타입은 `phase_start`, `text_delta`, `tool_call`, `tool_result`, `usage`, `phase_end`, `error`로 둔다.

비용과 토큰 정보는 별도 `cost` 이벤트가 아니라 optional `usage` 이벤트 안의 `cost_usd`, `input_tokens`, `output_tokens`로 표현한다.

provider가 달라도 파일 기록은 `standard-writer`가 담당한다.
writer는 `.built/features/<feature>/progress.json`과 phase result markdown의 필수 위치와 필드를 provider 무관 계약으로 유지한다.

Codex는 실제 adapter가 붙기 전까지 표준 이벤트를 직접 emit한다는 가정으로 passthrough normalize를 사용한다.

## 근거

- raw event를 writer에 직접 연결하면 provider별 파일 쓰기와 상태 표현이 갈라질 위험이 크다.
- `usage`는 비용뿐 아니라 토큰 정보도 포함하므로 `cost`보다 contract 의미가 정확하다.
- terminal event 이후 추가 이벤트를 금지해야 `progress.json`과 result markdown의 최종 상태가 뒤집히지 않는다.
- fake provider E2E는 실제 Codex app-server 없이도 CI에서 file contract regression을 검증할 수 있다.
- Codex passthrough는 임시 전환 가정이며 실제 notification shape가 확정되면 adapter mapping만 교체할 수 있다.

## 결과

- Claude raw event는 `system/init`, `assistant`, `tool_result`, `result`에서 표준 이벤트 배열로 변환된다.
- Codex raw event는 허용된 표준 이벤트 타입이면 timestamp를 보완해 그대로 전달된다.
- `tool_call`과 `tool_result`는 같은 id pairing을 검증할 수 있다.
- `phase_end`와 `error`는 terminal event로 취급되고, terminal 이후 추가 이벤트는 ordering violation으로 검출된다.
- fake Claude/fake Codex E2E가 같은 입력에서 `progress.json`과 `do-result.md` 필수 구조 동일성을 검증한다.

## 대안

- provider별 writer를 둔다: 파일 위치와 필드 계약이 provider마다 중복 구현되어 drift 가능성이 커서 선택하지 않았다.
- `cost`를 별도 표준 이벤트로 둔다: 토큰과 비용을 같은 관찰 metric으로 다루는 계약 문서와 맞지 않아 선택하지 않았다.
- 실제 Codex adapter가 완성될 때까지 E2E를 미룬다: provider 전환 초기에 file contract regression을 잡을 수 없어 선택하지 않았다.

## 되돌릴 조건

실제 Codex app-server가 표준 이벤트 passthrough와 다른 notification contract를 제공하면 `normalizeCodex` 매핑을 교체한다.
이 경우에도 writer 입력은 표준 이벤트로 유지하고, fake provider E2E는 새 매핑 fixture로 갱신해야 한다.
