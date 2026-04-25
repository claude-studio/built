---
id: ADR-10
title: provider 문서 표현 경계
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-120
tags: [documentation, provider, runtime, contracts]
---

## 컨텍스트

provider 전환으로 built는 Claude 외 provider를 phase별로 선택할 수 있게 되었다.
하지만 사용자 문서에 Claude 전용 표현이 남아 있으면 Codex opt-in 경로와 provider-neutral 산출물 계약이 드러나지 않는다.

또한 Multica에서 Builder, Reviewer, Recorder 같은 agent runtime으로 운영되는 것과
built 내부에서 Claude/Codex provider를 선택하는 것은 서로 다른 축이다.
두 개념이 섞이면 사용자와 운영자가 설정 책임과 실행 책임을 잘못 이해할 수 있다.

## 결정

사용자-facing 문서와 운영 문서에서는 provider 실행 주체를 "provider 서브프로세스"로 표현한다.
현재 기본값을 설명해야 할 때는 "기본값: Claude"라고 쓰고,
Codex 경로는 phase별 provider 설정으로 명시 opt-in하는 선택지라고 적는다.

built provider와 Multica agent runtime은 별도 축으로 설명한다.
Multica agent role은 협업/운영 흐름의 역할이고, built provider는 feature phase 실행에 쓰는 로컬 subprocess 선택이다.

provider가 달라도 결과 파일 계약은 provider-neutral 계약으로 유지한다.
`progress.json`, `logs`, `do-result.md`, `check-result.md`, `report.md` 같은 사용자-facing 산출물은 provider 문서가 아니라 runner/writer와 `docs/contracts/provider-events.md` 계약을 기준으로 설명한다.

## 근거

- `docs/contracts/provider-config.md`는 provider 설정이 없을 때 Claude 기본값으로 기존 동작을 유지하도록 정한다.
- Codex는 인증, app-server, sandbox 조건이 있어 phase별 opt-in 경로로 안내해야 한다.
- Multica agent runtime과 built provider 선택을 분리해야 운영 역할 변경이 provider 변경으로 오해되지 않는다.
- 산출물 계약을 provider별로 설명하면 Claude/Codex 간 파일 구조 drift가 생길 위험이 커진다.

## 결과

- README와 BUILT-DESIGN은 Claude 전용 문구 대신 provider 중립 표현을 사용한다.
- Claude 기본값과 Codex opt-in을 함께 설명해 기존 사용자와 실험 사용자의 기대를 모두 유지한다.
- provider 변경에도 동일한 결과 파일 계약을 유지한다는 메시지가 사용자 문서에 드러난다.
- smoke 정책은 기본 fake/offline 테스트와 실제 provider smoke opt-in 분리를 기준으로 설명한다.
- usage/cost 정보는 provider별로 없을 수 있으므로 optional contract로 유지한다.

## 대안

- 모든 문서에서 Claude를 완전히 숨긴다: 현재 기본값과 하위 호환 정책이 보이지 않아 선택하지 않았다.
- Claude 문서를 유지하고 Codex 문서를 별도로 둔다: provider-neutral 산출물 계약과 phase별 설정 설명이 중복되어 drift 위험이 커 선택하지 않았다.
- Multica agent runtime을 provider 선택 예시로 설명한다: 운영 runtime과 built 실행 provider의 책임 경계를 흐려 선택하지 않았다.

## 되돌릴 조건

phase별 기본 provider가 Claude에서 다른 provider로 공식 변경되면 기본값 표현은 새 정책에 맞춰 갱신한다.
그 경우에도 built provider와 Multica agent runtime을 별도 축으로 설명하는 원칙과 provider-neutral 산출물 계약은 유지한다.
