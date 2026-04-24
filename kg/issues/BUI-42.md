---
id: BUI-42
title: "[Bugfix] run.js progress.json 경로 불일치 수정 — 비용 경고 실제 동작하도록"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-42
pr: https://github.com/claude-studio/built/pull/26
week: 1
tags: [bugfix, run, progress, cost]
---

## 목표

scripts/run.js의 readAccumulatedCost()가 잘못된 경로(.built/runtime/runs/<feature>/progress.json)를 읽어 비용 경고가 항상 0을 반환하는 버그 수정.

## 구현 내용

- scripts/run.js readAccumulatedCost()의 progressPath를 path.join(featureDir, 'progress.json')으로 변경
- featureDir = path.join(projectRoot, '.built', 'features', feature) 경로 계산 추가 (run.js:64)
- 테스트 헬퍼도 동일 경로로 업데이트

## 결정 사항

featureDir 변수를 readAccumulatedCost() 내부에 새로 정의해 기존 코드 구조를 최소 변경으로 수정. progress.json 쓰기 경로(progress-writer.js)와 읽기 경로를 일치시키는 것이 핵심.

## 발생한 이슈

없음. 1회차 리뷰 통과.

## 완료 기준 충족 여부

1. progressPath = path.join(featureDir, 'progress.json') 수정 완료 - 충족
2. featureDir = path.join(projectRoot, '.built', 'features', feature) 정확히 사용 - 충족
3. 테스트 22/22 통과 (기존 실패 3개 포함 전체 통과) - 충족
4. 외부 npm 패키지 없음 - 충족

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-42",
  "name": "[Bugfix] run.js progress.json 경로 불일치 수정 — 비용 경고 실제 동작하도록",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/26"},
  "actionStatus": "CompletedActionStatus"
}
```
