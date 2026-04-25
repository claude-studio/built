---
id: GOAL-1
title: built의 북극성 목표
type: goal
date: 2026-04-24
status: active
horizon: long-term
tags: [north-star, pdca, automation, control-plane, provider-agnostic, contracts]
---

# built의 북극성 목표

## 목표 문장

사람이 feature의 의도와 제약, 그리고 원하는 실행 품질만 정하면, built가 안정적인 파일/이벤트 계약 위에서 Plan -> Do -> Check -> Act를 수행하고, 각 phase를 Claude, Codex 같은 교체 가능한 provider로 라우팅해 신뢰 가능한 완료 상태까지 밀어 올린다.

built는 특정 모델 CLI에 종속된 스크립트 묶음이 아니라, Claude Code 안에서 동작하는 provider-agnostic feature delivery control plane이어야 한다.

## 성공 판정 기준

- 사람은 Plan과 의도, 제약 정의에 집중하고 실행 흐름은 시스템이 맡는다.
- 상태, 결과물, 반복 수정, 실패 처리가 하나의 일관된 파일 계약 위에서 동작한다.
- 특정 feature의 현재 상태와 그 이유가 문서와 runtime에서 명확히 드러난다.
- `plan_synthesis`, `do`, `check`, `iter`, `report` 같은 phase가 provider 설정으로 전환 가능하다.
- provider가 달라도 `run-request.json`, `state.json`, `progress.json`, 결과 Markdown의 의미가 유지된다.
- Claude 전용 구현은 provider adapter 뒤로 격리되고, runner와 KG는 provider 세부 구현을 몰라도 된다.
- Codex 같은 고급 reasoning provider는 plan synthesis와 복잡한 do phase에 선택적으로 투입할 수 있다.
- usage/cost 추적은 관측 기능으로 남기되, core file/event contract의 필수 조건이 되지 않는다.

## 비가역 원칙

- 상태의 SSOT는 하나여야 한다.
- 문서층 KG와 runtime 상태층은 혼동하지 않는다.
- 자동화는 관측 가능성과 복구 가능성을 해치면 안 된다.
- 결과물보다 제어면 계약의 일관성을 우선한다.
- provider는 파일 계약을 직접 소유하지 않는다. 파일 쓰기와 normalization 책임은 runner/control plane에 둔다.
- provider event는 최소 표준 이벤트로 정규화되어야 한다.
- built provider 라우팅과 운영 에이전트/사용자 런타임은 별개 축으로 다룬다.
- 새로운 provider를 붙이는 변경은 먼저 contract와 fake provider 검증을 통과해야 한다.

## 연결된 이슈 / 결정

- [[issues/BUI-41]]
