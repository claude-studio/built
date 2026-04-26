---
id: ADR-20
title: real provider smoke artifact 계약
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-174
tags: [ops, provider, smoke, artifact, redaction, evidence]
---

# Real Provider Smoke Artifact 계약

## 컨텍스트

real Codex smoke는 인증, 네트워크, local app-server, sandbox, model response에 의존한다.
실패가 발생했을 때 stdout만 남으면 다음 실행과 원인축을 비교하기 어렵고, issue/comment로 전달할 수 있는 요약도 매번 달라진다.

동시에 smoke 결과에는 토큰, 세션 식별자, 로컬 홈 경로, provider 내부 debug dump 같은 민감 정보가 섞일 수 있다.
따라서 smoke evidence는 저장하되, 저장 위치와 schema, redaction 경계를 명시해야 한다.

## 결정

real provider smoke 실행 결과는 `.built/runtime/smoke/<id>/summary.json`에 summary artifact로 저장한다.

- 현재 schema version은 `1.0.0`이다.
- 필수 필드는 `provider`, `phase`, `model`, `duration_ms`, `skipped`, `success`, `failure`, `verification`이다.
- failure taxonomy는 `provider_unavailable`, `app_server`, `auth`, `sandbox`, `timeout`, `model_response`, `unknown`으로 고정한다.
- 실패 시 사용자가 issue/comment에 붙일 수 있는 짧은 한글 요약을 출력한다.
- 저장 전 `scripts/sanitize.js`의 `sanitizeJson()`을 적용한다.
- `.built/runtime/smoke/`는 `.gitignore` 대상이며 외부 telemetry로 전송하지 않는다.
- 기본 `npm test`와 CI-ready offline provider test group에서는 artifact 생성을 강제하지 않는다.

세부 스키마는 `docs/contracts/smoke-artifact.md`가 기준이다.

## 근거

- summary artifact는 real smoke 실패의 재현 단서를 남기면서도 raw debug dump보다 노출면이 작다.
- `skipped` 결과도 저장하면 opt-in 환경 변수 누락과 실제 provider 실패를 구분할 수 있다.
- failure taxonomy를 smoke 사용자 메시지와 artifact에 함께 남기면 Reviewer/Finisher/Recorder가 같은 원인축으로 판단할 수 있다.
- `sanitizeJson()` 재사용은 redaction 기준을 provider event, hook context, smoke artifact 사이에서 분기시키지 않는다.
- 로컬 `.built/runtime/smoke/` 저장은 north-star의 관측 가능성 요구를 충족하면서 외부 telemetry 전송 비범위를 지킨다.

## 결과

- Codex plan/do smoke는 성공, 실패, skip 결과를 동일 schema로 남긴다.
- 사용자는 실패 시 한글 요약과 `summary.json`을 issue/comment 근거로 붙일 수 있다.
- `docs/smoke-testing.md`와 `docs/contracts/smoke-artifact.md`가 smoke evidence 계약의 운영 기준이 되었다.
- secret redaction 테스트가 smoke artifact 경로의 회귀 방어선이 되었다.

## 대안

- stdout 로그만 남긴다: 실행별 비교와 재현성이 약하고 failure taxonomy가 구조화되지 않아 선택하지 않았다.
- raw provider debug dump 전체를 저장한다: 디버깅 정보는 많지만 secret/token/local path 노출 위험이 커 선택하지 않았다.
- artifact를 외부 telemetry로 전송한다: 중앙 관측성은 좋아지지만 이번 이슈의 비범위이며 민감정보 경계가 넓어져 선택하지 않았다.
- 기본 `npm test`에서 smoke artifact 생성을 강제한다: offline 회귀 신호와 real provider 의존성을 섞게 되어 선택하지 않았다.

## 되돌릴 조건

별도 evidence archive가 도입되어 redaction, retention, access control, schema migration이 문서화되면 저장 위치를 재검토할 수 있다.
그 경우에도 기본 offline 테스트와 real smoke opt-in 경계, secret redaction, failure taxonomy 기록은 유지해야 한다.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Decision",
  "identifier": "ADR-20",
  "name": "real provider smoke artifact 계약",
  "about": "real provider smoke summary artifact schema and redaction policy",
  "isBasedOn": {"@type": "CreativeWork", "name": "BUI-174"}
}
```
