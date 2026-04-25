---
id: BUI-77
title: "[도그푸딩] built:validate 실패: token-generation-api"
type: issue
date: 2026-04-25
status: completed
agent: 개발
branch: bui-77
pr: https://github.com/claude-studio/built/pull/49
week: 4
tags: [dogfooding, validate, ux]
keywords: [validate, init, built, 디렉토리, 안내, UX]
---

## 목표

init 실행 전 validate를 실행했을 때 적절한 안내 메시지를 제공하도록 UX 개선.

## 구현 내용

scripts/validate.js에 .built/ 디렉토리 존재 여부 사전 체크 로직 추가.
.built/ 디렉토리가 없을 경우 "Validation failed" 대신 '.built/ 디렉토리가 없습니다. 먼저 /built:init 을 실행하세요.' 안내 메시지 출력 후 조기 종료.
fs.existsSync 표준 라이브러리만 사용하여 의존성 없음.

## 결정 사항

- `fs.existsSync`로 .built/ 디렉토리 유무를 먼저 체크하는 단순 guard 패턴 채택.
- 기존 validate 로직 전체를 건드리지 않고 앞에 early-return만 추가함으로써 기존 기능 영향 최소화.

## 발생한 이슈

없음. 1회차 리뷰 통과.

## 완료 기준 충족 여부

- [x] .built/ 디렉토리 미존재 시 사용자 친화적 안내 메시지 출력
- [x] Validation failed 대신 명확한 메시지 제공
- [x] 기존 validate 기능 정상 동작 유지

## 재발 방지 포인트

- init 전 단계에서 호출되는 스크립트(validate, list 등)는 .built/ 존재 여부를 먼저 체크해야 한다.
- 신규 스크립트 작성 시 "전제 조건 미충족" 케이스를 early-return + 안내 메시지로 처리하는 패턴을 일관되게 적용할 것.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-77",
  "name": "[도그푸딩] built:validate 실패: token-generation-api",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/49"},
  "actionStatus": "CompletedActionStatus"
}
```
