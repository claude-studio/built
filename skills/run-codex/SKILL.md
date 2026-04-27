---
name: run-codex
description: Codex provider로 Do/Check/Iter/Report 전체 파이프라인을 자동 실행한다
user-invocable: true
allowed-tools:
  - Read
  - Bash
---

# /built:run-codex — Codex provider 전체 run 실행

feature spec을 읽어 Do→Check→Iter→Report 파이프라인을 실행한다.
provider-preset helper로 `run-request.json`을 생성하여 일반 run 4단계를 모두 Codex provider로 지정한다.
`plan_synthesis`는 opt-in phase이므로 이 명령으로 활성화하지 않는다.

## 인자

`$ARGUMENTS` = feature 이름 (예: `user-auth`, `payment-flow`)

feature 이름이 없으면 다음과 같이 안내하고 중단한다:
> "feature 이름을 입력해주세요. 예: `/built:run-codex user-auth`"

---

## 사전 확인

1. **feature 이름 확정**: `$ARGUMENTS`를 `FEATURE` 변수로 저장한다. 공백이나 대문자가 있으면 kebab-case로 정규화한다 (예: `User Auth` → `user-auth`).

2. **`.built/features/<FEATURE>.md` 존재 여부**: Bash로 확인한다. 없으면:
   > "`.built/features/<FEATURE>.md`가 없습니다. `/built:plan <FEATURE>`을 먼저 실행해주세요."

---

## 실행

provider-preset helper로 `codex-run` run-request를 생성한 뒤 파이프라인을 실행한다:

```bash
# 대상 프로젝트 루트 cwd를 유지한다. SCRIPT_DIR는 built plugin/repo의 scripts 절대 경로다.
: "${BUILT_PLUGIN_DIR:?BUILT_PLUGIN_DIR must point to the installed built plugin/repo path}"
SCRIPT_DIR="$(cd "$BUILT_PLUGIN_DIR/scripts" && pwd -P)"
node "$SCRIPT_DIR/provider-preset.js" <FEATURE> --preset codex-run
node "$SCRIPT_DIR/run.js" <FEATURE>
```

백그라운드로 실행하려면:

```bash
# 대상 프로젝트 루트 cwd를 유지한다. SCRIPT_DIR는 built plugin/repo의 scripts 절대 경로다.
: "${BUILT_PLUGIN_DIR:?BUILT_PLUGIN_DIR must point to the installed built plugin/repo path}"
SCRIPT_DIR="$(cd "$BUILT_PLUGIN_DIR/scripts" && pwd -P)"
node "$SCRIPT_DIR/provider-preset.js" <FEATURE> --preset codex-run
node "$SCRIPT_DIR/run.js" <FEATURE> --background
```

---

## 실행 중 동작

파이프라인은 4단계를 순서대로 실행한다:

1. **Do** — Codex provider가 feature spec에 따라 코드 구현 (`scripts/do.js`)
2. **Check** — Codex provider가 구현 결과 검토, `needs_changes` 또는 `approved` 판정 (`scripts/check.js`)
3. **Iter** — `needs_changes` 시 Codex provider가 수정 반복 (최대 `BUILT_MAX_ITER`회, 기본 3) (`scripts/iter.js`)
4. **Report** — Codex provider가 최종 보고서 생성 (`scripts/report.js`)

`codex-run` preset은 `run-request.json`에 다음 provider routing을 기록한다:

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

`providers.plan_synthesis`는 기록하지 않는다.

각 단계 간 `.built/runtime/runs/<FEATURE>/state.json`이 갱신된다:
- `phase`: 현재 단계 (`do` / `check` / `iter` / `report`)
- `status`: `running` / `completed` / `failed`
- `pid`: 실행 중인 프로세스 ID
- `heartbeat`: 마지막 갱신 시각

환경변수:
- `MULTICA_AGENT_TIMEOUT` — 각 단계 타임아웃 (기본 30분, 예: `60m`, `3600s`)
- `BUILT_MAX_ITER` — Iter 최대 반복 횟수 (기본 3)

---

## 완료 후 안내

성공 시:
```
파이프라인 완료! (preset: codex-run)

결과 파일:
- .built/features/<FEATURE>/do-result.md
- .built/features/<FEATURE>/check-result.md
- .built/features/<FEATURE>/report.md
- .built/runtime/runs/<FEATURE>/state.json  (status: completed)
- .built/runtime/runs/<FEATURE>/run-request.json  (providers: codex-run)
```

실패 시 오류 메시지를 출력하고, `state.json`의 `last_error` 필드를 확인하도록 안내한다:
```bash
cat .built/runtime/runs/<FEATURE>/state.json
```

---

## 상태 폴링 (백그라운드 실행 시)

백그라운드 실행 후 상태를 확인하려면:

```bash
# 현재 상태
cat .built/runtime/runs/<FEATURE>/state.json

# 실시간 모니터링
watch -n 2 cat .built/runtime/runs/<FEATURE>/state.json
```

`status: completed` 또는 `status: failed`가 될 때까지 폴링한다.

---

## 주의

- 이 명령은 대상 프로젝트 루트에서 실행한다.
- marketplace/plugin cache로 `cd`하지 않고, 대상 프로젝트 루트 cwd에서 plugin script를 절대 경로로 호출한다.
- `provider-preset.js`는 대상 프로젝트의 `.built/runtime/runs/<FEATURE>/run-request.json`만 작성한다.
- `codex-run`은 일반 run 4단계용 preset이다. `plan_synthesis`까지 Codex로 실행하는 advanced preset은 별도 opt-in으로 다룬다.
