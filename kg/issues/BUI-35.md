---
id: BUI-35
title: "[Tech Debt] state.js ↔ BUILT-DESIGN.md §5 스펙 정합성 검토 및 수정"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-35
pr: https://github.com/claude-studio/built/pull/27
week: 1
tags: [tech-debt, state, spec-alignment]
---

## 목표

state.js 현재 구현과 BUILT-DESIGN.md §8.3 state.json 스펙의 구조적 불일치를 분석하고 수정한다.
BUI-10에서 기록된 'worker 중첩 구조 차이' 등 gap 항목을 명확히 하는 것이 핵심이었다.

## 구현 내용

- state.js 실제 생성 필드와 BUILT-DESIGN.md §8.3 예시 필드를 항목별로 비교 분석
- 갭 비교표 작성 (feature, phase, status, pid, heartbeat, updatedAt, attempt, last_error, startedAt, worker 중첩 등)
- BUILT-DESIGN.md §8.3 state.json 예시에 `startedAt` 필드 추가 (구현 기준 스펙 업데이트)
- scripts/status.js의 `heartbeat_at` 폴백 dead code 제거

## 결정 사항

- worker 중첩 구조: BUI-10 KG에서 불일치로 기록됐으나 실제로는 구현에도 스펙에도 없음 — 오해였고 실제 gap 아님
- startedAt 필드: 구현에 있으나 스펙에 누락 → 구현이 맞으므로 스펙을 업데이트 (구현 기준 스펙)
- heartbeat_at: 구현과 스펙 모두 사용 안 함, status.js에만 dead code 폴백으로 존재 → 제거

## 발생한 이슈

없음. 1회차 리뷰 통과.

## 완료 기준 충족 여부

1. state.js 구현과 §8.3 비교 분석 comment 작성 — 완료 (갭 비교표 포함)
2. 불일치 수정 또는 스펙 업데이트 — 완료 (startedAt 스펙 추가, heartbeat_at dead code 제거)
3. 영향받는 스크립트 확인 — 완료 (run.js, iter.js 영향 없음, status.js 수정)
4. 기존 테스트 전부 통과 — 완료 (23개)
5. 외부 npm 패키지 없음 — 완료

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-35",
  "name": "[Tech Debt] state.js ↔ BUILT-DESIGN.md §5 스펙 정합성 검토 및 수정",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/27"},
  "actionStatus": "CompletedActionStatus"
}
```
