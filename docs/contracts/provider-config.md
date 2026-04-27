# built provider config

작성일: 2026-04-26 KST

이 문서는 phase별 provider 선택 설정을 정의한다.

phase별 기본값 matrix, 선택 기준, cross-provider review 패턴, 고위험 변경 운영 지침은 `docs/ops/provider-routing-matrix.md`를 참조한다.
Claude/Codex 결과를 같은 입력으로 직접 비교하는 실험 모드는 기본 provider config가 아니라 `docs/ops/provider-comparison-mode.md`의 `comparison` 계약을 사용한다.

## 원칙

- 기본 provider는 기존 동작과 같은 Claude다.
- provider 설정이 없으면 현재 built 동작이 유지되어야 한다.
- provider는 phase 단위로 선택한다.
- `.built/config.json`의 `default_run_profile`은 사람이 읽고 수정하는 기본 실행 구성이다.
- feature별 `run-request.json`은 실행 시점의 normalized snapshot이다.
- `default_run_profile.providers.<phase>` 값은 provider name 문자열만 허용한다. `sandbox`, `model`, `timeout_ms` 같은 ProviderSpec detail은 config에 저장하지 않는다.
- 기본 실행에서 한 phase는 provider 하나만 실행한다.
- Claude/Codex 병렬 비교 실행은 명시적 실험 모드에서만 허용한다.
- 비교 모드는 기존 `providers.<phase>` 필드를 배열로 확장하지 않고 top-level `comparison` 필드와 비교 전용 명령으로 활성화한다.
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

단축형은 provider 이름만 지정한다. model과 timeout은 provider 기본값을 사용하고, sandbox는 provider capability 정책으로 phase별 기본값을 적용한다. Codex 단축형은 `do`/`iter`에서 `workspace-write`, `plan_synthesis`/`check`/`report`에서 `read-only`로 정규화된다.

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

이 목록에 없는 phase key는 설정 오타로 보고 parser 단계에서 실패시킨다. 예를 들어 `plan_synthsis`처럼 opt-in phase 이름을 잘못 쓰면 기본 pipeline으로 조용히 fallback하지 않는다.

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

위 목록에 없는 ProviderSpec 필드는 설정 오타로 보고 실패시킨다. runner는 오류 메시지에 `run-request.json` 경로와 `providers.<phase>` 경로를 함께 표시해야 한다.

## sandbox 정책

- `plan_synthesis`: 기본 `read-only`
- `check`: 기본 `read-only`
- `report`: 기본 `read-only`
- `do`: 파일 변경이 필요하므로 Codex 사용 시 `workspace-write` 필요
- `iter`: 파일 변경이 필요하므로 Codex 사용 시 `workspace-write` 필요

`do`/`iter`에서 `read-only` sandbox를 사용하면 provider가 성공처럼 응답해도 실제 파일 변경이 없을 수 있다. runner는 필요한 경우 phase와 sandbox 조합을 검증해야 한다.

### workspace-write 허용 범위

`workspace-write`는 built feature worktree 안에서 acceptance criteria를 만족하기 위한 파일 변경에만 사용한다.
허용 범위는 다음과 같다.

- feature 구현 파일, 테스트, 구현과 직접 연결된 문서
- built runtime이 소유한 `.built/features/<feature-id>/` 결과물
- runner/control plane이 표준 writer로 기록하는 `state.json`, `progress.json`, 결과 Markdown

`workspace-write`여도 provider가 파일 계약을 직접 소유하지 않는다. provider는 표준 event를 emit하고, 파일 쓰기와 normalization은 runner/control plane이 담당한다.

### read-only phase 쓰기 금지

`plan_synthesis`, `check`, `report`는 read-only phase다.
Codex app-server가 이 phase에서 `fileChange` notification을 보내면 built는 sandbox 실패로 처리한다.
이 실패는 provider 응답 품질 문제가 아니라 phase 목적과 sandbox 권한의 충돌이므로 retry 대상이 아니다.

사용자 조치는 다음 중 하나다.

- 검토/요약 목적이면 prompt와 provider 설정을 수정해 파일 변경을 요구하지 않는다.
- 실제 구현 변경이 필요하면 `do` 또는 `iter` phase에서 `workspace-write` sandbox로 실행한다.

### write-scope guard 후보

다음 경로와 정보는 provider가 직접 변경하지 않도록 guard 후보로 유지한다.
현재 이 문서는 정책 후보를 정리하며, OS 수준 sandbox 신규 구현은 이 범위에 포함하지 않는다.

- `.git/`과 git ref/index/object 파일
- credential 파일과 토큰 후보: `.env*`, credential helper 파일, API key, auth token, SSH key
- local-only config: `.built/config.local.json`, editor/IDE local settings, machine-specific runtime config
- workspace 밖 경로와 symlink를 통한 workspace 탈출 경로
- Multica agent runtime 파일과 built provider runtime 파일의 경계가 섞이는 경로

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

새 `.built/config.json`은 사람이 수정하는 기본 실행 구성으로 다음 값을 포함한다.

```json
{
  "default_run_profile": {
    "providers": {
      "do": "claude",
      "check": "claude",
      "iter": "claude",
      "report": "claude"
    }
  }
}
```

사용자가 Codex를 기본값으로 선택해도 config에는 `"codex"` 문자열만 저장한다. 실행 snapshot을 만들 때 built가 phase capability 정책으로 ProviderSpec을 정규화한다.

```json
{
  "default_run_profile": {
    "providers": {
      "do": "codex",
      "check": "codex",
      "iter": "codex",
      "report": "codex"
    }
  }
}
```

위 config에서 feature별 `run-request.json`을 만들면 providers snapshot은 다음처럼 정규화될 수 있다.

```json
{
  "providers": {
    "do": { "name": "codex", "sandbox": "workspace-write" },
    "check": { "name": "codex", "sandbox": "read-only" },
    "iter": { "name": "codex", "sandbox": "workspace-write" },
    "report": { "name": "codex", "sandbox": "read-only" }
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
