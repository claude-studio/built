---
id: ADR-17
title: provider adapter scaffold와 compliance gate
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-230
tags: [architecture, provider, scaffold, compliance, contracts]
---

## 컨텍스트

built는 Claude와 Codex 이후에도 provider를 추가할 수 있어야 한다.
하지만 provider마다 raw event, sandbox 지원, failure 표현, runtime 실행 방식이 다르므로 새 adapter가 기존 파일 기록 계약과 runner 책임 경계를 우회할 위험이 있다.

이전 결정에서 provider event normalization, standard writer, failure taxonomy, provider config sandbox 정책을 분리했으므로 새 provider 추가 절차도 같은 계약을 재사용해야 한다.

## 결정

새 provider adapter는 `src/providers/scaffold-template.js`와 `docs/providers/new-provider-checklist.md`를 기준으로 만든다.
adapter는 표준 `run<Provider>({ prompt, model, onEvent, sandbox, timeout_ms, signal })` 형태를 유지하고, 파일을 직접 쓰지 않으며, 표준 이벤트와 failure taxonomy로만 runner에 상태를 전달한다.

`test/providers-compliance.test.js`는 신규 provider 작업의 contract gate로 사용한다.
fake adapter로 파일 직접 쓰기, phase_start 누락, terminal 이후 이벤트, `phase_end`와 `error` 동시 emit, terminal 누락, AbortSignal 처리를 검증한다.

## 근거

- scaffold를 기준으로 두면 새 provider 추가자가 기존 Claude/Codex 구현 세부사항보다 built 표준 계약을 먼저 따른다.
- provider가 파일을 직접 쓰지 않게 해야 `pipeline-runner.js`, `progress-writer.js`, standard writer의 책임 경계가 유지된다.
- fake compliance test는 실제 provider CLI, 인증, 네트워크 없이도 계약 위반을 CI에서 빠르게 검출한다.
- failure taxonomy와 sandbox 처리를 adapter 작성 단계에서 요구해야 provider별 오류 메시지와 권한 실패가 흩어지지 않는다.

## 결과

- 새 provider 추가 시 필요한 최소 파일은 adapter 구현 파일과 provider 단위 테스트로 명확해졌다.
- `VALID_PROVIDERS`, runner 분기, event normalizer, provider config contract 확인이 checklist에 포함되었다.
- 표준 이벤트 ordering 위반과 provider 직접 파일 쓰기는 별도 fake test로 회귀 검증할 수 있다.
- 실제 provider 구현이 없는 상태에서도 provider onboarding 기준을 문서와 테스트로 검증할 수 있다.

## 대안

- 기존 `claude.js` 또는 `codex.js`를 복사해 새 provider를 만들게 한다: runtime별 세부 구현과 표준 계약이 섞여 잘못된 책임 경계를 복제할 수 있어 선택하지 않았다.
- 실제 provider가 추가될 때까지 compliance 테스트를 미룬다: provider 전환 초기에 contract regression을 잡을 수 없어 선택하지 않았다.
- provider별 writer를 허용한다: file contract drift와 provider별 progress/result 차이를 만들 위험이 커서 선택하지 않았다.

## 되돌릴 조건

provider runtime contract가 표준 이벤트 emit 방식으로 수렴하지 않거나 runner가 provider별 writer를 공식 지원하는 아키텍처로 바뀌면 재검토한다.
그 경우에도 파일 계약과 terminal event ordering을 검증하는 compliance gate는 대체 수단으로 유지해야 한다.
