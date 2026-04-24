---
id: BUI-6
title: "[Week 2] [Phase1] pipeline-runner.js 구현"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-6-pipeline-runner
pr: https://github.com/claude-studio/built/pull/13
week: 2
tags: [phase1, pipeline, core]
---

## 목표

claude -p 서브세션을 실행하고 stream-json stdout을 progress-writer.js로 파이프하는 메인 실행기 구현. MULTICA_AGENT_TIMEOUT 환경변수 지원.

## 구현 내용

- `src/pipeline-runner.js`: `runPipeline({ prompt, model, runtimeRoot, phase, featureId, resultOutputPath })` 함수
- `child_process.spawn`으로 `claude -p --output-format stream-json --verbose` 실행
- stdout 줄 단위 읽어 `progress-writer.js createWriter().handleLine()` 전달
- MULTICA_AGENT_TIMEOUT 환경변수 파싱 (ms/s/m/h 단위 지원, 기본값 30분)
- 비정상 종료 시 에러 반환 (exit code, stderr, spawn error 모두 처리)
- `test/pipeline-runner.test.js`: 단위 테스트 28개

## 결정 사항

- CTO comment 스펙에 `processLine`으로 기재되어 있었으나 실제 progress-writer.js API는 `handleLine`임 - 실제 API 기준으로 올바르게 구현 (리뷰 에이전트가 확인)
- 타임아웃 단위 파싱 (ms/s/m/h)을 runner 자체에서 처리 → 유연성 확보

## 발생한 이슈

없음 (1회차 리뷰 통과)

## 완료 기준 충족 여부

1. runPipeline 함수 구현 ✓
2. claude -p stream-json spawn ✓
3. stdout → handleLine() 전달 ✓
4. MULTICA_AGENT_TIMEOUT 지원 ✓
5. 비정상 종료 에러 반환 ✓
6. 외부 npm 패키지 없음 ✓
7. 단위 테스트 28개 통과 ✓

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-6",
  "name": "[Week 2] [Phase1] pipeline-runner.js 구현",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/13"},
  "actionStatus": "CompletedActionStatus"
}
```
