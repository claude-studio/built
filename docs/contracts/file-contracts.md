# built file contracts

작성일: 2026-04-26 KST

이 문서는 provider 전환 이후에도 유지해야 하는 built 파일 계약을 정의한다. Claude provider와 Codex provider는 내부 실행 방식이 달라도 이 파일 계약을 동일하게 만족해야 한다.

## 원칙

- provider는 built 결과 파일을 직접 쓰지 않는다.
- provider는 실행 결과와 표준 이벤트를 runner에 반환한다.
- 파일 쓰기는 built runner와 writer 계층이 담당한다.
- phase lifecycle의 SSOT는 `.built/runtime/runs/<feature>/state.json`이다.
- provider 실행 관찰 정보의 SSOT는 `.built/features/<feature>/progress.json`이다.
- result markdown은 사람이 읽고 review할 수 있는 phase 산출물이다.

## run-request.json

경로:

```text
.built/runtime/runs/<feature>/run-request.json
```

소유자:

- 작성: plan/init 계층
- 읽기: run/do/check/iter/report 계층
- provider 직접 수정 금지

역할:

- Plan에서 Run으로 넘기는 handoff snapshot
- provider 선택 전 공통 입력의 시작점

현재 필드:

```json
{
  "featureId": "user-auth",
  "planPath": ".built/features/user-auth.md",
  "model": "claude-opus-4-5",
  "createdAt": "2026-04-26T00:00:00.000Z"
}
```

provider 전환 후 확장 후보:

```json
{
  "providers": {
    "plan_synthesis": "codex",
    "do": {
      "name": "codex",
      "model": null,
      "effort": "high",
      "sandbox": "workspace-write",
      "timeout_ms": 1800000
    },
    "check": "claude"
  }
}
```

불변 조건:

- `featureId`, `planPath`, `createdAt`은 생성 후 의미가 바뀌면 안 된다.
- provider 설정은 phase 실행 전에 확정되어야 한다.
- provider가 run-request를 직접 patch하지 않는다.

## state.json

경로:

```text
.built/runtime/runs/<feature>/state.json
```

소유자:

- 작성/갱신: orchestrator (`scripts/run.js`, lifecycle command)
- 읽기: status/abort/resume/cleanup
- provider 직접 수정 금지

역할:

- phase lifecycle 상태의 SSOT
- 프로세스와 retry 상태를 추적

현재 필드:

```json
{
  "feature": "user-auth",
  "phase": "do",
  "status": "running",
  "pid": 12345,
  "heartbeat": null,
  "startedAt": "2026-04-26T00:00:00.000Z",
  "updatedAt": "2026-04-26T00:00:10.000Z",
  "attempt": 1,
  "last_error": null,
  "last_failure": null
}
```

`last_failure` 필드 (실패 시 runner가 progress.json에서 승격):

```json
{
  "last_failure": {
    "kind": "auth",
    "code": "codex_auth_required",
    "retryable": false,
    "blocked": true
  }
}
```

`last_failure.action`은 status/report에서 사용자에게 보여주는 다음 조치다.
provider raw error와 내부 진단 문자열은 이 필드에 넣지 않는다.

provider 전환 후 필수 메타 후보:

```json
{
  "provider": "codex",
  "model": "gpt-5.5",
  "duration_ms": 123456
}
```

불변 조건:

- `phase`와 `status`는 orchestrator만 변경한다.
- provider 실패는 provider return value로 runner에 전달하고, runner가 `state.json`에 반영한다.
- `progress.json`의 cost/tokens/status가 `state.json` lifecycle을 대체하지 않는다.
- `last_failure`는 orchestration 판단에 필요한 요약만 담는다. provider debug 전문은 넣지 않는다.

## progress.json

경로:

```text
.built/features/<feature>/progress.json
```

소유자:

- 작성: built progress writer
- 읽기: status/cost/iter/run cost guard
- provider 직접 수정 금지

역할:

- 현재 phase 실행 관찰 정보
- status 화면과 cost guard에 필요한 snapshot

현재 필드:

```json
{
  "feature": "user-auth",
  "phase": "do",
  "session_id": "sess_abc",
  "turn": 1,
  "tool_calls": 2,
  "last_text": "작업 요약...",
  "cost_usd": 0,
  "input_tokens": 0,
  "output_tokens": 0,
  "started_at": "2026-04-26T00:00:00.000Z",
  "updated_at": "2026-04-26T00:00:10.000Z",
  "status": "completed",
  "last_error": null,
  "last_failure": null
}
```

실패 시 `last_failure` 예시:

```json
{
  "status": "failed",
  "last_error": "Codex 인증이 필요합니다. codex login 상태를 확인하세요.",
  "last_failure": {
    "kind": "auth",
    "code": "codex_auth_required",
    "retryable": false,
    "blocked": true,
    "action": "codex login을 실행한 뒤 다시 시도하세요."
  }
}
```

