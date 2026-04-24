---
id: BUI-37
title: "[Plan] /built:plan Phase 5 - decisions/entities/patterns 신규 문서 생성 지원"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-37
pr: https://github.com/claude-studio/built/pull/32
week: 4
tags: [plan, kg, wikilink, phase5]
keywords: [plan, decisions, entities, patterns, wikilink, 자동, 생성, 문서]
---

## 목표

/built:plan Phase 5(Save)에서 feature-spec.md의 wikilink([[decisions/slug]], [[entities/slug]], [[patterns/slug]])를 파싱해 아직 파일이 없는 항목을 자동 생성한다. BUILT-DESIGN.md §6 Phase 5 스펙 완성.

## 구현 내용

- scripts/plan-save.js 신규 생성
  - feature-spec.md 전체 텍스트에서 [[type/slug]] 패턴 파싱
  - decisions/, entities/, patterns/ 각 카테고리별 파일 존재 여부 확인
  - 없으면 §7 스키마 frontmatter + 본문 초안으로 신규 생성
- skills/plan/SKILL.md Phase 5-2 지침 업데이트: node scripts/plan-save.js 호출 추가

## 결정 사항

- wikilink 파싱 방식: 정규식 `\[\[([^\]]+)\]\]` 로 단순 전체 텍스트 스캔 (선택 이유: 복잡한 파서 없이 deps 0 유지)
- 멱등성: fs.existsSync 로 기존 파일 존재 시 skip (덮어쓰기 없음)
- frontmatter 구조: §7 스키마 준수 — decision(type/slug/adopted_count/tags), entity(type/slug/size_estimate/growth/defined_in), pattern(type/slug/reference_file/tags)

## 발생한 이슈

없음 (1회차 리뷰 통과)

## 완료 기준 충족 여부

1. Phase 5에서 wikilink 파싱으로 신규 decisions/entities/patterns 파일 생성 ✓
2. 기존 파일 존재 시 skip (멱등성 보장) ✓
3. 생성 파일이 §7 스키마 frontmatter 구조를 가짐 ✓
4. 외부 npm 패키지 없음 ✓

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-37",
  "name": "[Plan] /built:plan Phase 5 - decisions/entities/patterns 신규 문서 생성 지원",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/32"},
  "actionStatus": "CompletedActionStatus"
}
```
