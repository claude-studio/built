---
id: BUI-51
title: "[Arch] state.json 이중화 해소 — SSOT 확립 (C3 대응)"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-51
pr: https://github.com/claude-studio/built/pull/39
week: 4
tags: [architecture, ssot, state, progress]
---

## 목표

BUI-41에서 진단된 state.json 이중화 문제를 해소한다.
- .built/runtime/runs/<feature>/state.json (orchestrator 전용)
- .built/features/<feature>/progress.json (pipeline 전용)
두 파일의 역할을 명확히 분리하고 BUILT-DESIGN.md §8.3에 SSOT 계약을 문서화한다.

## 구현 내용

- progress-writer.js에서 patchState 호출 완전 제거 (state.json 미접촉)
- state.json은 orchestrator(run.js)만 관리: phase/status/pid/attempt/last_error
- progress.json은 pipeline(progress-writer.js)만 관리: session_id/turn/cost/tokens/status
- status.js가 progress.json을 featureDir(.built/features/<feature>/) 기준으로 읽도록 수정
- BUILT-DESIGN.md §8.3에 SSOT 계약 표 형식으로 명문화

## 결정 사항

- state.json → progress.json 이름 변경 대신 경로+역할 분리 방식 채택
  - 이유: 기존 .built/features/<feature>/state.json 파일명이 .built/runtime/runs/<feature>/state.json과 혼동되어, progress.json으로 rename하여 역할을 명확히 구분
- /built:status는 featureDir 기준 progress.json 단일 경로만 읽음

## 발생한 이슈

없음. 1회차 리뷰 통과.

## 완료 기준 충족 여부

- [x] state.json 중복 필드 제거 — orchestrator/pipeline 역할 명확히 분리
- [x] /built:status, run.js, iter.js가 동일 경로 기준으로 읽음
- [x] 단위 테스트 기존 통과 유지 (progress-writer.test.js 36/36, status.test.js 26/26)
- [x] 외부 npm 패키지 없음

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-51",
  "name": "[Arch] state.json 이중화 해소 — SSOT 확립 (C3 대응)",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/39"},
  "actionStatus": "CompletedActionStatus"
}
```