provider 전환 원칙:

- `cost_usd`, `input_tokens`, `output_tokens`는 optional metric으로 취급한다.
- provider가 usage를 제공하지 않으면 `0` 또는 `null`로 표현할 수 있다.
- `provider`, `model`, `thread_id`, `turn_id`, `duration_ms`는 가능하면 기록한다.
- progress는 append-only가 아니라 최신 snapshot이다.
- `last_error`, `last_failure.action`, result markdown 같은 public summary 필드는 사용자 조치 중심 문자열만 담는다.
- `debug_detail`, raw provider stderr/stdout, 내부 daemon path, workspace UUID, token/chat id 후보는 public summary 필드에 넣지 않는다.

## logs

경로:

```text
.built/features/<feature>/logs/<phase>.jsonl
```

소유자:

- 작성: built progress writer
- 읽기: 디버깅/감사
- provider 직접 append 금지

역할:

- 표준 provider event 또는 raw-normalized event를 JSONL로 누적 기록

불변 조건:

- 로그에 raw provider event를 남기더라도 저장 전 redaction helper를 거쳐야 한다.
- `failure.debug_detail`은 로그와 디버그 전용 경로에만 허용되며, `progress.json`, `state.json`, result markdown, notification 문구로 승격하지 않는다.
- 사용자-facing 문서와 artifact에는 `/Users/<name>`, `/home/<name>`, `~/multica_workspaces/<workspace-id>/...`, Codex local daemon path, workspace UUID 원문을 남기지 않는다.

- 한 줄은 하나의 JSON 객체다.
- 같은 phase 재실행 시 append 정책과 truncate 정책은 runner가 결정한다.
- 민감 정보는 writer 또는 sanitize 단계에서 처리한다.

## plan-draft.md

경로:

```text
.built/runs/<feature>/plan-draft.md
```

소유자:

- 작성/갱신/삭제: `/built:plan` skill이 호출하는 `scripts/plan-draft.js`
- 읽기: `/built:plan` 사전 확인과 세션 재개 흐름
- provider 직접 수정 금지

역할:

- Plan/Design 인터뷰 중 Phase 1~4 응답을 임시 저장한다.
- 세션이 끊겼을 때 target project에서 이어서 진행할 수 있게 한다.
- Phase 5 저장이 완료되면 삭제된다.

project root 계약:

- 기본 target project root는 `process.cwd()`다.
- plugin repo 밖 target project에서 실행할 때도 `node -e "require('/path/to/plugin/scripts/plan-draft.js').write(...)"`는 target project cwd에서 실행해야 한다.
- 자동화 runner가 cwd를 보장할 수 없으면 `--project-root <path>`, `BUILT_PROJECT_ROOT`, 또는 `planDraft.write(feature, content, { projectRoot })`처럼 명시 root를 전달한다.
- `__dirname` 또는 plugin repo root는 draft 저장 위치로 사용하지 않는다.

불변 조건:

- draft는 `.built/runs/<feature>/plan-draft.md`에만 저장한다.
- target project의 `.built/runs`와 plugin repo의 `.built/runs`를 혼동하면 안 된다.
- 이 파일은 복구용 임시 artifact이며 feature spec, `run-request.json`, `state.json`의 SSOT를 대체하지 않는다.

## phase result markdown

경로:

```text
.built/features/<feature>/do-result.md
.built/features/<feature>/check-result.md
.built/features/<feature>/report.md
```

소유자:

- 작성: built result writer 또는 phase script
- 읽기: 다음 phase, report, review
- provider 직접 작성 금지

역할:

- 사람이 읽는 phase 결과
- 다음 phase에 전달되는 canonical evidence

공통 원칙:

- frontmatter는 기계 파싱 가능해야 한다.
- 본문은 provider 최종 출력 또는 built normalize 결과를 담는다.
- provider가 달라도 파일 위치와 필수 frontmatter 의미는 유지한다.

`do-result.md` 최소 frontmatter:

```yaml
---
feature_id: user-auth
status: completed
model: gpt-5.5
cost_usd: 0
duration_ms: 123456
created_at: "2026-04-26T00:00:00.000Z"
---
```

`check-result.md` 최소 의미:

- `status: approved | needs_changes`
- `issues` 목록
- `acceptance_criteria_results` 목록
- 다음 iter가 이해할 수 있는 수정 필요 항목

`report.md` 최소 의미:

- 최종 결과 요약
- 검증 결과
- 미완료/리스크

## 동일성 기준

provider 전환의 동일성은 "같은 코드 diff"가 아니다. 동일성 기준은 다음이다.

- 같은 파일 경로에 결과물이 생성된다.
- 같은 필수 필드가 존재한다.
- 같은 phase lifecycle 상태 전이가 일어난다.
- 같은 status/list/cost/report 명령이 동작한다.
- 같은 acceptance criteria와 검증 명령으로 완료 여부를 판정한다.
