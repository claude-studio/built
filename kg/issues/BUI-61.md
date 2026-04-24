---
id: BUI-61
title: "[KG] kg/_schema.md — 재발 방지 포인트 섹션 명세 추가"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-61
pr: https://github.com/claude-studio/built/pull/44
week: 4
tags: [kg, schema, documentation]
keywords: [schema, kg, 재발방지, 이슈엔트리, 섹션, 가이드라인]
---

## 목표

kg/_schema.md issue 엔트리 본문 섹션 목록에 `## 재발 방지 포인트`를 추가하고 작성 가이드라인을 명세한다.

## 구현 내용

- _schema.md issue 엔트리 본문 섹션 목록에 `## 재발 방지 포인트` 추가
- 가이드라인 4가지 항목 명세:
  - 비자명한 제약 (특정 파일/API를 건드리면 안 되는 이유 등)
  - 실패한 접근과 왜 실패했는지
  - 반복될 수 있는 실수 패턴
  - 없으면 명시적으로 '없음' 기재 (blank 기본값 방지)
- 구체적 예시 포함 (OAuthToken API rate limit 등)

## 결정 사항

기존 섹션 순서 맨 끝에 추가. 선택 사항이 아닌 필수 섹션으로 지정하여 blank 방지.

## 발생한 이슈

없음.

## 완료 기준 충족 여부

- [x] _schema.md issue 엔트리 본문 섹션에 ## 재발 방지 포인트 포함
- [x] 가이드라인 내용 명세 (비자명한 제약, 실패한 접근, 반복 실수 패턴, 없으면 없음 명시)
- [x] 구체적 예시 포함
- [x] main 브랜치에 PR을 통해 반영

## 재발 방지 포인트

없음.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-61",
  "name": "[KG] kg/_schema.md — 재발 방지 포인트 섹션 명세 추가",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/44"},
  "actionStatus": "CompletedActionStatus"
}
```
