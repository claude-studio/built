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
keywords: [단어1, 단어2, 단어3]   # 이슈 제목 + 구현 내용의 핵심 단어 (공백 기준, 하이픈 없이)
---
```

본문 섹션:
- ## 목표
- ## 구현 내용
- ## 결정 사항 (선택 사항마다 왜 이걸 선택했는지)
- ## 발생한 이슈 (blocked, 반려 이력)
- ## 완료 기준 충족 여부
- ## 재발 방지 포인트

`## 재발 방지 포인트` 작성 가이드라인:
- 비자명한 제약 (특정 파일/API를 건드리면 안 되는 이유 등)
- 실패한 접근과 왜 실패했는지
- 반복될 수 있는 실수 패턴
- 없으면 명시적으로 '없음' 기재 (blank 기본값 방지)

예시:
```
## 재발 방지 포인트
- OAuthToken API는 직접 호출 시 rate limit 발생 → SDK 래퍼 사용 필수
- 처음엔 컴포넌트를 분리했으나 상태 공유 이슈로 단일 파일로 병합
- 없음
```

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

## agent 엔트리 (agents/<역할-slug>.md)

```yaml
---
id: AGENT-<PUBLIC_ROLE_NAME>
name: 에이전트 이름
type: agent
created: YYYY-MM-DD
role: 역할 설명 (개발, 리뷰, 스크립트 등)
status: active | archived
visibility: public
tags: [role-type]
---
```

공개 기록 금지:
- 내부 agent UUID, workspace UUID, runtime ID
- 로컬 daemon/host 이름, 개인 로컬 경로
- token, chat id, secret, private environment value
- raw execution history
- 처리 이슈 전체 누적 목록

본문 섹션:
- ## 역할 (이 에이전트가 담당하는 작업 범위)
- ## 운영 범위
- ## 방향성 기준
- ## 처리 이슈 목록 (전체 누적 목록 대신 `kg/issues/` 참조)
- ## 특이사항 (반복 실수, 강점, 운영 메모)

JSON-LD 블록:
```json-ld
{
  "@context": "https://schema.org",
  "@type": "SoftwareAgent",
  "identifier": "AGENT-<PUBLIC_ROLE_NAME>",
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
