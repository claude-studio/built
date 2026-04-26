---
id: ADR-9
title: provider failure taxonomy와 메시지 경계
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-132
tags: [architecture, provider, failure, taxonomy, contracts, security, redaction]
---

## 컨텍스트

Claude 외에 Codex provider가 추가되면서 실패 원인이 인증, 설정, sandbox, timeout, model 응답, runner normalize, runner IO 중 어디인지 구분할 필요가 생겼다.
이 구분이 없으면 운영자는 `do.js exited with code 1`이나 provider raw stderr만 보고 조치해야 하고, 사용자-facing 메시지와 debug detail이 섞여 secret 노출 위험도 커진다.

기존 provider event normalize와 standard writer 계약은 provider raw event를 표준 이벤트로 바꾸고 writer가 파일을 담당한다는 경계를 세웠다.
BUI-132는 이 경계를 유지하면서 error event와 `state.json`/`progress.json` 실패 표현을 구조화해야 했다.

## 결정

표준 provider `error` 이벤트에 공통 `failure` 객체를 추가한다.
`failure`는 `kind`, `code`, `user_message`, `action`, `retryable`, `blocked`, `debug_detail`, `raw_provider`를 가진다.

`failure.kind`의 시작 taxonomy는 아래 값으로 둔다.

- `auth`
- `config`
- `sandbox`
- `timeout`
- `interrupted`
- `provider_unavailable`
- `model_response`
- `runner_normalize`
- `runner_io`
- `unknown`

기존 `message`와 `retryable`은 하위 호환 필드로 유지하고, `failure.user_message`와 `failure.retryable`에서 파생한다.
`last_error`는 문자열로 유지하며, 구조화된 최신 실패 정보는 `last_failure`에 둔다.

provider raw error는 `failure.debug_detail`에만 sanitize 후 남긴다.
`progress.json.last_failure`와 `state.json.last_failure`에는 `kind`, `code`, `retryable`, `blocked`, `action` 같은 사용자 조치와 orchestration 판단 필드만 둔다.
`failure.action`은 status/report의 사용자-facing 다음 조치로 노출되며, raw provider 메시지는 포함하지 않는다.

BUI-175 이후 provider runtime redaction은 `sanitizeDebugDetail()`을 독립 방어 계층으로 유지한다.
GitHub token, provider API key 환경변수 값, Telegram bot token, 명시적 `chat_id`, 실제 홈 경로는 provider error message, app-server notification, `failure.debug_detail`, `logs/<phase>.jsonl`, smoke artifact 후보에 남기기 전에 sanitize한다.
홈 경로는 디버그 방향을 유지하기 위해 `~/`로 축약하고, secret 값은 placeholder로 치환한다.

## 근거

- provider별 자유 형식 error payload를 허용하면 file/event contract가 provider마다 갈라진다.
- `last_error`를 객체로 바꾸면 기존 status 표시, 테스트, 외부 사용자 기대가 깨질 수 있다.
- `blocked`와 `retryable`은 서로 다른 판단이다.
  인증, 설정, sandbox 문제는 사용자가 조치할 때까지 blocked이고, timeout이나 model response는 즉시 blocked로 보지 않는다.
- raw provider stderr와 app-server 오류는 운영 디버그에는 필요하지만 사용자 메시지로 적합하지 않다.
  `user_message`와 `action`을 분리하면 사용자에게 다음 조치를 직접 보여줄 수 있다.
- provider notification error도 event message와 artifact 경로로 흘러갈 수 있으므로 raw 문자열을 그대로 표준 이벤트에 싣지 않는다.
  provider adapter 안에서 sanitize하면 writer, status, smoke artifact 같은 후속 경로가 같은 방어선을 공유한다.
- `state.json`은 lifecycle SSOT이고 `logs/<phase>.jsonl`은 디버그 원천이다.
  debug 전문을 state에 넣지 않아야 계층이 섞이지 않는다.
- Claude `result(error)`를 `model_response`, `retryable=true`로 분류하면 model 출력 문제와 인증/설정 blocked 실패를 구분할 수 있다.
  현재 retryable은 자동 재실행 트리거가 아니라 분류 신호다.
- Claude `result(success)`라도 본문이 headless 권한 승인 대기 또는 파일 생성 권한 요청이면 성공으로 기록하지 않는다.
  BUI-268에서 이 패턴을 `failure.kind=model_response`, `failure.code=claude_permission_request`, `retryable=false`, `blocked=true`로 분류했다.
  provider exit code와 terminal event type이 성공이어도 실제 산출물 생성이 보류된 상태이므로 Do completed로 남기면 Check/Iter가 불필요하게 반복된다.
- Claude stream 중간의 `tool_result` 또는 `user` 이벤트가 `This command requires approval` 계열 approval denial을 반복하면 terminal result를 기다리지 않고 같은 `claude_permission_request` blocked failure로 종료한다.
  BUI-300에서 이 패턴은 최종 result까지 도달하지 않는 approval loop로 확인됐고, provider가 synthetic terminal error를 writer에 전달한 뒤 `success:false`를 반환하게 했다.
  runner가 기존 failure/finally 경로로 `state.json.status=failed`와 lock release를 처리해야 하므로 provider는 state/lock을 직접 조작하지 않는다.
- Claude process exit code가 0이어도 terminal `result.is_error=true` 또는 `subtype=error`이면 성공으로 기록하지 않는다.
  BUI-279에서 이 패턴을 `failure.kind=model_response`, `failure.code=claude_result_is_error`로 합성해 `runClaude()` 반환값을 `success:false`로 승격했다.
  `progress-writer`가 failed artifact를 쓰는 동안 runner가 success를 반환하는 split-brain 상태를 막기 위해 terminal event error 신호를 process exit code보다 우선한다.

