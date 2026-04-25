# built provider config

작성일: 2026-04-26 KST

이 문서는 phase별 provider 선택 설정을 정의한다.

phase별 기본값 matrix, 선택 기준, cross-provider review 패턴, 고위험 변경 운영 지침은 `docs/ops/provider-routing-matrix.md`를 참조한다.

## 원칙

- 기본 provider는 기존 동작과 같은 Claude다.
- provider 설정이 없으면 현재 built 동작이 유지되어야 한다.
- provider는 phase 단위로 선택한다.
- 기본 실행에서 한 phase는 provider 하나만 실행한다.
- Claude/Codex 병렬 비교 실행은 명시적 실험 모드에서만 허용한다.
- built provider와 Multica agent runtime은 별개 축이다.

## 단축형

```json
{
  "providers": {
    "do": "codex",
    "check": "claude"
  }
}
```

단축형은 provider 이름만 지정한다. model, sandbox, timeout은 provider 기본값을 사용한다.

## 상세형

```json
{
  "providers": {
    "plan_synthesis": {
      "name": "codex",
      "model": "gpt-5.5",
      "effort": "high",
      "sandbox": "read-only",
      "timeout_ms": 900000
    },
    "do": {
      "name": "codex",
      "model": "gpt-5.5",
      "effort": "high",
      "sandbox": "workspace-write",
      "timeout_ms": 1800000,
      "max_retries": 1,
      "retry_delay_ms": 250
    },
    "check": {
      "name": "claude",
      "model": "claude-opus-4-5",
      "timeout_ms": 900000
    }
  }
}
```

## phase 키

지원 후보:

- `plan_synthesis`
- `do`
- `check`
- `iter`
- `report`

초기 구현은 기존 phase인 `do`, `check`, `iter`, `report`를 유지하고, `plan_synthesis`는 별도 PR에서 도입한다.

## provider 공통 필드

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| `name` | 예 | `claude` 또는 `codex` |
| `model` | 아니오 | provider별 모델명 |
| `timeout_ms` | 아니오 | phase timeout |
| `max_retries` | 아니오 | retryable 실패를 provider 내부에서 재시도할 최대 횟수. 기본 0 |
| `retry_delay_ms` | 아니오 | retry attempt 사이 대기 시간. 기본 0 |
| `sandbox` | 아니오 | `read-only` 또는 `workspace-write` |
| `effort` | 아니오 | Codex reasoning effort |
| `output_mode` | 아니오 | `text` 또는 `json` |

## sandbox 정책

- `plan_synthesis`: 기본 `read-only`
- `check`: 기본 `read-only`
- `report`: 기본 `read-only`
- `do`: 파일 변경이 필요하므로 Codex 사용 시 `workspace-write` 필요
- `iter`: 파일 변경이 필요하므로 Codex 사용 시 `workspace-write` 필요

`do`/`iter`에서 `read-only` sandbox를 사용하면 provider가 성공처럼 응답해도 실제 파일 변경이 없을 수 있다. runner는 필요한 경우 phase와 sandbox 조합을 검증해야 한다.

## usage/cost 정책

- usage/cost 정규화는 필수 완료 조건이 아니다.
- `cost_usd`, token count는 provider가 제공할 때만 기록한다.
- 운영 디버깅을 위해 `provider`, `model`, `duration_ms`는 가능하면 필수 메타로 기록한다.

## review gate 비결합

Codex plugin의 stop-time review gate는 built phase와 자동 결합하지 않는다.

- built `check` phase는 built가 직접 호출할 때만 실행된다.
- Claude Code session stop hook이 built phase를 자동 트리거하면 안 된다.
- review gate 도입은 별도 운영 결정으로 분리한다.

## provider 결과 품질 정책

- provider가 달라도 같은 입력 묶음과 acceptance criteria를 받아야 한다.
- 완료 판정은 provider 응답이 아니라 test/lint/check 결과로 한다.
- 구현 provider와 review provider는 가능하면 다르게 둔다.
- Codex가 구현한 결과는 Claude가 review하고, Claude가 구현한 결과는 Codex가 review할 수 있다.

## 기본값

설정이 없을 때:

```json
{
  "providers": {
    "do": "claude",
    "check": "claude",
    "iter": "claude",
    "report": "claude"
  }
}
```

## timeout / interrupt / retry 정책

- Claude 기본 timeout은 `MULTICA_AGENT_TIMEOUT` 또는 30분이다.
- Codex 기본 timeout은 `timeout_ms` 미지정 시 30분이다.
- `providers.<phase>.timeout_ms`가 있으면 해당 phase의 provider 호출에 우선 적용한다.
- `AbortSignal` 또는 사용자 interrupt는 provider adapter까지 전달되어 terminal `error(failure.kind=interrupted)`로 종료한다.
- retry는 `max_retries`가 0보다 클 때만 수행한다.
- retry 대상은 `failure.retryable=true`인 실패다. timeout과 broker busy는 retry 가능하고, auth/config/sandbox/interrupted는 즉시 실패한다.
- retry 가능한 중간 attempt 실패는 terminal event로 기록하지 않고 retry log에 attempt, kind/code, reason을 남긴다. 최종 attempt의 success/error만 state/progress/result contract에 반영한다.
