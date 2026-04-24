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
supports_goal: [GOAL-N]   # 선택 사항
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
supports_goal: [GOAL-N]   # 선택 사항
tags: [architecture, tooling, pattern]
---
```

본문 섹션:
- ## 컨텍스트 (어떤 상황에서 결정이 필요했나)
- ## 결정 (무엇을 선택했나)
- ## 근거 (왜)
- ## 결과 (어떤 영향이 있었나)
- ## 대안 (검토했으나 선택하지 않은 것)

## goal 엔트리 (goals/<slug>.md)

```yaml
---
id: GOAL-N
title: 프로젝트 궁극 목표
type: goal
date: YYYY-MM-DD
status: active | archived
horizon: long-term
tags: [north-star, control-plane]
---
```

본문 섹션:
- ## 목표 문장
- ## 성공 판정 기준
- ## 비가역 원칙
- ## 연결된 이슈 / 결정

## review 엔트리 (reviews/daily-YYYY-MM-DD.md)

```yaml
---
id: REVIEW-YYYY-MM-DD
title: Daily Alignment Review
type: review
date: YYYY-MM-DD
status: aligned | mixed | drifted
goal: GOAL-N              # goal이 2개 이상이 되면 goals: [GOAL-N, GOAL-M]로 마이그레이션
drifts_from: [GOAL-N]     # 선택 사항
tags: [daily-review, alignment]
---
```

본문 섹션:
- ## 오늘 한 일
- ## 목표와의 연결
- ## 잘된 점
- ## 드리프트 / 잘못된 점
- ## 교정 액션
- ## 관련 이슈 / 결정

## agent 엔트리 (agents/<에이전트ID>.md)

```yaml
---
id: <에이전트 UUID>
name: 에이전트 이름
type: agent
created: YYYY-MM-DD
role: 역할 설명 (개발, 리뷰, 스크립트 등)
workspace_id: 워크스페이스 UUID
status: active | archived
tags: [role-type]
---
```

본문 섹션:
- ## 역할 (이 에이전트가 담당하는 작업 범위)
- ## 처리 이슈 목록 (완료/blocked 이슈 ID 목록)
- ## 특이사항 (반복 실수, 강점, 운영 메모)

JSON-LD 블록:
```json-ld
{
  "@context": "https://schema.org",
  "@type": "SoftwareAgent",
  "identifier": "<에이전트 UUID>",
  "name": "에이전트 이름",
  "description": "역할 설명"
}
```

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
