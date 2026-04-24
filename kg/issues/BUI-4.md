---
id: BUI-4
title: "[Week 1] [PoC-3] AskUserQuestion 다중 연속 호출 검증"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: poc-3
pr: https://github.com/claude-studio/built/pull/2
week: 1
tags: [poc, askuserquestion, plan, interview]
keywords: [askuserquestion, 다중, 연속, 호출, 검증, poc, plan, 인터뷰]
---

## 목표

Plan 인터뷰 플로우에서 AskUserQuestion을 여러 번 연속 호출해 사용자 응답을 단계적으로 받을 수 있는지 검증한다. 이 결과로 /built:plan 구현 방향을 결정한다.

## 구현 내용

- poc/poc-3-askuserquestion.md 작성 (검증 결과 문서)
- AskUserQuestion 연속 3회 호출 테스트 수행
- 컨텍스트 유지 방식 분석
- /built:plan 6단계 인터뷰 구현 방향 도출

## 결정 사항

- AskUserQuestion은 blocking 동기 방식으로 동작하며 순차 실행됨
- 이전 응답은 Claude 메시지 히스토리에 tool result로 자동 누적됨 → 별도 상태 저장 불필요
- n번째 호출 시 1~(n-1) 답변이 모두 컨텍스트에 보유됨
- /built:plan 구현 전략: Phase별 묶음 호출 패턴 권고
- 세션 중단 시 상태 유실 위험 → plan-draft.md 중간 저장 설계 필요

## 발생한 이슈

없음 (1회차 리뷰 통과)

## 완료 기준 충족 여부

1. AskUserQuestion 연속 호출 (최소 3회) 동작 확인 - 충족
2. 이전 응답을 다음 질문에 활용 가능한지 확인 - 충족 (메시지 히스토리 자동 유지)
3. 호출 간 상태 유지 방식 파악 - 충족 (tool result 누적)
4. /built:plan 6단계 인터뷰 구현 가능 여부 결론 도출 - 충족 (Phase별 묶음 패턴)
5. poc/poc-3-askuserquestion.md 문서화 완료 - 충족

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-4",
  "name": "[Week 1] [PoC-3] AskUserQuestion 다중 연속 호출 검증",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/2"},
  "actionStatus": "CompletedActionStatus"
}
```
