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
  "max_cost_usd": 2.0,
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

Run 비용 guard:

- `max_cost_usd`는 feature별 Run 시작 전 비용 guard 임계값이다.
- 우선순위는 `run-request.json`의 `max_cost_usd`, `.built/config.json`의 `default_max_cost_usd`, 기본값 `$1.00` 순서다.
- 누적 `progress.json.cost_usd`가 임계값을 넘으면 `/built:run`은 사용자 확인 없이 pipeline을 시작하지 않는다.
- stdin이 닫힌 비대화형 dogfooding/CI/agent 실행은 기본값 `N`으로 중단하며, 출력에 `--allow-cost-overrun` override와 임계값 조정 방법을 남긴다.
- `--allow-cost-overrun`은 명시 opt-in CLI 플래그이며 `run-request.json` 필드가 아니다. 기본 자동 승인으로 바꾸지 않는다.

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
- Claude stream-json 경로와 Codex/fake 표준 이벤트 경로 모두 같은 writer 계층에서 같은 위치에 append한다.

불변 조건:

- 로그에 raw provider event를 남기더라도 저장 전 redaction helper를 거쳐야 한다.
- `failure.debug_detail`은 로그와 디버그 전용 경로에만 허용되며, `progress.json`, `state.json`, result markdown, notification 문구로 승격하지 않는다.
- 사용자-facing 문서와 artifact에는 `/Users/<name>`, `/home/<name>`, `~/multica_workspaces/<workspace-id>/...`, Codex local daemon path, workspace UUID 원문을 남기지 않는다.

- 한 줄은 하나의 JSON 객체다.
- 성공 run은 `phase_start`부터 `phase_end`까지 같은 phase의 이벤트를 append한다.
- 실패 run은 `phase_start`부터 terminal `error`까지 append하며, `error` 뒤의 별도 `phase_end`는 남기지 않는다.
- 같은 phase 재실행 시 append 정책과 truncate 정책은 runner가 결정한다.
- 민감 정보는 writer 또는 sanitize 단계에서 처리한다.

provider별 runtime artifact 차이:

| provider 경로 | 입력 이벤트 | writer | `logs/<phase>.jsonl` 내용 | 필수 동일성 |
| --- | --- | --- | --- | --- |
| Claude | stream-json raw event를 표준 이벤트로 normalize하거나 legacy `progress-writer`가 직접 처리 | `progress-writer` 또는 `standard-writer` | Claude raw event 또는 normalized 표준 이벤트를 redaction 후 append | 경로, JSONL 형식, terminal 성공/실패 event 존재 |
| Codex | app-server notification을 표준 이벤트로 normalize | `standard-writer` | 표준 provider event를 redaction 후 append | 경로, JSONL 형식, terminal `phase_end` 또는 `error` 존재 |
| fake provider | 테스트 fixture의 raw/standard event | `standard-writer` | 표준 provider event를 redaction 후 append | Claude/Codex와 같은 필수 artifact presence |

로그 payload의 세부 필드는 provider 원본 관찰 가능성에 따라 다를 수 있다. 동일성 기준은 raw shape가 아니라 같은 파일 경로, JSONL one-object-per-line 형식, redaction 적용, phase terminal event 보존이다.

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
- 자동화 runner가 cwd를 보장할 수 없으면 `BUILT_PROJECT_ROOT`, 또는 `planDraft.write(feature, content, { projectRoot })`처럼 명시 root를 전달한다.
- `node -e` 호출에서 argv로 root를 넘길 때는 Node 옵션과 script argv를 구분하기 위해 `node -e "require('/path/to/plugin/scripts/plan-draft.js').write(...)" -- --project-root <path>` 형식을 사용한다.
- `__dirname` 또는 plugin repo root는 draft 저장 위치로 사용하지 않는다.

불변 조건:

- draft는 `.built/runs/<feature>/plan-draft.md`에만 저장한다.
- target project의 `.built/runs`와 plugin repo의 `.built/runs`를 혼동하면 안 된다.
- 이 파일은 복구용 임시 artifact이며 feature spec, `run-request.json`, `state.json`의 SSOT를 대체하지 않는다.

## root-context.json

Plan, Design/plan_synthesis, Run 시작 시점에는 root/path 요약을 같은 의미로 남긴다. dogfooding 실패 보고에서는 이 파일 또는 시작 로그만 보고 target project와 plugin repo, runtime artifact 위치를 구분할 수 있어야 한다.

경로:

```text
.built/runs/<feature>/root-context.json
.built/features/<feature>/root-context.json
.built/runtime/runs/<feature>/root-context.json
```

phase별 의미:

| phase | project root | plugin root | runtime root | 주요 artifact |
| --- | --- | --- | --- | --- |
| Plan | target project cwd 또는 명시 `BUILT_PROJECT_ROOT` | helper script가 속한 built plugin/repo | `<project>/.built/runtime` | `.built/runs/<feature>/plan-draft.md` |
| Design / `plan_synthesis` | control plane target project root (`BUILT_PROJECT_ROOT`) | built plugin/repo | `<project>/.built/runtime` | `.built/features/<feature>/plan-synthesis.json`, `.md` |
| Run | canonical target project root | built plugin/repo | `<project>/.built/runtime` | `run-request.json`, `state.json`, `progress.json`, phase result markdown |

공통 필드:

```json
{
  "schema_version": 1,
  "phase": "run",
  "feature": "user-auth",
  "project_root": "/target/project",
  "plugin_root": "/plugin/repo",
  "execution_root": "/target/project/.claude/worktrees/user-auth",
  "runtime_root": "/target/project/.built/runtime",
  "result_root": "/target/project/.built/features/user-auth",
  "artifact_paths": {
    "run_request": "/target/project/.built/runtime/runs/user-auth/run-request.json",
    "kg_draft": "/target/project/kg/issues/USER-AUTH.md"
  },
  "warnings": []
}
```

불변 조건:

- `project_root`는 target project를 가리킨다. plugin package/cache root를 target project로 승격하지 않는다.
- `plugin_root`는 helper code 위치 추적용이다. target project artifact 저장 기준이 아니다.
- Report 단계의 `kg_draft`는 target project root 기준 `kg/issues/<FEATURE>.md`를 가리킨다. 설치된 plugin package/cache의 `kg/issues`에는 target artifact를 쓰지 않는다.
- `runtime_root`는 phase lifecycle artifact의 기준이며 기본값은 `<project_root>/.built/runtime`이다.
- `execution_root`는 provider가 실제 파일을 수정하는 cwd일 수 있다. worktree 실행에서는 target project root와 다를 수 있다.
- `result_root`는 사람이 읽는 phase 결과와 progress/log artifact 위치다.
- `project_root_matches_plugin_root`, `runtime_root_outside_project_root`, `result_root_outside_project_root` warning은 dogfooding 실패 분석에서 root 혼동 후보로 취급한다.
- `provider-doctor`는 feature가 지정된 상태에서 cwd가 plugin/repository root로 보이고 target feature spec이 없으면 hard failure로 처리한다.

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
