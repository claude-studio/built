---
id: BUI-58
title: "[KG] issue 엔트리 frontmatter에 keywords 필드 추가 (Tolaria 검색 커버리지 개선)"
type: issue
date: 2026-04-25
status: completed
agent: CTO
branch: null
pr: null
week: 4
tags: [kg, keywords, tolaria, search, frontmatter]
keywords: [kg, keywords, 검색, frontmatter, tolaria, 커버리지, 소급, 스키마]
---

## 목표

Tolaria MCP의 완전 텍스트 매칭 방식으로 인해 "stream-json"(하이픈)과 "stream json"(공백) 같은 표기 차이로 검색 결과 누락이 발생하는 문제 해결.
kg/_schema.md에 keywords 필드를 추가하고, 기존 이슈 엔트리에 소급 적용하여 단어 단위 검색 커버리지를 개선한다.

## 구현 내용

- kg/_schema.md issue 엔트리 frontmatter에 keywords 필드 정의 추가
  - 형식: keywords: [단어1, 단어2, ...] (공백 기준 단어, 하이픈 없이)
- CTO 지침(CLAUDE.md) KG 문서화 섹션에 keywords 작성 방법 명시
  - 하이픈 표기 분리 규칙: stream-json → stream, json
  - Tolaria 검색 커버리지를 위해 표기 변형 모두 포함
- 기존 BUI-2~BUI-51 전체 39개 이슈 파일에 keywords 소급 추가
- git commit & push (main 브랜치 직접)

## 결정 사항

keywords는 tags와 별도 필드로 분리. tags는 카테고리/타입 분류용, keywords는 검색 커버리지 확장용으로 역할 구분.
하이픈을 포함한 복합어는 공백 기준으로 분리하여 양쪽 표기 모두 검색 가능하도록 처리.

## 발생한 이슈

없음.

## 완료 기준 충족 여부

1. _schema.md에 keywords 필드 정의 포함 — 완료
2. CTO 지침에 keywords 작성 지침 포함 — 완료
3. 기존 이슈 엔트리(BUI-2~BUI-51) keywords 소급 완료 — 39개 파일 완료
4. Tolaria에서 단어 단위 검색으로 관련 이슈 조회 가능 — keywords 필드 기반 검색 지원

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-58",
  "name": "[KG] issue 엔트리 frontmatter에 keywords 필드 추가 (Tolaria 검색 커버리지 개선)",
  "agent": {"@type": "SoftwareAgent", "name": "CTO"},
  "result": {"@type": "CreativeWork", "url": null},
  "actionStatus": "CompletedActionStatus"
}
```
