---
name: apply
description: 완료된 execution worktree 결과를 검증 후 명시적으로 root에 적용한다
user-invocable: true
allowed-tools:
  - Bash
---

# /built:apply — execution worktree 결과 적용

완료된 `/built:run`의 execution worktree 결과를 대상 프로젝트 root에 명시적으로 적용한다. `/built:run` 자체는 root를 자동 변경하지 않는다.

## 인자

`$ARGUMENTS` = `<FEATURE> [--dry-run | --recover-state]`

feature 이름이 없으면 다음과 같이 안내하고 중단한다.

> "feature 이름을 입력해주세요. 예: `/built:apply user-auth --dry-run`"

## 실행

이 skill은 대상 프로젝트 root cwd에서 실행한다. helper는 설치된 built plugin/repo의 절대 경로로 호출한다.

먼저 `$ARGUMENTS`의 mode를 확인한다. 일반 apply, `--dry-run`, `--recover-state`는 한 skill invocation에서 정확히 하나만 선택하며 아래 세 경로를 절대 연속 실행하지 않는다. `--dry-run`과 `--recover-state`가 함께 있으면 helper를 호출하지 않고 올바른 사용법을 안내한다.

### `$ARGUMENTS`에 `--dry-run`이 있는 경우

다음 dry-run 명령 하나만 실행하고 skill을 종료한다. 같은 invocation에서 실제 apply 명령을 이어서 실행하지 않는다.

```bash
: "${BUILT_PLUGIN_DIR:?BUILT_PLUGIN_DIR must point to the installed built plugin/repo path}"
SCRIPT_DIR="$(cd "$BUILT_PLUGIN_DIR/scripts" && pwd -P)"
node "$SCRIPT_DIR/apply.js" <FEATURE> --dry-run
```

### `$ARGUMENTS`에 `--recover-state`가 있는 경우

`state_update_failed` 뒤 root와 worktree의 실제 Git evidence를 검증해 lifecycle state만 복구하려는 명시 요청에서 다음 명령 하나만 실행하고 skill을 종료한다. 일반 apply나 dry-run을 이어서 실행하지 않는다.

```bash
: "${BUILT_PLUGIN_DIR:?BUILT_PLUGIN_DIR must point to the installed built plugin/repo path}"
SCRIPT_DIR="$(cd "$BUILT_PLUGIN_DIR/scripts" && pwd -P)"
node "$SCRIPT_DIR/apply.js" <FEATURE> --recover-state
```

### mode 옵션이 없는 경우

사용자가 실제 적용을 명시적으로 요청한 경우에만 다음 명령 하나를 실행한다.

```bash
: "${BUILT_PLUGIN_DIR:?BUILT_PLUGIN_DIR must point to the installed built plugin/repo path}"
SCRIPT_DIR="$(cd "$BUILT_PLUGIN_DIR/scripts" && pwd -P)"
node "$SCRIPT_DIR/apply.js" <FEATURE>
```

preflight만 확인하려면 사용자가 `/built:apply <FEATURE> --dry-run`을 별도로 호출해야 한다. 실제 적용은 mode 옵션이 없는 별도의 명시 호출에서만 수행한다. `--recover-state`는 Git 적용을 실행하지 않고 검증된 state 복구만 수행한다.

## 안전 경계

- `state.json`의 run이 `completed`이고 `root_applied`가 false인 경우만 적용한다.
- state/registry의 path, branch, resultDir pointer가 일치해야 한다.
- root working tree가 clean해야 한다.
- 미커밋 변경과 미적용 commit이 섞인 worktree는 거부한다.
- 미커밋 변경은 binary patch와 `git apply --check`를 통과한 뒤 적용한다.
- commit은 root HEAD에서 fast-forward 가능한 경우에만 `git merge --ff-only`로 적용한다.
- 충돌이나 stale pointer가 있으면 root와 state를 변경하지 않고 machine-readable code와 복구 안내를 출력한다.
- 성공한 뒤에만 state의 `root_apply_*` 필드를 갱신한다.
- `--recover-state`는 state/registry/resultDir pointer와 expected branch를 먼저 확인한다.
- patch 복구는 root/worktree HEAD와 staged/untracked를 포함한 binary diff가 정확히 같을 때만 허용한다.
- fast-forward 복구는 root HEAD가 expected worktree HEAD와 같고 양쪽 working tree가 clean할 때만 허용한다.
- 모호한 evidence에서는 `state_recovery_ambiguous`로 중단하고 root와 state를 모두 변경하지 않는다.
- 복구 시 확인할 수 없는 원래 적용 시각이나 적용 전 commit은 추정해 기록하지 않는다.

이미 적용된 feature를 다시 실행하면 `already_applied` no-op으로 성공한다.