## 결과

- provider failure 정규화 진입점은 `src/providers/failure.js`가 되었다.
- Codex와 Claude provider는 공통 failure 객체를 emit/return한다.
- normalizer는 provider error event에 failure가 없을 때 fallback failure를 보완한다.
- writer는 `progress.json.last_failure`를 기록하고 runner는 이를 `state.json.last_failure`로 승격한다.
- `logs/<phase>.jsonl`은 `failure.debug_detail`을 포함할 수 있지만 progress/state에는 debug detail을 넣지 않는다.
- contract 문서와 테스트가 failure taxonomy, sanitize, blocked/retryable 매트릭스를 검증한다.
- BUI-175에서 app-server error notification 메시지에도 sanitize를 적용했다.
  공개 문서와 KG는 `test/docs-sensitive-check.test.js`로 token, API key, 실제 홈 경로 후보를 점검한다.
- BUI-268에서 Claude 권한 승인 대기 응답을 `claude_permission_request` failure code로 추가했다.
  raw Claude adapter, event normalizer, progress writer가 같은 classifier를 공유해 `do-result.md`와 `progress.json`의 completed false-positive를 막는다.
- BUI-300에서 Claude `tool_result`/`user` approval denial 반복을 같은 `claude_permission_request` blocked failure로 수렴했다.
  provider는 approval loop를 감지하면 synthetic terminal error event를 emit하고 process group 종료를 시도해 orphan `claude -p`와 stale lock 위험을 낮춘다.
- BUI-279에서 Claude terminal `result.is_error=true` 또는 `subtype=error`를 `claude_result_is_error` failure code로 승격했다.
  명시적 failure 객체가 있으면 우선 사용하고, 없으면 `model_response` failure를 합성해 provider 반환값과 writer artifact의 성공/실패 판정을 일치시킨다.

## 대안

- provider별 error payload를 자유 형식으로 둔다: provider가 늘수록 운영자가 같은 실패를 다른 필드에서 찾아야 하므로 선택하지 않았다.
- `last_error`를 객체로 바꾼다: 하위 호환을 깨므로 선택하지 않았다.
- raw stderr를 사용자 메시지로 그대로 노출한다: 조치가 불명확하고 secret 노출 위험이 있어 선택하지 않았다.
- `state.json`에 logs 수준 debug를 모두 넣는다: lifecycle SSOT와 디버그 로그 계층을 섞으므로 선택하지 않았다.
- runtime redaction을 문서 scanner에만 맡긴다: provider event가 먼저 파일 artifact로 기록될 수 있어 선택하지 않았다.
- `model_response`를 항상 non-retryable로 둔다: 일시적 model 출력 오류와 영구 blocked 실패를 구분하지 못해 선택하지 않았다.
- Claude 권한 승인 대기 응답을 sandbox failure로 둔다: sandbox 정책 자체보다 모델/provider가 headless 실행에서 사용자 승인을 요구했다는 terminal response 문제이므로 선택하지 않았다.
- 권한 승인 대기 감지를 progress writer에만 둔다: raw provider와 normalizer를 우회하는 경로에서 completed false-positive가 재발할 수 있어 선택하지 않았다.
- tool approval denial 반복을 provider retry로 계속 둔다: 같은 headless permission 환경에서는 산출물 없이 같은 denial이 반복되어 runner lifecycle이 stale `running`처럼 보일 수 있어 선택하지 않았다.
- approval denial을 자동 허용한다: built가 provider 보안 정책을 우회하는 결정이 되므로 선택하지 않았다.
- Claude `result.is_error`를 exit code 0이면 성공으로 둔다: provider process는 정상 종료했더라도 stream-json terminal result가 error를 선언한 상태라 계약과 writer artifact가 불일치하므로 선택하지 않았다.

## 되돌릴 조건

provider가 안정적인 공식 error code와 retry/blocking 신호를 제공하면 adapter 내부 mapping을 교체할 수 있다.
그 경우에도 built 외부 파일 계약은 `failure.kind/code/user_message/action/retryable/blocked`와 `last_failure` 구조를 유지한다.

자동 retry 정책이 도입되면 `retryable=true`만으로 재실행하지 말고 `failure.kind`, attempt count, retry cap을 함께 보는 별도 정책을 추가해야 한다.

provider별 secret 포맷이 추가되거나 smoke artifact 저장 범위가 넓어지면 `sanitizeDebugDetail()` fixture와 공개 파일 scanner fixture를 함께 갱신한다.
단, scanner는 완전한 secret scanner 제품이 아니라 공개 문서/KG의 known-risk 회귀 방지 장치로 둔다.

Claude CLI가 headless permission mode 또는 allowed tools 정책을 안정적으로 제공해 파일 쓰기 승인 대기가 더 이상 모델 응답으로 나타나지 않으면 `claude_permission_request` classifier를 축소할 수 있다.
그 경우에도 "실제 산출물 없이 권한 요청만 반환된 success result는 completed가 아니다"라는 외부 file contract는 유지한다.

Claude CLI가 stream-json에 안정적인 approval denial error code를 제공하면 문자열 기반 반복 감지를 provider code 기반 감지로 교체할 수 있다.
그 경우에도 approval denial 반복은 자동 승인하지 않고 blocked failure로 수렴해야 하며, runner cleanup 경로를 우회하지 않는다.
