---
id: BUI-80
title: "[도그푸딩] built:plan 실패: token-generation-api"
type: issue
date: 2026-04-25
status: completed
agent: 개발
branch: bui-80
pr: https://github.com/claude-studio/built/pull/54
week: 4
tags: [dogfooding, bugfix, path-mismatch]
keywords: [plan 경로 불일치 init flat file feature spec CLAUDE 도그봇 체크]
---

## 목표

built:plan 실행 후 도그봇 에이전트가 기대하는 경로에 plan 파일이 없다는 문제를 해결.
CLAUDE.md(도그봇 instructions)의 체크 경로와 실제 생성 경로를 일치시킴.

## 구현 내용

두 가지 수정이 병행됨:

1. scripts/init.js, skills/init/SKILL.md 수정 (PR #54):
   - built:init 실행 시 feature spec 생성 경로를 .built/features/<feature>/feature-spec.md (서브디렉토리) → .built/features/<feature>.md (flat file)로 수정
   - BUI-78에서 init.js에 잘못된 경로로 feature-spec 생성 로직이 추가된 것을 수정

2. 도그봇 에이전트 instructions 수정 (multica agent update):
   - STEP 2 체크 경로: .built/features/<feature>/feature-spec.md → .built/features/<feature>.md
   - STEP 4 체크 경로: .built/features/<feature>/plan.md → .built/features/<feature>.md
   - STEP 4 comment 참조: <plan.md 전체 내용> → <feature spec 전체 내용 (.built/features/<feature>.md)>

## 결정 사항

Option B 선택 (체크 경로를 실제 생성 경로에 맞게 수정): plan 스킬 자체는 이미 flat file 방식으로 정상 동작 중이었으므로, 스킬을 수정하기보다 잘못된 참조(도그봇 instructions)를 수정하는 것이 범위가 좁고 안전함.

## 발생한 이슈

리뷰 1회차 반려: 개발 에이전트가 init.js만 수정하고 CLAUDE.md(실제로는 도그봇 instructions) 경로 불일치를 해결하지 않아 완료 기준 미충족 판정. 2회차에서 도그봇 instructions 수정 후 통과.

## 완료 기준 충족 여부

- built:plan 실행 후 .built/features/token-generation-api.md 생성됨 (이미 존재 확인)
- 도그봇 STEP 4 체크 경로가 실제 생성 경로와 일치하도록 수정 완료
- plan 스킬 자체는 변경 없이 기존 동작 유지

충족.

## 재발 방지 포인트

- 이슈 설명의 "CLAUDE.md"가 실제로는 multica 플랫폼에 저장된 에이전트 instructions를 가리킬 수 있음. 파일 시스템에서 CLAUDE.md를 찾지 못하면 에이전트 instructions도 확인할 것.
- BUI-78처럼 init 로직에 경로를 추가할 때 기존 스크립트(plan, run, check 등)가 사용하는 canonical 경로를 먼저 확인해야 함. flat file vs 서브디렉토리 불일치는 조용히 실패하므로 발견이 늦어짐.
- plan/run/do/check 스크립트는 .built/features/<feature>.md (flat file)를 canonical 경로로 사용함. 새 스크립트나 로직 추가 시 이 경로를 따를 것.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-80",
  "name": "[도그푸딩] built:plan 실패: token-generation-api",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/54"},
  "actionStatus": "CompletedActionStatus"
}
```
