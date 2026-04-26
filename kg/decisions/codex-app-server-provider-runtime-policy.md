---
id: ADR-6
title: Codex app-server provider runtime 정책
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-117
tags: [architecture, provider, codex, app-server, sandbox]
---

## 컨텍스트

built provider 전환 로드맵은 Claude 외 provider를 phase 단위로 선택할 수 있어야 한다.
Codex는 단순 batch CLI 호출보다 app-server의 thread/turn/progress 모델이 built runner의 phase 실행과 progress event 모델에 더 잘 맞는다.

동시에 Codex provider는 외부 app-server process, JSON-RPC request/notification, timeout/interrupt, sandbox/auth 정책을 함께 다룬다.
따라서 adapter MVP에서도 provider/runner 파일 책임 경계와 표준 provider event 계약을 깨지 않는 runtime 정책이 필요했다.

## 결정

Codex provider MVP는 app-server JSON-RPC client를 provider 내부에 최소 구현하고, built 표준 provider event만 runner에 전달한다.
provider는 `state.json`, `progress.json`, phase result markdown 같은 built 산출물 파일을 직접 쓰지 않는다.

Codex app-server lifecycle은 MVP에서 direct spawn 중심으로 시작한다.
broker lifecycle 재사용은 후속 최적화로 남기고, 현재 adapter는 `thread/start`와 `turn/start`를 실행한 뒤 notification을 표준 이벤트로 변환한다.

timeout은 terminal `error` emit과 provider promise settle을 먼저 수행한다.
`turn/interrupt`는 best-effort cleanup으로 분리하고, app-server process 정리는 client close/SIGTERM 경로에 맡긴다.

표준 event 계약 보강은 provider emit 시점에 수행한다.
`phase`는 `emit` wrapper에서 모든 event에 일괄 주입하고, `phase_end.duration_ms`는 `runCodex`가 가진 `startTime` 기준으로 emit 직전에 채운다.
notification 변환 함수는 순수 mapping으로 유지한다.

Codex sandbox는 built 값과 app-server 값 사이의 명시적 변환 테이블을 사용한다.
현재 app-server schema는 `read-only`, `workspace-write`, `danger-full-access` kebab-case enum을 기대하므로 built 계약 값은 camelCase로 변환하지 않고 그대로 전달한다.
`do`/`iter` phase에서 `read-only` sandbox는 provider 진입 시 `MSG_WRITE_PHASE_READ_ONLY`로 거부한다.

## 근거

- app-server의 thread/turn/progress model은 built의 phase 실행과 streaming progress event에 맞다.
- vendored `codex-plugin-cc` runtime은 ESM과 plugin 배치 전제를 갖고 있어 현재 CJS provider 모듈에서 직접 dependency로 삼기 어렵다.
- provider가 파일을 직접 쓰면 BUI-114/BUI-116에서 고정한 provider/runner/writer 책임 경계가 깨진다.
- timeout 원인이 app-server 무응답이면 interrupt request도 응답하지 않을 수 있으므로 interrupt await 후 settle은 hang 위험이 있다.
- `phase`와 `duration_ms`는 writer 보완값이 아니라 runner 외부 소비자가 받는 표준 event payload에도 있어야 한다.
- `do`/`iter` read-only 실행은 성공처럼 보이는 무효 변경을 만들 수 있으므로 runtime에서도 빠르게 실패해야 한다.

## 결과

- Codex provider는 app-server 가용성, 인증 상태, sandbox 정책을 실행 전에 확인한다.
- Codex notification은 `text_delta`, `tool_call`, `tool_result`, `phase_end`, `error`로 normalize된다.
- `phase_start`와 terminal event는 provider event ordering의 기준점으로 사용된다.
- timeout 실패는 retryable `error` event로 관찰되고 provider promise가 종료된다.
- `SANDBOX_TO_CODEX`가 built와 Codex app-server sandbox 문자열 호환성을 단일 지점에서 관리한다.
- `do`/`iter` + `read-only`는 provider 진입 시 명확한 한국어 오류로 종료된다.

## 대안

- Codex CLI batch 호출을 사용한다: app-server의 thread/turn/progress/interrupt 모델을 잃어 built provider event와 맞추기 어려워 선택하지 않았다.
- vendored `codex-plugin-cc` runtime을 그대로 require한다: ESM/CJS 경계와 plugin 배치 전제가 맞지 않아 MVP 위험이 커서 선택하지 않았다.
- broker lifecycle을 첫 MVP에 포함한다: stale endpoint, busy broker, 재사용 cleanup까지 동시에 다루면 검증 범위가 커져 후속 최적화로 분리했다.
- timeout 시 interrupt 응답을 기다린다: app-server 무응답 상황에서 hang될 수 있어 선택하지 않았다.
- event `phase`를 writer에서만 보완한다: writer 산출물은 맞아도 provider event 계약 소비자에게 불완전한 payload가 전달되므로 선택하지 않았다.

## 되돌릴 조건

공식 Codex app-server client가 안정적인 CJS/ESM package 경계로 제공되거나 vendored runtime이 built provider에 맞는 독립 모듈로 정리되면 최소 JSON-RPC client를 교체할 수 있다.
이 경우에도 provider는 파일을 직접 쓰지 않고 표준 event를 runner/writer에 전달하는 경계, timeout terminal-first 정책, sandbox 변환/검증 정책은 유지해야 한다.
