---
id: WF-26
title: Codex Active Turn Abort Validation
type: workflow
date: 2026-04-27
validated_by: [BUI-316]
tags: [provider, codex, abort, interrupt, validation, regression]
---

## 패턴 설명

Codex active turn 중단 경로를 바꿀 때는 foreground signal, external abort, timeout, parent runner 정리를 각각 분리해 검증한다.
핵심은 built state가 `aborted`라고 말하는 순간 실제 active turn을 찾을 수 있어야 하고, interrupt 실패가 조용히 묻히지 않아야 한다는 점이다.

## 언제 사용하나

- `src/providers/codex.js`의 `turn/start`, `turn/started`, `turn/interrupt`, timeout, AbortSignal 처리를 바꿀 때
- `src/codex-active-turn.js`의 state/progress metadata 기록 또는 lookup 정책을 바꿀 때
- `scripts/abort.js`의 state/registry/lock cleanup 순서나 interrupt timeout을 바꿀 때
- phase script 또는 `scripts/run.js`의 signal handling을 바꿀 때
- `src/pipeline-runner.js`, `src/providers/standard-writer.js`, `docs/contracts/provider-events.md`의 `provider_metadata`나 `codex_interrupt` 계약을 바꿀 때

## 단계

1. 관련 계약과 KG를 확인한다:
   `docs/contracts/provider-events.md`,
   `kg/decisions/provider-event-normalization-and-standard-writer.md`,
   `kg/decisions/provider-retry-timeout-interrupt-policy.md`,
   `kg/decisions/codex-broker-lifecycle-policy.md`,
   `kg/decisions/codex-active-turn-abort-contract.md`.
2. Codex fake app-server 또는 injected interrupt function으로 `threadId`와 `turnId`가 있는 active turn을 만든다.
3. `provider_metadata.active_provider`가 progress와 runtime state에 모두 기록되는지 확인한다.
4. phase script와 `run.js`가 SIGINT, SIGTERM, SIGHUP을 AbortController로 연결하고 `runPipeline({ signal })`을 호출하는지 확인한다.
5. AbortSignal 경로에서는 Codex adapter가 `turn/interrupt`를 시도하고 terminal `error.failure.kind=interrupted`를 남기는지 확인한다.
6. timeout 경로에서는 terminal error와 settle이 app-server 응답성에 묶이지 않고, interrupt 결과가 `codex_interrupt`로 보존되는지 확인한다.
7. `/built:abort` 경로에서는 state `aborted`, registry `aborted`, lock 제거가 interrupt 응답보다 먼저 완료되는지 확인한다.
8. interrupt success는 `active_provider.status=interrupted`와 `codex_interrupt.interrupted=true`를 남기는지 확인한다.
9. interrupt throw, false result, timeout은 `active_provider.status=interrupt_failed`, `codex_interrupt.interrupted=false`, 수동 종료 안내를 남기는지 확인한다.
10. 외부 abort가 이미 기록한 `aborted` 상태를 parent runner의 후속 failed/completed 정리가 덮지 않는지 확인한다.
11. `provider_metadata`가 provider 직접 파일 쓰기가 아니라 runner/writer normalization으로만 반영되는지 확인한다.
12. 검증은 최소 `node test/abort.test.js`, `node test/providers-codex.test.js`, `node test/pipeline-runner.test.js`, `node test/run.test.js`, `node test/e2e/e2e-runner.js --filter abort`, `git diff --check origin/main...HEAD`를 실행한다.

## 주의사항

- `state.json.status=aborted`를 먼저 기록한 뒤에도 Codex active turn이 계속 파일을 수정할 수 있다는 위험을 테스트에서 가정해야 한다.
- `turn/interrupt` 호출은 bounded timeout이어야 한다.
  app-server가 응답하지 않는 테스트를 별도로 둔다.
- abort cleanup 실패 detail에는 secret, token, private environment value, raw execution dump를 남기지 않는다.
- detached broker cleanup과 active turn interrupt를 혼동하지 않는다.
  broker가 남을 수 있어도 active turn은 중단되어야 한다.
- terminal `error` 이후 추가 provider event를 emit해 ordering 계약을 깨지 않는지 확인한다.
