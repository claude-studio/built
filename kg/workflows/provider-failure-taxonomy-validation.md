---
id: WF-6
title: Provider Failure Taxonomy Validation
type: workflow
date: 2026-04-26
validated_by: [BUI-132, BUI-200, BUI-212]
tags: [provider, failure, contracts, validation, regression]
---

## 패턴 설명

provider 실패 표현을 바꿀 때는 raw error, 사용자-facing 메시지, runner 판단 필드를 분리해 검증한다.
핵심은 provider가 표준 `failure` 객체를 만들고, writer/runner가 이를 `logs/<phase>.jsonl`, `progress.json`, `state.json` 계층에 맞게 기록하는지 확인하는 것이다.

## 언제 사용하나

- `src/providers/failure.js`의 taxonomy, classifier, sanitize 규칙을 바꿀 때
- Claude 또는 Codex provider의 auth/config/sandbox/timeout/model response 실패 경로를 수정할 때
- Claude `result(success)` 본문이 권한 승인 대기, 파일 생성 승인 요청, 도구 실행 미완료를 나타내는지 감지할 때
- Claude stream-json의 `tool_result` 또는 `user` 이벤트가 approval denial을 반복해 terminal result까지 도달하지 않는 loop를 처리할 때
- Claude terminal `result.is_error=true` 또는 `subtype=error` 처리와 process exit code 0의 우선순위를 바꿀 때
- `src/providers/event-normalizer.js`의 error event fallback 또는 terminal ordering을 바꿀 때
- `src/providers/standard-writer.js`, `src/progress-writer.js`, `scripts/run.js`의 failure 기록/승격 경로를 바꿀 때
- `scripts/status.js` 또는 `scripts/report.js`의 failure action/next_action 출력 경로를 바꿀 때
- `docs/contracts/provider-events.md` 또는 `docs/contracts/file-contracts.md`의 error/last_failure 계약을 바꿀 때

## 단계

1. 관련 계약과 KG를 확인한다:
   `docs/contracts/provider-events.md`, `docs/contracts/file-contracts.md`,
   `kg/decisions/provider-event-normalization-and-standard-writer.md`,
   `kg/decisions/provider-failure-taxonomy-and-message-boundary.md`.
2. 실패 유형을 `auth`, `config`, `sandbox`, `timeout`, `interrupted`, `provider_unavailable`, `model_response`, `runner_normalize`, `runner_io`, `unknown` 중 하나로 분류한다.
3. 새 실패 경로는 `user_message`, `action`, `retryable`, `blocked`, `code`, `debug_detail` 기대값을 먼저 정한다.
4. provider raw error를 사용자 메시지에 직접 넣지 않고 `sanitizeDebugDetail()`을 거친 `debug_detail`로만 보존한다.
5. error event는 `message`, `retryable`, `failure`를 함께 포함해 하위 호환을 유지한다.
6. `progress.json.last_error`는 raw provider message가 아니라 `failure.user_message` 또는 표준 fallback user message를 우선하는지 확인한다.
7. `progress.json.last_failure`에는 debug detail을 제외한 요약만 기록되는지 확인한다.
8. `state.json.last_failure`는 provider가 직접 쓰지 않고 runner가 progress에서 승격하는지 확인한다.
9. `scripts/status.js`는 `last_failure.action`을 `next_action`으로 보여주고, `scripts/report.js`와 phase result Markdown도 같은 사용자 조치를 노출하는지 확인한다.
10. status 실패 요약에는 `provider`, `phase`, `model`, `failure.kind/code`, `action(next_action)`, `retryable`, `blocked`가 보이고 `debug_detail`과 `raw_provider`가 숨겨지는지 확인한다.
11. status에서 usage/cost telemetry가 없으면 실패나 0으로 보이지 않고 `미제공`으로 표시되는지 확인한다.
12. `logs/<phase>.jsonl`에는 표준 error event가 남고 terminal event 이후 추가 event가 없는지 확인한다.
13. Claude 권한 승인 대기 패턴은 raw adapter, event normalizer, progress writer 세 경로에서 같은 `claude_permission_request` code로 수렴하는지 확인한다.
14. status에서 `claude_permission_request`는 generic provider action 대신 `/built:run-codex <feature>` 재실행 또는 `.claude/settings.json` allow rule 추가 선택지를 한글 remediation으로 보여주는지 확인한다.
15. Claude `tool_result` 또는 `user` approval denial 반복은 terminal result를 기다리지 않고 synthetic terminal error, `success=false`, `failure.code=claude_permission_request`로 수렴하는지 확인한다.
16. approval loop 또는 timeout으로 provider를 종료할 때 process group 종료를 시도하고, 실패 시 child kill fallback이 있는지 확인한다.
17. Claude terminal `result.is_error=true` 또는 `subtype=error`는 process exit code가 0이어도 provider 반환값이 `success=false`가 되는지 확인한다.
18. terminal result error에 failure 객체가 없으면 `model_response` failure가 합성되고, failure 객체가 있으면 기존 failure를 우선하는지 검증한다.
19. Do 단계 회귀는 `runPipeline` 결과가 `success=false`이고 `progress.json.last_failure.code`가 유지되는지 검증한다.
20. failure가 provider에서 반환된 뒤 `state.json.status=failed`와 lock release는 runner failure/finally 경로로 처리되는지 확인한다.
21. 테스트는 최소 `providers-failure`, 변경 provider 테스트, `providers-normalizer`, `progress-writer`, `pipeline-runner`, `file-contracts`, `status`를 함께 실행한다.
22. retryable 의미 변경이 있으면 자동 retry trigger인지 단순 분류 신호인지 리뷰 코멘트와 KG에 명시한다.

