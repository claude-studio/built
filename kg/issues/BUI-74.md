---
id: BUI-74
title: "[Config] run-request.json max_cost_usd 필드 지원 — 피처별 비용 상한 설정"
type: issue
date: 2026-04-25
status: completed
agent: 개발
branch: bui-74
pr: https://github.com/claude-studio/built/pull/55
week: 4
tags: [config, cost-control, schema]
keywords: [max_cost_usd, run-request, config, 비용상한, 피처별, 글로벌, 기본값, validate]
---

## 목표

run-request.json에 max_cost_usd 필드를 추가하여 피처별로 비용 상한을 설정할 수 있게 한다.
글로벌 기본값은 .built/config.json의 default_max_cost_usd, 최종 폴백은 $1.0이다.

## 구현 내용

- run-request.json 스키마에 max_cost_usd 선택 필드 추가 (양수 검증 포함)
- .built/config.json에 default_max_cost_usd 글로벌 기본값 필드 지원
- run.js에서 우선순위 로직 구현: run-request.json > config.json > 기본값 $1.0 (IIFE 방식)
- validate.js의 validateConfig에 default_max_cost_usd 양수 여부 검증 및 known keys 추가
- 테스트 추가: validate.test.js +7개, run.test.js +5개 (전체 90 passed, 0 failed)

## 결정 사항

우선순위 로직을 IIFE(즉시 실행 함수)로 구현 — 조건 분기를 명확하게 표현하고 상수에 할당할 수 있어 가독성과 유지보수성이 높다.

## 발생한 이슈

없음.

## 완료 기준 충족 여부

- [x] run-request.json max_cost_usd 필드 추가 (선택, 기본값 1.0)
- [x] .built/config.json default_max_cost_usd 글로벌 기본값 지원
- [x] run.js 우선순위 로직 (run-request > config > $1.0)
- [x] /built:validate에서 max_cost_usd 양수 검증
- [x] 관련 테스트 추가 (validate +7, run +5, 전체 90 passed)

## 재발 방지 포인트

없음

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-74",
  "name": "[Config] run-request.json max_cost_usd 필드 지원 — 피처별 비용 상한 설정",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/55"},
  "actionStatus": "CompletedActionStatus"
}
```
