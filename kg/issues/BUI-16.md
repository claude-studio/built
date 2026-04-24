---
id: BUI-16
title: "[Week 3] [Phase2] /built:run 구현 (Do→Check→Iter→Report 오케스트레이션)"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-16-built-run
pr: https://github.com/claude-studio/built/pull/17
week: 3
tags: [phase2, run, pipeline, orchestration]
keywords: [run, 구현, orchestration, 오케스트레이션, pipeline, do, check, iter, report, 백그라운드]
---

## 목표

전체 파이프라인 자동 실행. do.js → check.js → iter.js → report.js 순차 오케스트레이션, 백그라운드 실행 + 폴링, /built:run-opus, /built:run-sonnet 모델 변형 포함.

## 구현 내용

- scripts/run.js: 파이프라인 전체 오케스트레이션
  - .built/features/<feature>/run-request.json 읽기
  - do.js → check.js → iter.js → report.js 순차 실행 (pipeline-runner.js 활용)
  - --background 플래그 지원 (백그라운드 실행)
  - state.json 실시간 진행 상황 갱신
  - 각 단계 실패 시 state.json에 failed 기록 후 종료
  - MULTICA_AGENT_TIMEOUT, BUILT_MAX_ITER 환경변수 지원
- scripts/report.js 스텁 구현
  - pipeline-runner.js 활용
  - do-result.md + check-result.md 기반 보고서 생성
  - state.json completed 갱신
- skills/run/SKILL.md: Claude Code 스킬 형식 작성
  - /built:run, /built:run-opus, /built:run-sonnet 변형 포함
  - 사전 확인 및 백그라운드 폴링 안내
- 단위 테스트 14개: 단계 순서 검증, 실패 단계 중단, state.json 갱신, 백그라운드 모드

## 결정 사항

- pipeline-runner.js를 통한 각 단계 실행 (직접 child_process 호출 아님)
  - 이유: 기존 추상화 재사용, 타임아웃/에러 처리 일관성 유지
- report.js를 스텁으로 선구현 후 run.js에서 호출
  - 이유: 선행 이슈에 report.js가 없었으므로 완료 기준 충족을 위해 스텁 필요

## 발생한 이슈

없음 (1회차 리뷰 통과)

## 완료 기준 충족 여부

1. scripts/run.js 구현 (do→check→iter→report, --background, state.json 갱신, 실패 처리, env 변수) - 충족
2. scripts/report.js 스텁 구현 - 충족
3. skills/run/SKILL.md 작성 (/built:run, /built:run-opus, /built:run-sonnet 변형) - 충족
4. 외부 npm 패키지 없음 (Node.js 표준 라이브러리만) - 충족
5. 단위 테스트 14개 전체 통과 - 충족

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-16",
  "name": "[Week 3] [Phase2] /built:run 구현 (Do→Check→Iter→Report 오케스트레이션)",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/17"},
  "actionStatus": "CompletedActionStatus"
}
```
