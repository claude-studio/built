---
id: BUI-8
title: "[Week 2] [Phase1] result-to-markdown.js 구현"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-8-result-to-markdown
pr: https://github.com/claude-studio/built/pull/6
week: 2
tags: [phase1, result-to-markdown, pipeline]
keywords: [result, markdown, 구현, pipeline, do, frontmatter, 변환]
---

## 목표

pipeline-runner.js의 stream-json result 이벤트를 받아 do-result.md (frontmatter + 본문) 형식으로 변환 저장.
BUILT-DESIGN.md §8 기준.

## 구현 내용

- `src/result-to-markdown.js`: convert(result, outputPath) 함수 구현
- `test/result-to-markdown.test.js`: 단위 테스트 22개 전부 통과
- frontmatter 필드 6개: feature_id, status, model, cost_usd, duration_ms, created_at
- 본문: claude 응답 전문
- src/frontmatter.js stringify() 사용
- outputPath 중간 디렉토리 자동 생성

## 결정 사항

- status: subtype(success→completed, error→failed) 자동 파생, result.status 명시 지정 시 우선
- cost_usd: result.cost_usd 우선, result.total_cost_usd fallback
- duration_ms: 직접 제공 우선, started_at/updated_at 차이 계산 fallback
- created_at: created_at → updated_at → 현재 시각 fallback 체계 적용

## 발생한 이슈

없음. 1회차 리뷰 통과.

## 완료 기준 충족 여부

1. convert(result, outputPath) 함수 구현 (입력 유효성 검사 포함) ✓
2. stream-json result 이벤트 → frontmatter + 본문 형식 do-result.md 작성 ✓
3. frontmatter 필드 6개: feature_id, status, model, cost_usd, duration_ms, created_at ✓
4. 본문: claude 응답 전문 ✓
5. src/frontmatter.js stringify() 사용 ✓
6. 외부 npm 패키지 없음 ✓
7. 단위 테스트 22개 전부 통과 ✓

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-8",
  "name": "[Week 2] [Phase1] result-to-markdown.js 구현",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/6"},
  "actionStatus": "CompletedActionStatus"
}
```
