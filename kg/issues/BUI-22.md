---
id: BUI-22
title: "[Week 4] [Phase3] 비용 경고 구현"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-22-cost-warn
pr: https://github.com/claude-studio/built/pull/23
week: 4
tags: [phase3, cost, dry-run, safety]
---

## 목표

run 실행 전 누적 total_cost_usd > $1.0 시 사용자 확인 요청 및 dry-run 모드 지원.

## 구현 내용

- scripts/run.js에 비용 경고 로직 추가
  - progress.json에서 cost_usd 필드 읽기
  - COST_THRESHOLD_USD=1.0 초과 시 AskUserQuestion으로 y/N 확인
  - 거부 또는 비대화형 환경(stdin 닫힘) 시 기본값 N으로 exit 1
- --dry-run 플래그 지원
  - /built:run <feature> --dry-run 또는 run-request.json dry_run:true 시 실제 claude 호출 없이 계획만 출력
  - dry-run 모드에서는 비용 경고 없이 통과
- skills/cost-warn/SKILL.md 작성 (비용 경고 동작 설명, dry-run 사용법)
- 단위 테스트 8개 추가 (비용 5개 + dry-run 3개), 전체 22개 통과

## 결정 사항

- 비용 임계값을 하드코딩(1.0)하지 않고 COST_THRESHOLD_USD 상수로 분리 — 향후 설정 가능성 고려
- 비대화형 환경에서 기본값을 N(중단)으로 설정 — 안전 우선 원칙

## 발생한 이슈

없음. 1회차 리뷰 통과.

## 완료 기준 충족 여부

1. scripts/run.js 비용 경고 로직 추가 — 충족
2. --dry-run 플래그 지원 — 충족
3. skills/cost-warn/SKILL.md 작성 — 충족
4. 단위 테스트 8개 추가, 전체 22개 통과 — 충족

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-22",
  "name": "[Week 4] [Phase3] 비용 경고 구현",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/23"},
  "actionStatus": "CompletedActionStatus"
}
```
