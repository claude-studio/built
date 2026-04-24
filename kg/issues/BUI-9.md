---
id: BUI-9
title: "[Week 2] [Phase1] frontmatter.js 구현"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-9-frontmatter
pr: https://github.com/claude-studio/built/pull/5
week: 2
tags: [phase1, frontmatter, parser]
keywords: [frontmatter, parser, yaml, 파서, 구현, 표준, 라이브러리]
---

## 목표

YAML frontmatter 최소 파서 구현. 외부 패키지 없이 Node.js 표준 라이브러리만 사용.
BUILT-DESIGN.md §5 기준.

## 구현 내용

- `src/frontmatter.js`: parse/stringify 두 함수 구현
- `test/frontmatter.test.js`: 단위 테스트 33개 전부 통과
- 지원 타입: 문자열, 숫자, boolean, null, inline 배열 ([a, b, c]), block 배열 (- item), 최대 2단계 객체
- parse(text): --- 블록 파싱 후 { data, content } 반환
- stringify(data, content): data 객체 + 본문을 frontmatter 포맷으로 직렬화

## 결정 사항

외부 yaml 패키지(js-yaml 등) 미사용. built의 핵심 원칙(외부 deps 0)에 따라 직접 구현.
최대 2단계 객체 제한으로 파서 복잡도 최소화.

## 발생한 이슈

없음. 1회차 리뷰 통과.

## 완료 기준 충족 여부

1. parse(text) - frontmatter 추출 후 { data, content } 반환 ✓
2. stringify(data, content) - data + 본문 직렬화 ✓
3. 지원 타입 전체 커버 ✓
4. 외부 npm 패키지 없음 ✓
5. 단위 테스트 33개 전부 통과 ✓

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-9",
  "name": "[Week 2] [Phase1] frontmatter.js 구현",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/5"},
  "actionStatus": "CompletedActionStatus"
}
```
