---
id: DEC-provider-readme-final-onboarding-boundary
title: provider 전환 완료 후 README onboarding 경계
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-139
tags: [documentation, provider, onboarding, troubleshooting]
---

## 컨텍스트

provider 전환 관련 backlog가 연속으로 완료되면서 구현 결과가 README, `docs/contracts/`, `docs/ops/`, KG에 흩어졌다.
최종 사용자-facing README가 오래된 roadmap 표현이나 Claude 전용 전제를 유지하면 실제 제품 방향과 다르게 보일 수 있다.

README는 새 사용자가 가장 먼저 읽는 문서이므로, 내부 계획 전문을 옮겨 적는 문서가 아니라 현재 안정된 실행 계약과 문제 해결 경로를 안내하는 진입점이어야 한다.

## 결정

provider 전환 완료 후 README는 사용자 onboarding의 최종 진입점으로 둔다.
세부 계약 전문은 `docs/contracts/`와 `docs/ops/`에 유지하고, README에는 아래 판단에 필요한 사용자-facing 정보만 둔다.

- Claude 기본 실행과 Codex phase별 opt-in 실행의 차이
- `run-request.json`의 `providers` 위치와 phase별 예시
- `plan_synthesis` opt-in phase의 존재와 활성화 방법
- Codex smoke 테스트와 fake/offline 테스트의 분리
- provider failure taxonomy 기반 troubleshooting
- worktree/branch cleanup, hooks, usage/cost optional telemetry의 현재 상태
- built provider와 Multica agent runtime이 별개 축이라는 설명

README에는 내부 roadmap, 미완료 계획, 예상 위치, MVP 후순위 같은 표현을 남기지 않는다.
현재 사용 가능한 기능은 현재형으로 설명하고, 아직 안정된 사용자 계약이 아닌 내용은 README보다 backlog 또는 내부 운영 문서에 둔다.

## 근거

- README가 contract 전문을 반복하면 `docs/contracts/`와 drift가 생긴다.
  README는 링크와 실행 예시 중심이어야 갱신 비용이 낮다.
- failure taxonomy는 사용자가 실패를 분류하고 다음 조치를 찾는 데 필요하므로 README troubleshooting에 노출할 가치가 있다.
  단, raw provider stderr나 debug detail은 사용자-facing README에 적지 않는다.
- `plan_synthesis`는 opt-in이지만 provider 비교와 Codex smoke 흐름에서 중요한 phase다.
  pipeline overview에 명시해야 사용자가 phase activation과 provider 선택을 혼동하지 않는다.
- built provider와 Multica agent runtime은 책임 축이 다르다.
  README에서 분리해 설명해야 Multica 역할 배정이 built provider 설정을 바꾼다는 오해를 줄일 수 있다.
- usage/cost는 optional telemetry이므로 실행 메타와 같은 필수 계약처럼 설명하면 provider별 누락을 장애로 오해할 수 있다.

## 결과

- README는 완료된 provider 전환 backlog의 사용자-facing 요약과 실행 진입점이 되었다.
- Claude 기본값과 Codex opt-in은 같은 README 안에서 비교 가능하지만, provider-neutral 산출물 계약은 유지된다.
- smoke 실행, sandbox/timeout, failure kind별 조치, worktree cleanup 문서를 README에서 찾을 수 있다.
- 내부 roadmap과 미완료 계획 문구가 제거되어 README가 현재 구현 상태를 기준으로 읽힌다.
- 더 깊은 계약 확인은 README에서 `docs/contracts/`와 `docs/ops/`로 이동하는 구조가 되었다.

## 대안

- README에 모든 contract 전문을 복사한다: 중복과 drift 위험이 커 선택하지 않았다.
- provider 상세 설명을 별도 ops 문서에만 둔다: 새 사용자가 README만 보고 Codex opt-in과 smoke 실행을 찾기 어려워 선택하지 않았다.
- failure taxonomy를 내부 문서에만 둔다: 사용자가 실패 메시지에서 다음 조치를 찾기 어려워 선택하지 않았다.
- roadmap과 예정 기능을 README에 남긴다: 사용자-facing 문서가 현재 동작과 계획을 혼합하게 되어 선택하지 않았다.

## 되돌릴 조건

provider 설정 위치가 `run-request.json`에서 다른 사용자-facing config로 공식 이동하면 README onboarding 경계를 새 위치 기준으로 갱신한다.
phase별 기본 provider가 Claude에서 다른 provider로 바뀌면 기본값 설명은 새 정책에 맞춰 바꾼다.
그 경우에도 README는 현재 안정된 사용자 계약의 진입점으로 두고, 세부 contract 전문은 별도 문서에 유지한다.
