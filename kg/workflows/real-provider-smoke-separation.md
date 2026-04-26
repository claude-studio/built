---
id: WF-8
title: Real Provider Smoke Separation
type: workflow
date: 2026-04-26
validated_by: [BUI-118, BUI-119, BUI-129, BUI-174]
tags: [provider, smoke, ci, codex, validation, artifact]
---

## 패턴 설명

real provider smoke는 기본 테스트와 분리한다.
기본 `npm test`는 fake/offline 회귀 테스트만 실행하고, 인증, 비용, 네트워크, 로컬 app-server 상태에 의존하는 smoke는 명시적 opt-in 환경 변수 또는 전용 npm script로만 실행한다.

## 언제 사용하나

- Claude 또는 Codex real provider smoke 스크립트를 추가하거나 수정할 때
- `package.json` 테스트 script와 CI job 구성을 바꿀 때
- provider availability, login, app-server, sandbox, timeout, model response 실패 메시지를 바꿀 때
- `docs/smoke-testing.md`의 real provider 검증 절차를 갱신할 때

## 단계

1. 기본 회귀 경로를 먼저 확인한다.
   `npm test`는 외부 provider, login, 네트워크, 비용이 없어도 통과해야 한다.
2. smoke script는 opt-in 환경 변수가 없을 때 skip 메시지를 출력하고 exit 0으로 종료하게 둔다.
   skip도 `.built/runtime/smoke/<id>/summary.json`에 `skipped: true`, `success: true`로 기록한다.
3. real smoke용 npm script는 환경 변수를 함께 설정한다.
   사용자는 `npm run test:smoke:*`로 명시적으로 비용/인증 의존 경로를 선택한다.
4. 실제 provider 실행 전에 availability/login preflight를 수행한다.
   Codex 경로는 `checkLogin()`으로 CLI 미설치, app-server 미지원, 인증 실패를 빠르게 분리한다.
5. do/iter phase smoke는 `sandbox=workspace-write` 전제를 확인한다.
   read-only sandbox는 파일 변경 phase의 smoke로 사용하지 않는다.
6. 실패 출력에는 문서와 일치하는 `원인축:` 키워드를 포함한다.
   기준 축은 `provider_unavailable`, `app-server`, `인증(auth)`, `sandbox`, `timeout`, `model_response`다.
   artifact에는 `provider_unavailable`, `app_server`, `auth`, `sandbox`, `timeout`, `model_response`, `unknown` taxonomy 값을 기록한다.
7. 산출물 검증 실패는 provider 실행 실패와 분리한다.
   예를 들어 `do-result.md` 미생성 또는 frontmatter 구조 불일치는 `model_response` 축으로 안내한다.
8. smoke 종료 전 summary artifact를 저장한다.
   `provider`, `phase`, `model`, `duration_ms`, `skipped`, `success`, `failure`, `verification`을 포함하고, 저장 전 `sanitizeJson()`으로 secret/token/홈 경로/session 값을 redaction한다.
9. 문서와 script를 함께 갱신한다.
   `docs/smoke-testing.md`의 실행 명령, 전제 조건, 실패 원인 표가 실제 script와 맞아야 한다.
   artifact schema가 바뀌면 `docs/contracts/smoke-artifact.md`도 함께 갱신한다.
10. Reviewer handoff에는 기본 테스트 결과, opt-in skip 동작, real smoke 실행 방법, 실패 축 변경 여부, artifact 경로와 redaction 테스트 결과를 포함한다.

## 주의사항

- real provider smoke를 기본 CI나 `npm test`에 넣으면 로컬 인증, provider availability, 네트워크 상태가 기본 회귀 신호를 오염시킨다.
- npm script가 opt-in entrypoint더라도 그 script 자체를 기본 test script에서 호출하면 안 된다.
- provider failure taxonomy의 구조화 이벤트와 smoke 사용자 메시지는 목적이 다르다.
  smoke에서는 운영자가 즉시 조치할 수 있게 `원인축:` 키워드를 명시하고, 표준 event/file contract는 별도 provider failure 계약을 따른다.
- smoke artifact는 local runtime evidence다.
  `.built/runtime/smoke/`는 gitignore 대상으로 유지하고 외부 telemetry로 전송하지 않는다.
- artifact에는 raw debug dump나 private environment value를 저장하지 않는다.
  새 필드를 추가할 때는 `scripts/smoke-artifact.js`의 redaction 테스트를 먼저 확장한다.
- timeout은 자동으로 인증 문제로 추정하지 않는다.
  signal 또는 status 기반 timeout 분기를 유지해 네트워크/실행 지연과 blocked 설정 문제를 구분한다.
