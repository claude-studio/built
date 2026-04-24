---
id: GOAL-1
title: built의 북극성 목표
type: goal
date: 2026-04-24
status: active
horizon: long-term
tags: [north-star, pdca, automation, control-plane]
---

# built의 북극성 목표

## 목표 문장

사람이 feature의 의도와 제약만 정하면, built가 일관된 상태 모델 위에서 Plan -> Do -> Check -> Act를 자동으로 수행해 신뢰 가능하게 feature를 완료 상태까지 밀어 올린다.

## 성공 판정 기준

- 사람은 Plan과 의도, 제약 정의에 집중하고 실행 흐름은 시스템이 맡는다.
- 상태, 결과물, 반복 수정, 실패 처리가 하나의 일관된 계약 위에서 동작한다.
- 특정 feature의 현재 상태와 그 이유가 문서와 runtime에서 명확히 드러난다.

## 비가역 원칙

- 상태의 SSOT는 하나여야 한다.
- 문서층 KG와 runtime 상태층은 혼동하지 않는다.
- 자동화는 관측 가능성과 복구 가능성을 해치면 안 된다.
- 결과물보다 제어면 계약의 일관성을 우선한다.

## 연결된 이슈 / 결정

- [[issues/BUI-41]]
