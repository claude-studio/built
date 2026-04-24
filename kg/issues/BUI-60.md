---
id: BUI-60
title: "[KG] CLAUDE.md KG 문서화 섹션 — 재발 방지 포인트 + decisions/ 의무화"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-60
pr: https://github.com/claude-studio/built/pull/43
week: 4
tags: [kg, claude-md, schema, decision, documentation]
keywords: [kg, 문서화, 재발방지, decisions, 의무화, 스키마, 개선]
---

## 목표

CLAUDE.md KG 문서화 섹션을 수정하여 두 가지 품질 개선을 반영한다:
1. 이슈 엔트리 본문 섹션에 `## 재발 방지 포인트` 추가
2. decisions/ 작성 기준을 명확하고 의무적으로 변경

## 구현 내용

- CLAUDE.md KG 문서화 섹션 본문 섹션 목록에 `## 재발 방지 포인트` 항목 추가
- decisions/ 작성 조건 변경: "아키텍처 결정 발생 시" → "설계 문서(BUILT-DESIGN.md)에 없는 구현 방식을 선택했거나 접근을 바꾼 경우 반드시 작성"
- CTO 에이전트 multica instructions의 KG 문서화 섹션도 동일하게 업데이트
- PR #43으로 main 브랜치 squash 머지

## 결정 사항

- 기존 KG 엔트리 소급 수정 없음. 신규 이슈부터 새 섹션 적용.
- decisions/ 조건을 "반드시"로 격상하여 선택적 작성 여지 제거.

## 발생한 이슈

없음.

## 재발 방지 포인트

- CLAUDE.md는 소스 코드 범주에 해당하므로 CTO가 직접 수정하지 않고 반드시 개발 에이전트에 위임해야 한다.
- decisions/ 작성 기준을 모호하게 두면 에이전트마다 판단이 달라져 누락이 발생한다. "BUILT-DESIGN.md에 없는 방식"이라는 명확한 트리거 조건이 필요하다.

## 완료 기준 충족 여부

1. CLAUDE.md KG 문서화 섹션에 재발 방지 포인트 섹션 명시 — ✓
2. decisions/ 작성 조건이 명확히 정의됨 — ✓
3. main 브랜치에 커밋 (PR #43) — ✓

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-60",
  "name": "[KG] CLAUDE.md KG 문서화 섹션 — 재발 방지 포인트 + decisions/ 의무화",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/43"},
  "actionStatus": "CompletedActionStatus"
}
```
