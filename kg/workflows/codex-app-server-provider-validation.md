---
id: WF-5
title: Codex App Server Provider Validation
type: workflow
date: 2026-04-26
validated_by: [BUI-117, BUI-131, BUI-306, BUI-225]
tags: [provider, codex, app-server, validation, regression]
---

## 패턴 설명

Codex app-server provider를 수정할 때는 실제 Codex 호출 전에 control-plane 계약을 fake app-server fixture와 단위 테스트로 고정한다.
핵심은 app-server JSON-RPC lifecycle, notification normalize, timeout/interrupt, sandbox 정책, provider event payload, broker session cleanup을 독립적으로 검증하는 것이다.
BUI-225 이후에는 read-only phase에서 `fileChange` notification이 발생하는 경로도 sandbox failure 회귀 대상으로 포함한다.

## 언제 사용하나

- `src/providers/codex.js`의 app-server request/notification 처리를 바꿀 때
- Codex `outputSchema` 또는 `structuredOutput` 반환 계약을 바꿀 때
- Codex sandbox, approval policy, timeout 기본값을 바꿀 때
- read-only phase의 `fileChange` notification 감지나 sandbox failure 메시지를 바꿀 때
- `pipeline-runner.js`에서 Codex provider 연결이나 `createStandardWriter` 연결을 바꿀 때
- `docs/contracts/provider-events.md` 또는 `docs/contracts/provider-config.md`와 관련된 provider event/config 계약을 바꿀 때
- broker lifecycle 재사용, stale cleanup, startup lock, busy fallback을 바꿀 때

## 단계

1. 계약 문서와 기존 KG를 확인한다:
   `docs/contracts/provider-events.md`, `docs/contracts/provider-config.md`,
   `kg/decisions/provider-event-normalization-and-standard-writer.md`,
   `kg/decisions/provider-config-default-and-sandbox-policy.md`,
   `kg/decisions/codex-app-server-provider-runtime-policy.md`.
2. 실제 Codex CLI나 외부 app-server를 호출하지 않는 fake spawn/app-server fixture를 먼저 준비한다.
3. availability check는 binary 없음, app-server 미지원, 인증 누락 메시지를 각각 검증한다.
4. sandbox는 built 값 `read-only`/`workspace-write`가 Codex app-server의 kebab-case enum으로 그대로 전달되는지 검증한다.
5. `do`/`iter` + `read-only` 조합은 provider 진입 시 즉시 실패하는지 검증한다.
6. `plan_synthesis`, `check`, `report` + `read-only` 중 `fileChange` notification이 발생하면 `codex_read_only_file_change` sandbox failure로 종료되는지 검증한다.
7. notification mapping은 `agentMessage`, `commandExecution`, `mcpToolCall`, `dynamicToolCall`, `fileChange`, `turn/completed`, error notification을 포함한다.
8. 모든 provider event에 `phase`가 포함되는지 검증한다.
9. 일반 async `turn/completed` 경로와 immediate completion 경로 모두 `phase_end.duration_ms`가 number로 채워지는지 검증한다.
10. timeout 테스트는 app-server가 응답하지 않아도 provider promise가 terminal `error` 후 종료되는지 확인한다.
11. structured output을 쓰는 경로는 app-server에 전달되는 `outputSchema`가 JSON Schema object 자체인지 확인한다.
    `{ schema: ... }` wrapper는 금지하고, string schema 입력은 provider 경계에서 parse된 뒤 전송되어야 한다.
12. Codex structured output schema는 object schema마다 `additionalProperties: false`와 모든 properties의 `required` 포함을 테스트로 고정한다.
13. Codex 성공 결과가 최종 JSON text를 `structuredOutput`으로 반환하고, phase script가 raw text를 provider별로 재파싱하지 않는지 확인한다.
14. `pipeline-runner.js` 변경이 있으면 Codex 경로가 provider result를 직접 파일로 쓰지 않고 `standard-writer`를 거치는지 확인한다.
15. broker lifecycle을 바꿀 때는 endpoint 생성/파싱, session state 저장, 기존 endpoint 재사용, stale state cleanup, cleanup 실패 반환을 fake broker로 검증한다.
16. timeout/interrupt 경로를 바꿀 때는 내부 broker session state가 cleanup되고 같은 workspace에서 후속 실행이 정상 시작되는지 검증한다.
17. 외부 `BUILT_CODEX_BROKER_ENDPOINT` 경로는 provider 소유 process가 아니므로 timeout cleanup 대상에서 제외되는지 확인한다.
18. 전체 테스트는 실제 Codex smoke 없이 단위 테스트와 기존 E2E 테스트로 마무리한다.

## 주의사항

- timeout handler에서 `turn/interrupt` 응답을 await한 뒤 settle하지 않는다.
  terminal `error`와 settle이 먼저이고 interrupt/kill은 best-effort cleanup이다.
- `_notificationToEvents`는 phase를 모르는 순수 mapping으로 유지할 수 있지만, runner에 전달되는 event에는 emit 시점에 `phase`가 있어야 한다.
- `phase_end.duration_ms`를 providerMeta에만 넣으면 부족하다.
  표준 event payload에도 duration이 있어야 한다.
- `readline.createInterface`가 테스트용 EventEmitter stdout과 맞지 않을 수 있으므로 data 이벤트 기반 줄 분리 동작을 회귀 테스트로 보호한다.
- vendored Codex plugin runtime을 다시 도입할 때는 ESM/CJS module format, LICENSE/NOTICE, plugin 배치 전제를 먼저 확인한다.
- broker lifecycle 재사용을 추가할 때도 stale endpoint, busy broker, direct fallback, timeout cleanup을 독립 테스트로 나눈다.
- cleanup 실패는 terminal event 이후 새 event로 emit하지 않는다.
  provider event ordering 계약을 유지하고 result의 `cleanupError`나 명확한 broker 시작 오류로 남긴다.
- read-only phase의 `fileChange` 감지는 OS 수준 sandbox가 아니라 Codex app-server notification 계약 기반이다.
  workspace 밖 접근 차단이나 symlink escape 방지를 완료 기준으로 주장하려면 별도 guard/enforcement 설계와 테스트가 필요하다.
- `outputSchema`는 app-server request schema다.
  runner 내부 호환 wrapper를 그대로 전달하면 app-server가 최상위 JSON Schema type을 찾지 못해 실제 smoke에서 실패할 수 있다.
- Codex structured output strict schema 조건은 provider 사전 검증으로 유지한다.
  새 schema가 실패하면 app-server 오류를 기다리지 말고 schema 정의를 고친다.
