---
id: ADR-25
title: Codex active turn abort 계약
type: decision
date: 2026-04-27
status: accepted
context_issue: BUI-316
tags: [architecture, provider, codex, abort, interrupt, runtime]
---

## 컨텍스트

Codex broker는 app-server 통신을 위해 detached process로 남을 수 있다.
그러나 사용자가 foreground 실행을 중단하거나 `/built:abort <feature>`를 실행했는데 active turn이 계속 파일을 수정하면, built의 state/lock 상태와 실제 workspace 변경 상태가 갈라진다.

BUI-130은 provider timeout/interrupt failure taxonomy를 정했고, BUI-131은 broker lifecycle과 stale cleanup을 정했다.
BUI-316에서는 그 위에 "사용자 중단 이후 active Codex turn을 어떻게 찾아 interrupt하고, 실패를 어떻게 기록할지"를 별도 계약으로 고정했다.

## 결정

Codex provider는 active turn이 시작되면 `provider_metadata.active_provider` 이벤트로 `provider`, `threadId`, `turnId`, `phase`, `cwd`, `status`, `updatedAt`을 emit한다.
runner와 standard writer는 이 metadata를 `.built/runtime/runs/<feature>/state.json`과 `.built/features/<feature>/progress.json`에 보존한다.

AbortSignal, timeout, `/built:abort` 경로는 저장된 `threadId`와 `turnId`를 사용해 Codex `turn/interrupt`를 기본 cleanup으로 시도한다.
이 시도는 bounded timeout을 가져야 하며, app-server가 응답하지 않아도 built cleanup flow가 무기한 대기하지 않는다.

`/built:abort`는 state/registry/lock cleanup을 먼저 완료한 뒤 active turn interrupt를 시도한다.
interrupt가 실패하거나 timeout되면 `codex_interrupt.interrupted=false`, `active_provider.status=interrupt_failed`, 실패 detail, 수동 종료 안내를 남긴다.

외부 `/built:abort`로 `state.json.status=aborted`가 기록된 경우 parent runner의 후속 phase 성공/실패 정리는 그 상태를 덮지 않는다.

`provider_metadata`는 control-plane 관측 이벤트다.
provider가 result 파일을 직접 소유하거나 progress/state를 임의로 쓰는 통로가 아니며, 파일 계약 normalization은 runner와 `standard-writer`가 담당한다.

## 근거

- active turn 식별자가 안정적으로 기록되지 않으면 외부 abort는 state/lock만 바꾸고 실제 Codex 작업은 계속 둘 수 있다.
- progress와 runtime state 양쪽에 기록해야 사용자-facing 상태와 abort command의 lookup 경로가 모두 안정적이다.
- app-server가 hang된 상황에서 interrupt 응답을 무기한 기다리면 사용자의 abort 명령 자체가 완료되지 않는다.
- interrupt 실패를 숨기면 사용자는 "aborted" 상태를 믿고 workspace 변경 위험을 놓친다.
- detached broker 재사용은 startup 비용과 lifecycle 안정성에는 유용하지만, active turn 중단 계약 없이는 사용자 취소 의도와 충돌한다.

## 결과

- Ctrl-C, SIGTERM, SIGHUP, timeout, `/built:abort` 경로가 모두 Codex active turn interrupt를 시도한다.
- `/built:abort`는 Codex interrupt 실패와 무관하게 state/registry/lock cleanup을 완료하고, 실패 위험을 metadata와 출력으로 남긴다.
- `docs/contracts/provider-events.md`에 `provider_metadata`, `active_provider`, `codex_interrupt` 계약이 추가되었다.
- `src/codex-active-turn.js`가 state/progress metadata 기록과 interrupt 결과 보존을 담당한다.
- fake app-server와 pipeline/abort 테스트가 active turn metadata, interrupt 실패, 상태 보존, terminal event ordering을 검증한다.

## 대안

- broker process를 abort 때마다 항상 종료한다: 외부 endpoint 소유권과 broker 재사용 정책을 깨고, active turn interrupt보다 범위가 넓어서 선택하지 않았다.
- `/built:abort`가 interrupt 성공 후에만 state/registry/lock cleanup을 수행한다: app-server 무응답 시 abort 명령이 hang될 수 있어 선택하지 않았다.
- interrupt 실패를 로그만 남긴다: 후속 role과 사용자-facing 상태에서 위험을 확인하기 어려워 선택하지 않았다.
- provider가 progress/state를 직접 쓴다: provider event normalization과 standard writer 계약을 깨므로 선택하지 않았다.

## 되돌릴 조건

Codex app-server 또는 built runtime supervisor가 active turn cancellation을 process lifecycle 수준에서 보장하고, 외부 abort가 provider session을 transactional하게 종료할 수 있는 공식 API를 제공하면 이 metadata 기반 lookup을 단순화할 수 있다.
그 경우에도 사용자 abort 우선, bounded cleanup, 실패 위험 metadata, provider 파일 소유권 금지 원칙은 유지해야 한다.
