# built provider events

작성일: 2026-04-26 KST

이 문서는 provider가 built runner에 전달해야 하는 표준 이벤트를 정의한다. Claude stream-json과 Codex app-server notification은 모두 이 이벤트로 정규화되어야 한다.

## 원칙

- provider raw event는 runner 외부 계약이 아니다.
- built writer는 표준 provider event를 기준으로 `progress.json`과 `logs/<phase>.jsonl`을 갱신한다.
- event payload는 JSON 직렬화 가능해야 한다.
- `usage`와 `cost`는 optional이다.

## 필수 이벤트

### phase_start

phase 실행 시작.

```json
{
  "type": "phase_start",
  "phase": "do",
  "provider": "codex",
  "model": "gpt-5.5",
  "timestamp": "2026-04-26T00:00:00.000Z"
}
```

### text_delta

assistant 출력 또는 진행 메시지.

```json
{
  "type": "text_delta",
  "phase": "do",
  "text": "구현을 진행합니다.",
  "timestamp": "2026-04-26T00:00:01.000Z"
}
```

### tool_call

도구/명령/파일 변경 시작.

```json
{
  "type": "tool_call",
  "phase": "do",
  "id": "tool_1",
  "name": "commandExecution",
  "summary": "npm test 실행",
  "timestamp": "2026-04-26T00:00:02.000Z"
}
```

### tool_result

도구/명령/파일 변경 완료.

```json
{
  "type": "tool_result",
  "phase": "do",
  "id": "tool_1",
  "name": "commandExecution",
  "status": "completed",
  "exit_code": 0,
  "summary": "npm test 통과",
  "timestamp": "2026-04-26T00:00:10.000Z"
}
```

### phase_end

phase 실행 종료.

```json
{
  "type": "phase_end",
  "phase": "do",
  "status": "completed",
  "duration_ms": 123456,
  "timestamp": "2026-04-26T00:02:03.000Z"
}
```

### error

provider 또는 runner 실행 오류.

기존 `message`와 `retryable` 필드는 하위 호환 필드로 유지한다.
`failure` 객체가 있는 경우 `failure.user_message`와 `failure.retryable`을 우선 사용한다.

```json
{
  "type": "error",
  "phase": "do",
  "message": "Codex 인증이 필요합니다. codex login 상태를 확인하세요.",
  "retryable": false,
  "failure": {
    "kind": "auth",
    "code": "codex_auth_required",
    "user_message": "Codex 인증이 필요합니다. codex login 상태를 확인하세요.",
    "action": "codex login을 실행한 뒤 다시 시도하세요.",
    "retryable": false,
    "blocked": true,
    "debug_detail": "codex login status returned non-zero",
    "raw_provider": "codex"
  },
  "timestamp": "2026-04-26T00:00:30.000Z"
}
```

`failure.kind` 값 목록:
- `auth`: 인증/권한/토큰 문제. `blocked=true`, `retryable=false`.
- `config`: provider 이름, sandbox, phase 설정 오류. `blocked=true`, `retryable=false`.
- `sandbox`: 권한 정책으로 phase 목적 달성 불가. `blocked=true`, `retryable=false`.
- `timeout`: provider turn/process 타임아웃. `blocked=false`, `retryable=true`.
- `interrupted`: 사용자 또는 runner의 AbortSignal/interrupt 중단. `blocked=false`, `retryable=false`.
- `provider_unavailable`: CLI 없음, app-server 미지원, broker 문제 등. retryable은 상황별.
- `model_response`: 오류 result 반환, structured output/JSON parse 실패. `retryable=true`.
- `runner_normalize`: raw event 파싱 실패, 표준 이벤트 ordering 위반. `retryable=false`.
- `runner_io`: result/progress/state 파일 쓰기 실패. `blocked=true`, `retryable=false`.
- `unknown`: 미분류 fallback. `debug_detail` 필수.

`failure.action`은 사용자-facing 다음 조치 문장이다. `status` 출력과 실패 result Markdown은 이 값을
`다음 조치`로 노출한다. provider raw stderr, app-server notification 전문, secret 후보, 홈 경로 같은
진단 문자열은 `user_message`나 `action`에 넣지 않고 sanitize된 `debug_detail`에만 둔다.

## Optional 이벤트

### usage

토큰/비용 정보. provider마다 의미가 다르므로 필수로 요구하지 않는다.

```json
{
  "type": "usage",
  "phase": "do",
  "input_tokens": 1000,
  "output_tokens": 500,
  "cost_usd": 0.12,
  "timestamp": "2026-04-26T00:02:03.000Z"
}
```

## 순서 규칙

- `phase_start`는 한 phase에서 첫 번째 이벤트여야 한다.
- `phase_end` 또는 `error`는 terminal 이벤트다.
- terminal 이벤트 이후 같은 provider run에서 추가 이벤트를 emit하지 않는다.
- retry 가능한 중간 attempt 실패는 terminal `error`로 emit하지 않는다. 최종 attempt 또는 즉시 실패해야 하는 오류만 terminal 이벤트로 기록한다.
- `tool_call`은 가능하면 같은 `id`를 가진 `tool_result`와 짝을 이룬다.
- `tool_result`가 없는 `tool_call`은 provider crash 또는 interrupted run에서만 허용한다.
- `usage`는 중간 또는 `phase_end` 직전에 emit할 수 있다.
- `error` 이후 별도의 `phase_end`는 emit하지 않는다. runner가 실패 상태를 정리한다.

## Codex app-server 매핑

