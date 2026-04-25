---
id: BUI-85
title: "[도그푸딩] built:validate 실패: http-request-capture"
type: issue
date: 2026-04-25
status: completed
agent: 개발
branch: bui-85
pr: https://github.com/claude-studio/built/pull/50
week: 4
tags: [dogfooding, validate, bugfix]
keywords: [validate hooks 이벤트 whitelist before_check before_report VALID_EVENTS]
---

## 목표

validate.js의 허용 이벤트 목록에 before_check, before_report를 추가하여
http-request-capture feature의 STEP 1 (validate) 통과 보장.

## 구현 내용

scripts/validate.js의 VALID_EVENTS 배열에 before_check, before_report 추가.

변경 전: ['before_do', 'after_do', 'after_check', 'after_report']
변경 후: ['before_do', 'after_do', 'before_check', 'after_check', 'before_report', 'after_report']

## 결정 사항

validate.js의 이벤트 whitelist를 확장하는 방향으로 결정.
대안으로 hooks.json 정리(cleanup)를 고려했으나, CLAUDE.md STEP 5 지침에 before_check, before_report가 명시되어 있으므로 validate.js가 지침을 따르도록 수정하는 것이 올바른 방향.

## 발생한 이슈

이전 feature(token-generation-api) 정리 시 hooks.json cleanup이 불완전하게 이루어져 before_check, before_report가 잔존.
CLAUDE.md와 validate.js 간 허용 이벤트 목록 불일치가 근본 원인.

## 완료 기준 충족 여부

- validate.js의 유효 이벤트 목록에 before_check, before_report 추가: 완료
- webhooks 프로젝트에서 Validation passed 확인: 완료
- 기존 유효 이벤트(before_do, after_do, after_check, after_report) 정상 동작 유지: 완료

## 재발 방지 포인트

- CLAUDE.md의 hooks 설치 지침과 validate.js의 VALID_EVENTS를 항상 동기화해야 함. 새 이벤트 추가/제거 시 두 곳을 함께 수정.
- feature cleanup 시 hooks.json을 초기화하거나, 다음 feature 시작 시 hooks.json의 잔존 이벤트를 validate 전에 정리하는 절차가 필요.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-85",
  "name": "[도그푸딩] built:validate 실패: http-request-capture",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/50"},
  "actionStatus": "CompletedActionStatus"
}
```
