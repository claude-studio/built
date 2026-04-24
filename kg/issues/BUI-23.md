---
id: BUI-23
title: "[Week 4] [Phase3] /built:validate + /built:hooks-inspect 구현"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-23-validate-hooks
pr: https://github.com/claude-studio/built/pull/24
week: 4
tags: [phase3, validate, hooks-inspect, cli]
---

## 목표

config.json/hooks.json 유효성 검증 커맨드(/built:validate)와 활성 훅 설정 출력 커맨드(/built:hooks-inspect)를 구현한다. BUILT-DESIGN.md §9 기준.

## 구현 내용

- scripts/validate.js: config.json 필수 필드/타입 체크, hooks.json pipeline 구조 검증, 오류 시 사람이 읽을 수 있는 메시지 출력
- scripts/hooks-inspect.js: 이벤트별 활성 훅 목록, 출처(team/local) 표시, --json 플래그 지원
- skills/validate/SKILL.md: /built:validate 트리거 문서화, 사용법 및 검증 항목 목록
- skills/hooks-inspect/SKILL.md: /built:hooks-inspect 트리거 문서화, 사용법 및 출력 형식 설명
- 단위 테스트 77개 (validate: 51개, hooks-inspect: 26개) 전부 통과

## 결정 사항

- --json 플래그 지원: 다른 도구와 파이프라인 연결을 고려해 기계 판독 가능한 출력 옵션 추가
- 출처(team/local) 표시: 훅 설정의 우선순위 파악을 위해 출처 구분 표시

## 발생한 이슈

없음 (1회차 리뷰 통과)

## 완료 기준 충족 여부

1. /built:validate 구현 — 충족 (config.json 필수 필드/타입 체크, hooks.json pipeline 구조 검증, 오류 메시지)
2. /built:hooks-inspect 구현 — 충족 (이벤트별 훅 목록, 출처 표시, --json 플래그)
3. skills/validate/SKILL.md 작성 — 충족
4. skills/hooks-inspect/SKILL.md 작성 — 충족
5. 단위 테스트 77개 전부 통과 — 충족

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-23",
  "name": "[Week 4] [Phase3] /built:validate + /built:hooks-inspect 구현",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/24"},
  "actionStatus": "CompletedActionStatus"
}
```
