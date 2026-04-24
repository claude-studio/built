---
id: BUI-53
title: "[Do] check.js feature-spec 컨텍스트 명시적 주입 및 프롬프트 품질 개선"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-53
pr: https://github.com/claude-studio/built/pull/41
week: 2
tags: [check, feature-spec, schema, prompt]
keywords: [check check.js feature-spec 명시적 주입 acceptance_criteria_results JSON Schema 프롬프트 품질 개선]
---

## 목표

scripts/check.js가 feature-spec.md를 프롬프트에 명시적으로 포함하지 않던 문제를 수정하고, JSON Schema에 acceptance_criteria_results 필드를 추가하여 완료 기준 항목별 체크 결과를 구조화된 형태로 반환하도록 개선.

## 구현 내용

- scripts/check.js: specPath에서 읽은 feature-spec.md를 `## Feature Spec (feature-spec.md)` 헤더로 프롬프트에 명시적 삽입, 완료 기준 항목별 체크 지시 추가
- JSON Schema 확장: `acceptance_criteria_results: [{criterion, passed}]` 선택적 필드 추가
- check-result.md 포맷 개선: `## 완료 기준 충족 여부` 섹션 추가 ([x]/[ ] 형식)
- test/check.test.js: 기존 15개 테스트 유지 + 신규 5개 추가 (20/20 통과)

## 결정 사항

- acceptance_criteria_results를 선택적(optional) 필드로 추가 — 기존 호환성 유지
- check-result.md에 acceptance criteria 대응 표시를 별도 섹션으로 분리 — 가독성 향상

## 발생한 이슈

없음. 1회차 리뷰 통과.

## 완료 기준 충족 여부

- [x] scripts/check.js가 feature-spec.md를 프롬프트에 명시적으로 포함
- [x] JSON Schema 확장 (acceptance_criteria_results 선택적 추가)
- [x] check-result.md 포맷 개선 (acceptance criteria 대응 표시)
- [x] 단위 테스트 기존 통과 유지 + 신규 케이스 추가 (20/20)
- [x] 외부 npm 패키지 없음

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-53",
  "name": "[Do] check.js feature-spec 컨텍스트 명시적 주입 및 프롬프트 품질 개선",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/41"},
  "actionStatus": "CompletedActionStatus"
}
```
