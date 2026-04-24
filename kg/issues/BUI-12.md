---
id: BUI-12
title: "[Week 2] [Phase1] /built:plan 스킬 구현"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-12-plan
pr: https://github.com/claude-studio/built/pull/9
week: 2
tags: [phase1, plan, skill, AskUserQuestion, interview-flow]
---

## 목표

6단계 인터뷰 플로우 구현 (Phase 0 Prior Art → Phase 5 Save). AskUserQuestion 연속 호출, features-index.md 갱신, run-request.json 생성. `/built:plan` 스킬.

## 구현 내용

- `.claude/skills/plan.md`: 6단계 인터뷰 플로우 전체 구현
- Phase 0: Prior Art 조회
- Phase 1~4: AskUserQuestion 순차 단독 호출 (BUI-4 PoC 패턴 반영)
- Phase 5-3: `state.initRunRequest/initState` 호출로 run-request.json + state.json 생성
- Phase 5-4: `node src/update-index.js` 실행으로 features-index.md 갱신
- `src/update-index.js` 신규 구현 포함

## 결정 사항

- AskUserQuestion 순차 단독 호출 패턴: BUI-4 PoC 검증 결과 반영 (다중 동시 호출 불가)
- `state.js` 기존 API 재사용으로 일관성 유지

## 발생한 이슈

없음. 1회차 통과.

## 완료 기준 충족 여부

1. /built:plan <feature> 실행 시 6단계 인터뷰 플로우 진행 ✓
2. run-request.json 생성 (state.js 활용) ✓
3. .built/features-index.md 갱신 ✓
4. 외부 npm 패키지 없음 ✓
5. BUI-4 PoC 결과 반영 (AskUserQuestion 순차 단독 호출) ✓

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-12",
  "name": "[Week 2] [Phase1] /built:plan 스킬 구현",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/9"},
  "actionStatus": "CompletedActionStatus"
}
```
