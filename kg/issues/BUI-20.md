---
id: BUI-20
title: "[Week 4] [Phase3] /built:resume, /built:abort 구현"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-20-abort-resume
pr: https://github.com/claude-studio/built/pull/21
week: 4
tags: [phase3, abort, resume, state-management]
keywords: [resume, abort, 재개, 중단, 구현, state, lock, 해제]
---

## 목표

/built:abort와 /built:resume 스킬 구현. state.json status 갱신, lock 해제, registry 정리.

## 구현 내용

- scripts/abort.js: state.json status를 "aborted"로 갱신, lock 파일 삭제, registry.json에서 해당 feature status 갱신, edge case(없는 feature, 이미 종료된 상태) 처리
- scripts/resume.js: state.json status를 "planned"로 초기화, last_error null 초기화, lock 해제, registry 갱신, edge case(없는 feature, 이미 running/completed) 처리
- skills/abort/SKILL.md: /built:abort 트리거 정의
- skills/resume/SKILL.md: /built:resume 트리거 정의
- 단위 테스트 55개 (abort 27개 + resume 28개) 전부 통과

## 결정 사항

- resume 시 status를 "running"이 아닌 "planned"로 초기화 — 재실행은 /built:run이 담당하므로 resume은 단순히 재실행 가능 상태로 복원하는 역할에 집중
- last_error를 null로 초기화 — 이전 실패 원인을 지우고 깨끗한 상태에서 재시도할 수 있도록

## 발생한 이슈

없음 (1회차 리뷰 통과)

## 완료 기준 충족 여부

1. scripts/abort.js 구현 — 충족
2. scripts/resume.js 구현 — 충족
3. skills/abort/SKILL.md 작성 — 충족
4. skills/resume/SKILL.md 작성 — 충족
5. 단위 테스트 포함 (55개 통과) — 충족

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-20",
  "name": "[Week 4] [Phase3] /built:resume, /built:abort 구현",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/21"},
  "actionStatus": "CompletedActionStatus"
}
```
