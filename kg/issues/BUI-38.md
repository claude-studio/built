---
id: BUI-38
title: "[Plan] /built:plan plan-draft.md 중간 저장 구현 (C2 위험 대응)"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-38
pr: https://github.com/claude-studio/built/pull/31
week: 2
tags: [plan, c2, session-recovery, draft, gitignore]
keywords: [plan, draft, session, recovery, c2, 중간, 저장, 재시작]
---

## 목표

/built:plan 실행 중 세션 중단 시 진행 상황이 유실되는 C2 위험을 대응하기 위해 plan-draft.md 중간 저장 기능 구현. Phase별 진행 상황을 .built/runs/<feature>/plan-draft.md에 저장하고, 재시작 시 이어서 진행할 수 있도록 지원.

## 구현 내용

- scripts/plan-draft.js 신규 생성: read/write/remove/buildContent 헬퍼 (Node.js 내장 fs/path만 사용)
- skills/plan/SKILL.md 수정: 사전 확인 3단계 + Phase 1~4 완료 시 draft 저장 지시 추가
- .gitignore 수정: .built/runs/*/plan-draft.md 추가
- Phase 5-5 완료 후 plan-draft.md 삭제
- 재시작 시 draft 감지 후 AskUserQuestion으로 이어서/처음부터 선택 제공

## 결정 사항

- scripts/plan-draft.js를 별도 파일로 분리 (SKILL.md 인라인 대신): 헬퍼 재사용성 및 가독성 향상
- phase_completed 필드 기반으로 재개 Phase 결정: 명시적이고 오류가 없음
- .built/runs/*/plan-draft.md 패턴으로 gitignore 등록: feature별 draft 전체 제외

## 발생한 이슈

없음. 1회차 리뷰 통과.

## 완료 기준 충족 여부

1. 각 Phase(1~4) 완료 시 plan-draft.md 저장 - 충족
2. plan 재시작 시 draft 감지 및 이어서 시작 여부 질문 - 충족
3. draft 내용을 context에 주입해 Phase 재개 지원 - 충족
4. Phase 5 Save 완료 후 plan-draft.md 삭제 - 충족
5. .gitignore에 plan-draft.md 포함 확인 - 충족
6. 외부 npm 패키지 없음 - 충족

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-38",
  "name": "[Plan] /built:plan plan-draft.md 중간 저장 구현 (C2 위험 대응)",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/31"},
  "actionStatus": "CompletedActionStatus"
}
```
