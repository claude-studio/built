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

```json
{
  "type": "error",
  "phase": "do",
  "message": "codex app-server exited unexpectedly.",
  "retryable": true,
  "timestamp": "2026-04-26T00:00:30.000Z"
}
```

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
