---
id: BUI-54
title: "[UX] /built:cost 명령 구현 — feature별 비용 집계 조회"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-54
pr: https://github.com/claude-studio/built/pull/46
week: 2
tags: [ux, cost, scripts, skill]
keywords: [cost cost.js 비용 집계 feature progress.json cost_usd 테이블 json 출력]
---

## 목표

scripts/run.js에 비용 경고만 있고 feature별/전체 누적 비용을 조회하는 독립 명령이 없던 상황에서,
progress.json의 cost_usd 필드를 읽어 팀이 비용을 추적할 수 있는 `/built:cost` 명령을 구현.

## 구현 내용

- scripts/cost.js 신규 구현
  - `--feature <name>`: 특정 feature의 progress.json에서 cost_usd 조회
  - `--all`: .built/features/ 하위 모든 feature 비용 합산 + 테이블 출력
  - `--format json`: JSON 출력 지원
  - registry 기반 수집 + 디렉토리 폴백 로직 포함
- skills/cost/SKILL.md 작성 (/built:cost 트리거)
- 단위 테스트 23개 구현 (전량 통과)
- 외부 npm 패키지 없음

## 결정 사항

- registry 기반 수집을 우선하고 디렉토리 폴백으로 보완 — 다른 scripts와 일관성 유지
- 단계별 비용 분해는 progress.json 구조상 가능한 경우에만 포함 (선택적)

## 발생한 이슈

없음. 1회차 리뷰 통과.

## 완료 기준 충족 여부

- [x] scripts/cost.js 구현 (--feature / --all / --format json)
- [x] skills/cost/SKILL.md 작성 (/built:cost 트리거)
- [x] --format json 지원
- [x] 단위 테스트 23개 포함 (전량 통과)
- [x] 외부 npm 패키지 없음

## 재발 방지 포인트

없음

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-54",
  "name": "[UX] /built:cost 명령 구현 — feature별 비용 집계 조회",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/46"},
  "actionStatus": "CompletedActionStatus"
}
```
