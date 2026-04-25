---
id: BUI-73
title: "[Skill] /built:run-opus, /built:run-sonnet 별도 스킬 파일 생성"
type: issue
date: 2026-04-25
status: completed
agent: 개발
branch: bui-73
pr: https://github.com/claude-studio/built/pull/56
week: 3
tags: [skill, model-variant, run-opus, run-sonnet]
keywords: [run opus sonnet 스킬 모델 변형 SKILL model 주입 run-request]
---

## 목표

README.md와 BUILT-DESIGN.md §1에 명시된 /built:run-opus, /built:run-sonnet 명령어를 위한 별도 스킬 파일(SKILL.md) 생성.
기존 run/SKILL.md는 변형만 언급했고 실제 skills/run-opus/, skills/run-sonnet/ 디렉토리가 없었음.

## 구현 내용

- skills/run-opus/SKILL.md 생성: claude-opus-4-5 모델로 run 실행하는 스킬
- skills/run-sonnet/SKILL.md 생성: claude-sonnet-4-5 모델로 run 실행하는 스킬
- /built:run-opus <feature>, /built:run-sonnet <feature> 명령 동작 문서화
- run-request.json에 model 필드 주입 방법 명시 (mkdir + echo + node scripts/run.js)
- 기존 run/SKILL.md와 구조/패턴 일관성 유지

참고: plugins/built/skills는 ../../skills 심볼릭 링크이므로 실제 파일은 skills/ 하위에 커밋됨.

## 결정 사항

- 별도 SKILL.md 파일을 각 모델 변형 디렉토리에 생성 (단일 파일 내 분기 방식 대신).
  이유: /built:run-opus, /built:run-sonnet이 독립적인 명령어로 README에 명시되어 있고, 스킬 시스템이 디렉토리 단위로 명령어를 등록하기 때문.

## 발생한 이슈

없음 (1회 리뷰 통과)

## 완료 기준 충족 여부

- skills/run-opus/SKILL.md 생성 ✓
- skills/run-sonnet/SKILL.md 생성 ✓
- /built:run-opus, /built:run-sonnet 명령 동작 문서화 ✓
- run-request.json model 필드 주입 방법 명시 ✓
- 기존 run/SKILL.md 패턴 일관성 유지 ✓

## 재발 방지 포인트

- plugins/built/skills는 심볼릭 링크이므로 실제 파일은 skills/ 디렉토리에 작성해야 함. plugins/ 경로로 직접 커밋하면 심볼릭 링크 대상이 달라질 수 있음.
- 모델 변형 스킬 추가 시 README.md와 BUILT-DESIGN.md §1의 명령어 목록과 일치하는지 확인 필요.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-73",
  "name": "[Skill] /built:run-opus, /built:run-sonnet 별도 스킬 파일 생성",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/56"},
  "actionStatus": "CompletedActionStatus"
}
```