| provider event | Codex source |
| --- | --- |
| `phase_start` | provider run 시작 |
| `text_delta` | `agentMessage` completed 또는 delta notification |
| `tool_call` | `item/started` 중 `commandExecution`, `mcpToolCall`, `dynamicToolCall`, `fileChange` |
| `tool_result` | `item/completed` 중 위 item type |
| `phase_end` | `turn/completed` |
| `error` | `error` notification 또는 request 실패 |
| `usage` | Codex가 usage/cost를 제공할 때만 |

## Claude stream-json 매핑

| provider event | Claude source |
| --- | --- |
| `phase_start` | `system/init` 또는 process start |
| `text_delta` | `assistant.message.content[type=text]` |
| `tool_call` | `assistant.message.content[type=tool_use]` |
| `tool_result` | `tool_result` |
| `phase_end` | `result` |
| `error` | `result.is_error`, process error, timeout |
| `usage` | `assistant.message.usage`, `result.usage`, `total_cost_usd` |

## Hook Payload 정책

### Provider-aware context

`runHooks`는 hook 프로세스에 다음 환경변수를 주입한다.
provider phase, 완료 상태, 실패 요약을 hook에서 참조할 수 있도록 한다.

| 환경변수 | 값 예시 | 설명 |
| --- | --- | --- |
| `BUILT_HOOK_POINT` | `after_do` | 현재 hook point |
| `BUILT_FEATURE` | `my-feature` | feature 이름 |
| `BUILT_PROJECT_ROOT` | `/path/to/project` | 프로젝트 루트 경로 |
| `BUILT_WORKTREE` | `/path/to/worktree` | execution worktree 경로 (있을 때만) |
| `BUILT_PREVIOUS_RESULT` | `/path/to/result.md` | 이전 결과 파일 경로 (있을 때만) |
| `BUILT_PROVIDER` | `claude`, `codex` | provider 이름 (미설정 시 빈 문자열) |
| `BUILT_PHASE` | `do`, `check`, `report` | provider가 실행한 phase (미설정 시 빈 문자열) |
| `BUILT_PROVIDER_STATUS` | `completed`, `failed`, `interrupted` | phase 완료 상태 (미설정 시 빈 문자열) |
| `BUILT_FAILURE_SUMMARY` | `auth error: ...` | 실패 요약 (실패 시만 설정, 기본 빈 문자열) |
| `BUILT_MODEL` | `claude-sonnet-4-5`, `gpt-5.5` | 모델 식별자 (미설정 시 빈 문자열) |

`BUILT_PROVIDER`, `BUILT_PHASE`, `BUILT_PROVIDER_STATUS`, `BUILT_FAILURE_SUMMARY`, `BUILT_MODEL`은
호출자가 `providerContext` 옵션을 전달할 때만 의미 있는 값을 가진다. 전달하지 않으면 모두 빈 문자열이다.

`condition` 표현식에서는 현재 `feature.*`와 `check.*` 경로만 지원한다.
provider context 필드는 환경변수로만 접근 가능하며 condition 표현식 경로로는 지원하지 않는다.

### 민감정보 제외 정책

hook 프로세스에 전달하는 환경변수에서 다음 접미어를 가진 키는 제외한다.

```
_KEY, _SECRET, _TOKEN, _PASSWORD, _CREDENTIAL,
_PRIVATE_KEY, _CLIENT_SECRET, _AUTH_TOKEN,
_REFRESH_TOKEN, _ACCESS_TOKEN
```

이유: hook은 사용자 정의 임의 프로세스이므로 provider 인증 키, API 토큰,
외부 서비스 시크릿이 hook 환경으로 노출되어서는 안 된다.

hook이 외부 서비스에 접근해야 한다면 hook 자체 설정(예: `.env.hooks`)에서 읽도록 작성해야 한다.
`process.env`를 통한 암묵적 전파에 의존하지 않는다.

비범위: hook이 provider 파일 계약(`run-request.json`, `state.json`, `progress.json`)을 직접 쓰거나
built runner 내부 상태를 수정하는 것은 허용하지 않는다.

### Hook 실패가 provider run 완료 상태에 미치는 영향

hook 실패는 provider 실행 자체의 성공/실패와 별개로 관리된다.

| hook point | halt_on_fail | 영향 |
| --- | --- | --- |
| `before_do` | `true` | Do 실행 전 파이프라인 중단. `check-result.md`를 `needs_changes`로 강제하고 iter 루프 트리거. |
| `before_do` | `false` | 경고 기록 후 Do 진행. |
| `after_do` | `true` | Do 완료 후 파이프라인 중단. Check 진입 차단. |
| `after_do` | `false` | 경고 기록 후 Check 진행. |
| `before_check` | `true` | Check 실행 전 파이프라인 중단. |
| `before_check` | `false` | 경고 기록 후 Check 진행. |
| `after_check` | `true` | `check-result.md` status가 `approved`여도 `needs_changes`로 강제. iter 루프 트리거. |
| `after_check` | `false` | `check-result.md` issues[]에 경고로만 기록. status 유지. |
| `before_report` | `true` | Report 실행 전 파이프라인 중단. |
| `before_report` | `false` | 경고 기록 후 Report 진행. |
| `after_report` | `true` | Report 완료 후 파이프라인 중단. |
| `after_report` | `false` | 경고 기록 후 정상 종료. |

원칙: hook 실패는 provider run을 소급하여 실패로 바꾸지 않는다.
`halt_on_fail: true`는 다음 단계 진입을 막을 뿐이며, 이미 완료된 provider phase 결과 파일은 변경하지 않는다.
