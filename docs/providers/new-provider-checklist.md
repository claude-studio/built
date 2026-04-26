# 신규 provider adapter 추가 체크리스트

작성일: 2026-04-26 KST

built에 새 provider(예: Gemini, GPT-4o 등)를 추가할 때 필요한 파일과 준수 항목을 정리한다.

## 필요한 파일

| 파일 | 설명 |
| --- | --- |
| `src/providers/<name>.js` | provider adapter 구현. `scaffold-template.js`를 복사해 시작한다. |
| `test/providers-<name>.test.js` | provider adapter 단위 테스트. |

## 등록 필수

`src/providers/config.js`의 `VALID_PROVIDERS` Set에 provider 이름을 추가한다.

```js
const VALID_PROVIDERS = new Set(['claude', 'codex', '<name>']);
```

추가하지 않으면 `parseProviderConfig`가 "알 수 없는 provider" 오류를 던진다.

## runWorker 형태 (필수)

```js
async function run<Provider>({ prompt, model, onEvent, sandbox, timeout_ms, signal }) {
  // ...
  return { success: boolean, exitCode: number, error?: string, failure?: object };
}
```

- `prompt`: 필수. 없으면 `TypeError`를 throw한다.
- `onEvent`: optional. 표준 이벤트를 받는 콜백.
- `sandbox`: `'read-only'` 또는 `'workspace-write'`. `do`/`iter` phase는 `'workspace-write'` 필요.
- `signal`: `AbortSignal`. `signal.aborted`가 true이면 즉시 interrupted failure로 종료한다.
- `timeout_ms`: 타임아웃 ms. 미제공 시 기본값(30분)을 사용한다.

## 표준 이벤트 emit 체크리스트

docs/contracts/provider-events.md의 전체 계약을 따른다. 핵심 항목:

- [ ] 첫 이벤트는 반드시 `phase_start`다.
- [ ] `phase_end` 또는 `error` 중 하나로 종료한다. 둘 다 emit하지 않는다.
- [ ] terminal 이벤트 이후 추가 이벤트를 emit하지 않는다.
- [ ] `tool_call`은 가능하면 같은 `id`의 `tool_result`와 짝을 이룬다.
- [ ] 이벤트 payload는 JSON 직렬화 가능해야 한다.

### 필수 이벤트 형식

```json
{ "type": "phase_start", "phase": "do", "provider": "<name>", "model": "...", "timestamp": "..." }
{ "type": "text_delta",  "phase": "do", "text": "...", "timestamp": "..." }
{ "type": "tool_call",   "phase": "do", "id": "tc1", "name": "commandExecution", "summary": "...", "timestamp": "..." }
{ "type": "tool_result", "phase": "do", "id": "tc1", "name": "commandExecution", "status": "completed", "exit_code": 0, "timestamp": "..." }
{ "type": "phase_end",   "phase": "do", "status": "completed", "duration_ms": 12345, "timestamp": "..." }
{ "type": "error",       "phase": "do", "message": "...", "retryable": false, "failure": { ... }, "timestamp": "..." }
```

### optional 이벤트

```json
{ "type": "usage", "phase": "do", "input_tokens": 1000, "output_tokens": 500, "cost_usd": 0.01, "timestamp": "..." }
```

## failure taxonomy 체크리스트

`src/providers/failure.js`의 `createFailure`와 `FAILURE_KINDS`를 사용한다. 직접 failure 객체를 구성하지 않는다.

| 상황 | kind |
| --- | --- |
| 인증/토큰 오류 | `auth` |
| 설정 오류 | `config` |
| sandbox 정책 위반 | `sandbox` |
| 타임아웃 | `timeout` |
| AbortSignal/사용자 중단 | `interrupted` |
| CLI 없음, 서버 미지원 | `provider_unavailable` |
| 응답 파싱 오류, 비정상 응답 | `model_response` |
| raw event 파싱 실패 | `runner_normalize` |
| 파일 쓰기 실패 | `runner_io` |
| 기타 | `unknown` (debug_detail 필수) |

- [ ] `sanitizeDebugDetail`로 토큰/경로를 마스킹한 뒤 `debug_detail`에 저장한다.
- [ ] `failureToEventFields(failure)`를 사용해 error 이벤트 필드를 생성한다.

## 파일 직접 쓰기 금지

- [ ] provider adapter에서 `fs.writeFile`, `fs.writeFileSync`, `fs.appendFile` 등을 직접 호출하지 않는다.
- [ ] 파일 기록은 `pipeline-runner.js`와 `progress-writer.js`가 담당한다.
- [ ] `test/providers-compliance.test.js`의 compliance fake 테스트가 이 규칙을 검증한다.

## sandbox 지원 체크리스트

- [ ] `sandbox` 값을 받아 provider 실행에 전달한다.
- [ ] `do`/`iter` phase에서 `read-only` sandbox는 설정 오류(`config` failure)로 처리하거나 상위(config.js)에서 차단한다.
- [ ] provider-specific sandbox 값 매핑이 필요하면 adapter 내에 매핑 테이블을 둔다. (codex.js 참고)

## 단위 테스트 체크리스트

`test/providers-<name>.test.js`에 아래 항목을 검증한다.

- [ ] `prompt` 미제공 시 `TypeError` throw
- [ ] 정상 종료: `{ success: true, exitCode: 0 }` 반환
- [ ] 비정상 종료: `{ success: false, exitCode: N, failure }` 반환
- [ ] `onEvent` 콜백으로 `phase_start` → (text_delta, tool_call, tool_result) → `phase_end` 순서 확인
- [ ] `onEvent` 미제공 시 crash 없음
- [ ] spawn/연결 오류 시 `provider_unavailable` failure 반환
- [ ] 타임아웃 시 `timeout` failure 반환
- [ ] `AbortSignal` abort 시 `interrupted` failure 반환
- [ ] compliance fake 테스트: 파일 직접 쓰기 시 테스트 실패 (`test/providers-compliance.test.js`)

## 추가 등록 항목

필요에 따라 다음을 확인한다.

- `pipeline-runner.js`: 새 provider를 호출하는 분기 추가 여부
- `src/providers/event-normalizer.js`: raw event를 표준 이벤트로 변환하는 `normalize<Provider>` 함수 추가 여부
- `docs/contracts/provider-events.md`: 새 provider의 raw event 매핑 표 추가 여부
- `docs/contracts/provider-config.md`: 새 provider 관련 설정 항목 추가 여부
