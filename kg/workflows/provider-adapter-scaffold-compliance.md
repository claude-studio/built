---
id: WF-14
title: Provider Adapter Scaffold Compliance
type: workflow
date: 2026-04-26
validated_by: [BUI-230]
tags: [provider, scaffold, compliance, contracts, regression]
---

## 패턴 설명

새 provider adapter는 구현 전에 scaffold, checklist, compliance fake test를 기준으로 계약을 먼저 맞춘다.
adapter는 provider runtime과 통신하되 built 파일을 직접 쓰지 않고, runner/writer가 소비할 표준 provider event만 emit한다.

## 언제 사용하나

- Claude/Codex 외 신규 provider adapter를 추가할 때
- provider raw event를 built 표준 이벤트로 매핑하는 코드를 작성할 때
- provider failure taxonomy, sandbox 전달, timeout, AbortSignal 처리를 추가하거나 바꿀 때
- provider가 파일을 직접 쓰는지, terminal event 순서를 깨는지 회귀 검증해야 할 때

## 단계

1. `src/providers/scaffold-template.js`를 새 provider 이름으로 복사하고 `SCAFFOLD_TODO`를 구현 항목으로 추적한다.
2. 실행 함수는 `run<Provider>({ prompt, model, onEvent, sandbox, timeout_ms, signal })` 형태를 유지한다.
3. 첫 이벤트는 `phase_start`로 emit하고, 마지막 이벤트는 `phase_end` 또는 `error` 중 하나로만 emit한다.
4. `text_delta`, `tool_call`, `tool_result`, optional `usage` 이벤트는 `docs/contracts/provider-events.md`의 표준 payload를 따른다.
5. failure는 `src/providers/failure.js`의 `createFailure`, `FAILURE_KINDS`, `failureToEventFields`, `sanitizeDebugDetail`을 사용한다.
6. `signal.aborted`를 즉시 감지해 `interrupted` failure로 종료한다.
7. `sandbox`는 provider runtime에 명시적으로 전달하거나, 지원 불가 조합을 `config` 또는 `sandbox` failure로 빠르게 실패시킨다.
8. provider adapter에서는 `fs.writeFile`, `fs.writeFileSync`, `fs.appendFile`, write flag `fs.open` 같은 직접 파일 쓰기를 사용하지 않는다.
9. `src/providers/config.js`의 `VALID_PROVIDERS`, runner 호출 분기, event normalizer 필요 여부, provider config contract 문서를 함께 확인한다.
10. provider별 단위 테스트와 `test/providers-compliance.test.js`를 실행해 이벤트 순서와 파일 쓰기 guard가 모두 통과하는지 확인한다.

## 주의사항

- compliance fake test는 실제 provider 품질을 검증하는 테스트가 아니라 built provider contract 위반을 잡는 gate다.
- terminal 이벤트 이후 추가 이벤트가 있으면 progress/result 최종 상태가 불안정해지므로 adapter 내부 emit guard를 두는 것이 좋다.
- `usage`와 cost 정보는 optional이다. 제공할 수 없다는 이유만으로 provider 실행을 실패시키지 않는다.
- provider-specific sandbox 값 매핑은 adapter 안에서 명시적으로 관리하고, do/iter 쓰기 phase의 권한 부족을 늦게 발견하지 않게 한다.
- checklist 문서는 onboarding 기준이고, 실제 provider 추가 PR에서는 해당 provider의 spawn/RPC 실패, timeout, abort, model response parsing test를 별도로 작성한다.
