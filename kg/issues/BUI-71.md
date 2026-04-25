---
id: BUI-71
title: "KG 검토 및 개선 backlog 보충"
type: issue
date: 2026-04-25
status: completed
agent: CTO
branch: ""
pr: ""
week: 4
tags: [kg, backlog, review]
keywords: [kg, backlog, 검토, 보충, run-test, worktree, max_cost_usd, 스킬, agents]
---

## 목표

kg/issues/, kg/decisions/, BUILT-DESIGN.md, README.md를 검토하여 누락된 구현 항목, 문서 드리프트, 고도화 가능 부분을 파악하고 중복 없이 backlog 이슈를 추가한다.

## 구현 내용

- kg/issues/ 61개, kg/decisions/ 1개, BUILT-DESIGN.md, README.md, 전체 이슈 71개, 실제 코드 구조, npm test 결과 검토
- 신규 backlog 이슈 4개 생성:
  - BUI-72: run.test.js 모듈 경로 패칭 오류 (15개 테스트 실패 중) [high]
  - BUI-73: /built:run-opus, /built:run-sonnet 별도 스킬 파일 누락 [medium]
  - BUI-74: run-request.json max_cost_usd 필드 미구현 [medium]
  - BUI-75: claude -p --worktree execution worktree 재사용 PoC [low]
  - BUI-76: kg/agents/ 처리 이슈 목록 최신화 누락 [low]

## 결정 사항

- HTTP Inspector 관련 BUI-63~69는 별도 피처 영역으로 분류하고 built 핵심 PDCA 영역 갭에 집중
- Daily KG Review autopilot이 이미 active이므로 review 자동화는 신규 이슈 대상 제외
- run.test.js 실패가 가장 즉시 영향이 큰 항목으로 high priority 부여

## 발생한 이슈

없음.

## 완료 기준 충족 여부

- [x] KG 전체 읽기 완료
- [x] BUILT-DESIGN.md, README.md 검토 완료
- [x] 기존 이슈 전체 조회 후 중복 제외
- [x] 신규 backlog 이슈 생성 (4개)
- [x] 결과 comment 작성
- [x] 이슈 done 처리

## 재발 방지 포인트

- run.test.js가 임시 디렉토리 패칭 방식을 쓰므로, run.js에 새 src/ require를 추가할 때마다 test/run.test.js 패칭 로직도 함께 업데이트해야 한다.
- skills/ 디렉토리 구조와 README 명령어 목록의 sync를 유지해야 한다. 새 명령 추가 시 SKILL.md 파일도 반드시 생성.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-71",
  "name": "KG 검토 및 개선 backlog 보충",
  "agent": {"@type": "SoftwareAgent", "name": "CTO"},
  "result": {"@type": "CreativeWork", "description": "BUI-72~76 신규 backlog 이슈 생성"},
  "actionStatus": "CompletedActionStatus"
}
```
