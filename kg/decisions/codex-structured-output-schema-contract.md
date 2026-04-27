---
id: ADR-26
title: Codex structured output schema 계약
type: decision
date: 2026-04-27
status: accepted
context_issue: BUI-342
tags: [architecture, provider, codex, app-server, structured-output, schema]
---

## 컨텍스트

BUI-342에서 실제 Codex `plan_synthesis` smoke가 `invalid_json_schema` 오류로 실패했다.
runner가 `PLAN_SYNTHESIS_SCHEMA`를 문자열로 받은 뒤 Codex provider에 `{ schema: jsonSchema }` wrapper 형태로 전달했고, provider는 이를 app-server에 그대로 넘겼다.

Codex app-server는 `outputSchema` 값 자체가 JSON Schema object이기를 기대한다.
wrapper가 전달되면 최상위 schema의 `type`이 `object`가 아니라고 판단되어 `plan_synthesis`가 실패하고, 같은 structured output 경로를 사용하는 `check` phase도 회귀 위험을 가진다.

## 결정

Codex provider 경계에서 `outputSchema`를 JSON Schema object로 정규화한다.
입력이 string이면 JSON으로 parse하고, object이면 그대로 검증하되, app-server 전송 값은 항상 JSON Schema object 자체로 둔다.

`{ schema: ... }` wrapper는 Codex app-server 전송 계약으로 금지한다.
해당 wrapper shape가 provider에 들어오면 명확한 오류로 실패시켜 call site drift를 빨리 드러낸다.

Codex structured output schema는 app-server strict schema 조건을 만족해야 한다.
최상위 schema와 중첩 object schema는 `type: "object"`, `additionalProperties: false`, 모든 `properties` key의 `required` 포함을 지켜야 한다.

Codex provider는 structured output 성공 결과의 최종 JSON text를 parse해 `structuredOutput`으로 반환한다.
phase script는 provider별 raw text 차이를 직접 처리하지 않고 `runPipeline()` 반환 계약을 사용한다.

## 근거

- app-server가 기대하는 shape와 runner가 만든 wrapper shape가 다르면 실제 provider smoke에서만 실패한다.
  provider 경계에서 정규화와 검증을 고정하면 call site가 늘어도 같은 계약을 유지할 수 있다.
- wrapper를 묵인하면 잘못된 schema가 app-server까지 늦게 전달되어 release-blocking smoke 실패로 드러난다.
  빠른 실패가 원인 파악과 테스트 작성에 유리하다.
- strict schema 요구사항은 현재 Codex app-server structured output 계약의 일부다.
  이를 phase script마다 문서 지식으로만 남기면 새 schema 추가 때 반복 회귀가 생긴다.
- `structuredOutput`을 provider 반환 계약에 포함하면 `plan_synthesis`, `check` 같은 phase가 provider-neutral 산출물 계약을 유지한다.
- provider가 파일을 직접 쓰지 않는 ADR-3 경계를 유지하면서도 structured output 사용 phase가 같은 runner 결과를 소비할 수 있다.

## 결과

- `plan_synthesis`와 `check`는 Codex provider에서도 구조화 결과를 받을 수 있다.
- `src/pipeline-runner.js`는 Claude `jsonSchema`와 Codex `outputSchema` 차이를 흡수하는 경계로 남는다.
- 새 Codex structured output phase는 schema unit test에서 app-server 전달 값의 `type === "object"`와 strict schema 조건을 확인해야 한다.
- 잘못된 JSON string, wrapper schema, strict schema 미충족은 provider 실행 전에 명확한 오류로 종료된다.
- real Codex smoke는 기본 테스트에 묶지 않고 opt-in evidence로 남긴다.

## 대안

- phase script에서 Codex 전용 `outputSchema` object를 직접 만들게 한다: `plan_synthesis`, `check`, 후속 phase마다 provider별 분기가 생겨 선택하지 않았다.
- provider가 `{ schema: ... }` wrapper를 자동으로 풀어준다: 기존 잘못된 call site를 숨기고 app-server 계약을 흐리므로 선택하지 않았다.
- app-server 오류를 받아 fallback text parse를 시도한다: structured output 계약 실패를 성공처럼 보이게 만들 수 있어 선택하지 않았다.
- real Codex smoke를 기본 `npm test`에 포함한다: 인증, app-server, 로컬 runtime 상태 의존성 때문에 기본 테스트 안정성을 해쳐 선택하지 않았다.

## 되돌릴 조건

Codex app-server가 wrapper shape를 공식 지원하거나 strict schema 조건을 완화한다면 provider 검증 규칙을 재검토할 수 있다.
그 경우에도 `runPipeline()`이 provider별 schema API 차이를 흡수하고 phase script는 provider-neutral `structuredOutput` 계약을 소비한다는 원칙은 유지한다.