## 주의사항

- `last_error`는 문자열 하위 호환 필드다. 구조화 정보를 넣기 위해 의미를 바꾸지 않는다.
- `last_error`에는 raw provider message보다 safe user message를 우선한다.
  raw message가 필요하면 sanitize된 `debug_detail`과 로그 계층에서 확인한다.
- `retryable=true`는 자동 재실행 허가가 아니다.
  자동 retry가 붙으면 retry cap과 failure kind별 정책을 별도 계약으로 둔다.
- `blocked=true`는 사용자의 설정, 인증, 권한, 환경 조치가 필요하다는 신호로 사용한다.
- `action`은 사람이 볼 다음 조치 문장이다.
  status/report에 노출되므로 secret 후보, private environment value, 실제 홈 경로, raw stderr를 포함하지 않는다.
- `provider_unavailable`은 binary 없음, app-server 미지원, broker busy/start 실패를 모두 담을 수 있으므로 `code`와 `action`으로 세분화한다.
- state/progress에는 `debug_detail`, raw stderr, token 후보, private environment value를 기록하지 않는다.
- status도 사용자-facing 화면이므로 `debug_detail`과 `raw_provider`를 직접 보여주지 않는다.
  긴 `last_error` 객체는 safe field만 한 줄로 축약하고 원문 진단은 logs 계층에서 확인한다.
- usage/cost 값이 없으면 telemetry 미제공 상태다.
  이를 실패, 0 비용, 0 token처럼 해석하게 만들지 않는다.
- `unknown` fallback은 실패를 숨기는 용도가 아니다.
  debug detail과 후속 taxonomy 추가 후보를 남겨야 한다.
- `result(success)` 이벤트라도 권한 승인 대기 본문이면 terminal success로 취급하지 않는다.
  headless run에서 사용자 승인 대기는 산출물 미생성 상태이므로 `blocked=true`, `retryable=false` failure로 기록한다.
- stream 중간의 tool approval denial 반복은 terminal result가 없을 수 있으므로 provider stream 처리 단계에서 감지한다.
  이때 명령 자동 허용으로 우회하지 말고 `claude_permission_request` blocked failure로 종료한다.
- provider는 `state.json`이나 lock을 직접 정리하지 않는다.
  `success=false`와 표준 failure event를 반환해 runner가 lifecycle cleanup을 수행하게 한다.
- process exit code 0은 provider protocol 성공의 충분조건이 아니다.
  terminal event의 `is_error`, `subtype=error`, `failure` 신호가 있으면 runner 반환값과 writer artifact가 모두 실패로 수렴해야 한다.
