---
id: BUI-13
title: "[Week 2] [Phase1] /built:do 스킬 구현 (포그라운드)"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-13-do-skill
pr: https://github.com/claude-studio/built/pull/14
week: 2
tags: [phase1, skill, do, pipeline]
keywords: [do, skill, 스킬, pipeline, runner, 포그라운드, 실행, 구현]
---

## 목표

/built:do 스킬을 구현하여 pipeline-runner.js를 호출해 Do 단계를 포그라운드로 실행한다. stream-json stdout을 result-to-markdown.js로 파이프해 do-result.md를 생성한다.

## 구현 내용

신규 파일 2개 추가 (기존 파일 수정 없음):
- scripts/do.js: pipeline-runner.js의 runPipeline() 호출, 중복 실행 방지(state.json 체크), MULTICA_AGENT_TIMEOUT 처리
- skills/do/SKILL.md: Claude Code 스킬 형식 (frontmatter, 사전 확인, 실행, 완료 안내)

runtimeRoot를 .built/features/<feature>로 설정해 progress.json, do-result.md, logs를 같은 위치에 배치. run-request.json에서 모델을 읽어 적용 (없으면 claude 기본값).

## 결정 사항

- runtimeRoot = .built/features/<feature>: progress.json과 do-result.md를 같은 디렉토리에 배치해 일관성 확보
- 타임아웃 파싱은 pipeline-runner에 위임, 30분 기본값
- 중복 실행 방지: state.json 체크로 이미 running 상태면 오류 출력 후 종료

## 발생한 이슈

- private 에이전트(개발)에 assign 시 daemon이 task를 생성하지 않는 문제 발생 (3회 시도 후 todo 복구)
- 원인: private 에이전트는 daemon이 자동 실행하지 않음
- 해결: 사용자가 수동 트리거 또는 visibility 변경으로 해결

## 완료 기준 충족 여부

1. skills/do/SKILL.md 작성 (Claude Code 스킬 형식) ✓
2. /built:do <feature> 실행 시 src/pipeline-runner.js 호출 ✓
3. stream-json stdout → progress-writer → do-result.md 생성 ✓
4. 실행 중 progress.json 실시간 갱신 ✓
5. 포그라운드 실행 (백그라운드 X) ✓
6. 외부 npm 패키지 없음 ✓
7. MULTICA_AGENT_TIMEOUT 환경변수 기반 타임아웃 지원 ✓

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-13",
  "name": "[Week 2] [Phase1] /built:do 스킬 구현 (포그라운드)",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/14"},
  "actionStatus": "CompletedActionStatus"
}
```
