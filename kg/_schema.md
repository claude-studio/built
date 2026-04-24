---
title: KG 스키마
type: schema
updated: 2026-04-24
---

# KG 스키마 정의

모든 에이전트는 이 스키마를 따라 .kg/ 파일을 작성한다.

## issue 엔트리 (issues/<이슈ID>.md)

```yaml
---
id: BUI-N
title: 이슈 제목
type: issue
date: YYYY-MM-DD
status: completed | blocked | rejected
agent: 에이전트 이름
branch: 브랜치명
pr: PR URL
week: 1 | 2 | 3 | 4
tags: [poc, phase1, phase2, phase3]
---
```

본문 섹션:
- ## 목표
- ## 구현 내용
- ## 결정 사항 (선택 사항마다 왜 이걸 선택했는지)
- ## 발생한 이슈 (blocked, 반려 이력)
- ## 완료 기준 충족 여부

JSON-LD 블록:
```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-N",
  "name": "이슈 제목",
  "agent": {"@type": "SoftwareAgent", "name": "에이전트명"},
  "result": {"@type": "CreativeWork", "url": "PR URL"},
  "actionStatus": "CompletedActionStatus"
}
```

## decision 엔트리 (decisions/<슬러그>.md)

```yaml
---
id: ADR-N
title: 결정 제목
type: decision
date: YYYY-MM-DD
status: accepted | superseded
context_issue: BUI-N
tags: [architecture, tooling, pattern]
---
```

본문 섹션:
- ## 컨텍스트 (어떤 상황에서 결정이 필요했나)
- ## 결정 (무엇을 선택했나)
- ## 근거 (왜)
- ## 결과 (어떤 영향이 있었나)
- ## 대안 (검토했으나 선택하지 않은 것)

## workflow 엔트리 (workflows/<슬러그>.md)

```yaml
---
id: WF-N
title: 워크플로우 이름
type: workflow
date: YYYY-MM-DD
validated_by: [BUI-N, BUI-M]
tags: [pattern, automation]
---
```

본문 섹션:
- ## 패턴 설명
- ## 언제 사용하나
- ## 단계
- ## 주의사항
