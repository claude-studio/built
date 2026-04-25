---
id: ADR-11
title: provider retry, timeout, interrupt 정책
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-130
tags: [architecture, provider, retry, timeout, interrupt, contracts]
---

## 컨텍스트

Codex app-server provider가 추가되면서 provider 실행은 timeout, app-server busy, 사용자 interrupt, 장시간 turn 같은 비동기 실패를 만난다.
이 경로가 명확하지 않으면 retryable 실패가 조용히 중복 기록되거나, 사용자 취소가 timeout처럼 보이거나, 성공 retry 뒤에도 state/progress에 과거 terminal error가 남을 수 있다.

기존 provider failure taxonomy는 retryable과 blocked를 분리했지만, 실제 bounded retry 실행 정책과 interrupt failure kind는 아직 고정되지 않았다.

## 결정

provider timeout 기본값은 provider별로 유지하되 phase config override를 우선한다.
Claude는 `MULTICA_AGENT_TIMEOUT` 또는 30분을 사용하고, Codex는 `timeout_ms` 미지정 시 30분을 사용한다.

Codex provider retry는 `max_retries`가 0보다 클 때만 수행한다.
retry 대상은 `failure.retryable=true`인 실패이며, timeout과 broker busy는 retry 가능, auth/config/sandbox/interrupted는 즉시 실패로 둔다.

중간 retry attempt의 provider event는 buffer에 보관한다.
최종 attempt가 결정되기 전까지 중간 attempt의 terminal error를 writer로 flush하지 않고, 최종 attempt의 success/error만 state/progress/result 계약에 반영한다.

사용자 interrupt 또는 `AbortSignal` abort는 `failure.kind=interrupted`로 분류한다.
이 실패는 `retryable=false`, `blocked=false`이며, 필요하면 사용자가 같은 feature를 다시 실행하는 방식으로 복구한다.

retry 횟수와 이유는 `providerMeta.retry`와 logger line에 남긴다.
사용자-facing state/progress에는 최종 failure 요약만 남기고, retry log에는 secret이나 private environment value를 남기지 않는다.

## 근거

- retry 가능한 중간 error를 terminal event로 기록하면 후속 attempt가 성공해도 파일 계약이 모순된다.
- timeout과 broker busy는 일시적일 수 있지만, 인증/설정/sandbox 문제는 retry로 해결되지 않는다.
- interrupt는 사용자의 명시적 중단이므로 자동 retry하면 사용자의 의도와 반대로 동작한다.
- bounded retry cap 없이 `retryable=true`만으로 자동 재실행하면 provider 비용과 실행 시간이 예측 불가능해진다.
- retry log를 result meta 계층에 두면 운영 디버깅은 가능하면서 기존 state/progress 계약을 유지할 수 있다.

## 결과

- `docs/contracts/provider-config.md`에 timeout/interrupt/retry 정책이 추가되었다.
- `src/providers/config.js`가 `max_retries`, `retry_delay_ms`를 검증한다.
- `src/providers/codex.js`가 `_runCodexWithRetries`와 `_runCodexOnce` 경계로 retry와 단일 attempt 실행을 분리한다.
- `src/pipeline-runner.js`가 `AbortSignal`과 retry config를 Codex adapter에 전달한다.
- `src/providers/failure.js`에 `interrupted` failure kind가 추가되었다.
- `test/providers-codex.test.js`가 timeout retry buffering과 AbortSignal terminal ordering을 검증한다.

## 대안

- 모든 retryable failure를 runner 레벨에서 재실행한다: provider event buffering과 app-server turn cleanup 경계를 runner가 알기 어렵기 때문에 선택하지 않았다.
- 중간 attempt error도 모두 기록한다: 운영 로그는 자세해지지만 terminal event 계약이 깨질 수 있어 선택하지 않았다.
- interrupt를 timeout으로 분류한다: 사용자 취소와 인프라 지연을 구분할 수 없어 선택하지 않았다.
- `max_retries` 기본값을 1 이상으로 둔다: 기존 provider 실행 시간과 비용 기대가 바뀌므로 선택하지 않았다.

## 되돌릴 조건

provider 공통 runner retry layer가 생기고 표준 이벤트 buffering, attempt metadata, cleanup 책임 경계가 별도 계약으로 확정되면 Codex 내부 retry를 공통 계층으로 옮길 수 있다.
그 경우에도 중간 attempt terminal event 미기록, interrupt non-retryable 분류, retry cap 필수 조건은 유지해야 한다.
