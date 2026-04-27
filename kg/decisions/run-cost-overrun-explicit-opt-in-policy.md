---
id: ADR-36
title: Run 비용 초과 자동화는 명시 opt-in으로만 계속 실행한다
type: decision
date: 2026-04-27
status: accepted
context_issue: BUI-348
supports_goal: [GOAL-1]
tags: [run, cost, automation, dogfooding, safety]
---

## 컨텍스트

`scripts/run.js`는 Run 시작 전 canonical `progress.json`의 누적 `cost_usd`가 임계값을 초과하면 사용자 확인을 요청한다.
그러나 Claude/Bash, CI, agent dogfooding처럼 stdin이 닫힌 비대화형 환경에서는 확인 prompt가 기본값 `N`으로 처리되어 pipeline이 시작되지 않는다.

이 동작은 비용 안전장치로는 맞지만, 자동화 환경에서는 사용자가 명시적으로 거부하지 않았는데도 조용히 중단된 것처럼 보일 수 있다.

## 결정

비용 guard 초과 상태에서 비대화형 Run을 계속하려면 CLI 플래그 `--allow-cost-overrun`을 명시해야 한다.
기본 자동 승인은 하지 않는다.

반복 자동화 정책 자체를 바꿔야 하면 feature별 `.built/runtime/runs/<feature>/run-request.json`의 `max_cost_usd` 또는 전역 `.built/config.json`의 `default_max_cost_usd`를 조정한다.
`--allow-cost-overrun`은 `run-request.json` 필드가 아니라 실행 시점의 명시 승인 플래그로 유지한다.

## 근거

- 비용 guard는 원치 않는 누적 비용 증가를 막는 안전장치이므로 noninteractive라는 이유만으로 자동 승인하면 안 된다.
- CLI 플래그는 일회성 override 의도가 명령 기록에 남아 dogfooding, CI, agent 실행에서 감사 가능하다.
- 임계값 필드와 override 플래그를 분리하면 지속 정책과 단발성 승인을 구분할 수 있다.
- `run-request.json`은 run contract snapshot이며, 비용 초과를 승인했다는 현재 실행자의 의사까지 저장하면 contract와 operator action의 경계가 흐려진다.

## 결과

- stdin closed 환경에서 비용 threshold를 넘으면 Run은 계속 중단되지만, 원인과 해결 방법을 출력한다.
- 자동화가 의도적으로 계속해야 하는 경우 `node scripts/run.js <feature> --allow-cost-overrun`으로 재실행할 수 있다.
- 반복적으로 같은 feature가 중단되면 `max_cost_usd` 또는 `default_max_cost_usd`를 조정하는 운영 판단으로 처리한다.
- provider 인증, sandbox, phase 실패는 이 플래그로 우회되지 않는다.

## 대안

- noninteractive 환경에서는 자동 승인한다: CI/dogfooding 편의는 높지만 비용 guard의 기본 안전성을 깨므로 선택하지 않았다.
- `run-request.json`에 `allow_cost_overrun`을 저장한다: feature별 반복 실행에는 편하지만 단발성 operator 승인과 durable run contract가 섞여 선택하지 않았다.
- threshold 초과 시 dry-run으로 자동 전환한다: 실제 사용자가 요청한 Run과 다른 동작을 하므로 중단 원인을 더 혼란스럽게 만들 수 있어 선택하지 않았다.

## 되돌릴 조건

조직 또는 workspace 단위의 별도 비용 승인 정책이 생기고, 해당 정책이 run-request contract와 감사 로그에 명확히 반영될 때 재검토할 수 있다.
그 경우에도 기본값은 안전한 중단이어야 하며, 자동 승인은 명시된 정책 범위 안에서만 허용해야 한다.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Decision",
  "identifier": "ADR-36",
  "name": "Run 비용 초과 자동화는 명시 opt-in으로만 계속 실행한다",
  "about": "noninteractive Run cost guard overrun policy",
  "isBasedOn": "BUI-348"
}
```
