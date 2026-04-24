---
id: BUI-14
title: "[Week 3] [Phase2] /built:check 구현"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-14-check-skill
pr: https://github.com/claude-studio/built/pull/15
week: 3
tags: [phase2, check, json-schema, pipeline]
keywords: [check, skill, 스킬, json, schema, 구조화, 응답, pipeline, 구현]
---

## 목표

/built:check 스킬 구현 - --json-schema로 구조화 응답 강제 + check-result.md 생성.
pipeline-runner.js의 jsonSchema 모드를 활용해 Check 단계 프롬프트 실행 후 결과를 파싱해 저장.

## 구현 내용

- skills/check/SKILL.md: Claude Code 스킬 형식으로 작성
- scripts/check.js: pipeline-runner.js runPipeline() 호출, JSON Schema 옵션 사용
- pipeline-runner.js에 jsonSchema 옵션 추가: --bare -p --output-format json --json-schema 모드로 실행, structured_output 파싱해 structuredOutput 반환
- .built/features/<feature>/check-result.md 생성 (frontmatter status + 검토 결과 섹션 + 수정 필요 항목 목록)
- JSON Schema: {status: needs_changes|approved, issues: string[], summary: string}
- MULTICA_AGENT_TIMEOUT 환경변수 기반 타임아웃 지원
- 단위 테스트 15개 포함

## 결정 사항

- status 값을 초기 구현에서 'passed'로 작성했으나 BUILT-DESIGN.md §8 스펙이 'approved'임을 리뷰에서 지적받아 수정
- pipeline-runner.js에 jsonSchema 모드 추가 (기존 stream-json 모드 유지하며 확장)

## 발생한 이슈

- 1회차 리뷰 반려: check-result.md frontmatter status 값이 'passed'로 구현됐으나 BUILT-DESIGN.md §8에서는 'approved'로 명시. scripts/check.js, skills/check/SKILL.md, test/check.test.js 전범위 수정 후 2회차 통과.

## 완료 기준 충족 여부

1. skills/check/SKILL.md 작성 (Claude Code 스킬 형식) - 충족
2. scripts/check.js 구현: pipeline-runner.js runPipeline() 호출 - 충족
3. --json-schema 플래그로 구조화 응답 강제 - 충족
4. check-result.md frontmatter: status: approved | needs_changes - 충족 (2회차 수정)
5. .built/features/<feature>/check-result.md 저장 - 충족
6. 외부 npm 패키지 없음 - 충족
7. MULTICA_AGENT_TIMEOUT 타임아웃 지원 - 충족

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-14",
  "name": "[Week 3] [Phase2] /built:check 구현",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/15"},
  "actionStatus": "CompletedActionStatus"
}
```
