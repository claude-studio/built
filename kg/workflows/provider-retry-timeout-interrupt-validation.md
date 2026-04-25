---
id: WF-9
title: Provider Retry Timeout Interrupt Validation
type: workflow
date: 2026-04-26
validated_by: [BUI-130]
tags: [provider, retry, timeout, interrupt, validation, regression]
---

## 패턴 설명

provider retry, timeout, interrupt 경로를 바꿀 때는 단일 attempt의 실패 분류와 retry wrapper의 event buffering을 분리해 검증한다.
핵심은 retry 가능한 중간 실패가 terminal event로 기록되지 않고, 최종 attempt의 결과만 state/progress/result 계약에 반영되는지 확인하는 것이다.

## 언제 사용하나

- `src/providers/codex.js`의 retry, timeout, interrupt, broker busy 처리를 수정할 때
- `src/pipeline-runner.js`에서 provider adapter로 전달하는 `signal` 또는 retry config를 바꿀 때
- `src/providers/config.js`의 `timeout_ms`, `max_retries`, `retry_delay_ms` parser 정책을 바꿀 때
- `src/providers/failure.js`의 retryable, blocked, interrupted 분류를 바꿀 때
- `docs/contracts/provider-config.md`의 timeout/interrupt/retry 정책을 바꿀 때

## 단계

1. 관련 계약과 KG를 확인한다:
   `docs/contracts/provider-config.md`, `docs/contracts/provider-events.md`,
   `kg/decisions/provider-failure-taxonomy-and-message-boundary.md`,
   `kg/decisions/provider-retry-timeout-interrupt-policy.md`.
2. provider config parser에서 `timeout_ms`, `max_retries`, `retry_delay_ms`의 정상값과 잘못된 값을 함께 검증한다.
3. pipeline-runner가 phase별 provider config의 retry 설정과 `AbortSignal`을 adapter에 그대로 전달하는지 확인한다.
4. timeout이나 broker busy처럼 retry 가능한 실패는 `failure.retryable=true`인지 확인한다.
5. auth/config/sandbox/interrupted처럼 즉시 실패해야 하는 실패는 `failure.retryable=false`인지 확인한다.
6. retry 테스트에서는 첫 attempt를 timeout 또는 broker busy로 실패시키고 다음 attempt를 성공시킨다.
7. 중간 attempt의 `error` event가 외부 `onEvent`로 flush되지 않는지 확인한다.
8. 최종 success 경로는 `phase_start`, 필요한 delta event, `phase_end`만 기록되는지 확인한다.
9. interrupt 테스트에서는 `AbortSignal` early-abort와 실행 중 abort를 모두 고려한다.
10. terminal `error(failure.kind=interrupted)` 이후 추가 이벤트가 없는지 확인한다.
11. `providerMeta.retry.attempts`, `max_retries`, `log`에 attempt history와 reason이 남는지 확인한다.
12. 테스트는 최소 `node test/providers-codex.test.js`, `node test/providers-config.test.js`, `node test/providers-failure.test.js`, `node test/pipeline-runner.test.js`를 함께 실행한다.

## 주의사항

- `failure.retryable=true`는 자동 retry trigger가 아니라 분류 신호다.
  실제 retry는 `max_retries`, 현재 attempt, abort 상태가 함께 결정한다.
- 중간 attempt error를 writer로 넘기면 최종 attempt 성공 후에도 terminal ordering이 깨질 수 있다.
- interrupt는 timeout으로 대체하지 않는다.
  사용자가 중단한 실행은 `interrupted`로 남겨야 한다.
- retry delay 중 abort가 들어오면 다음 attempt로 넘어가지 않아야 한다.
- retry log에는 secret, token, private environment value, raw execution dump를 남기지 않는다.
