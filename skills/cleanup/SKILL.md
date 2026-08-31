---
name: cleanup
description: 완료된 feature의 worktree와 산출물을 정리한다. running 상태이면 거부.
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# /built:cleanup

완료(done/aborted/failed)된 feature의 worktree, 산출물, registry 항목을 일괄 정리합니다.

## 사용법

```
/built:cleanup <feature> [--archive]
/built:cleanup --all [--archive]
```

- `<feature>`: 정리할 feature 이름 (단일 정리)
- `--all`: done / aborted / failed 상태인 feature 전체를 일괄 정리
- `--archive`: `.built/features/<feature>/` 를 삭제하지 않고 `.built/archive/<feature>/` 로 이동

## 실행 방법

대상 프로젝트 루트 cwd를 유지한 상태에서 built plugin/repo의 script를 절대 경로로 호출합니다.

```bash
: "${BUILT_PLUGIN_DIR:?BUILT_PLUGIN_DIR must point to the installed built plugin/repo path}"
SCRIPT_DIR="$(cd "$BUILT_PLUGIN_DIR/scripts" && pwd -P)"
node "$SCRIPT_DIR/cleanup.js" <feature> [--archive]
node "$SCRIPT_DIR/cleanup.js" --all [--archive]
```

## 출력 예시

단일 정리 성공:
```
worktree removed: /path/to/.claude/worktrees/user-auth
features dir removed: /path/to/.built/features/user-auth
runtime run dir removed: /path/to/.built/runtime/runs/user-auth
registry: unregistered 'user-auth'
lock removed: user-auth.lock

Cleaned up feature 'user-auth'.
```

running 상태 거부:
```
Skipped: feature 'user-auth' is currently running (status=running). Stop it first with /built:abort.
```

일괄 정리:
```
[ok]   user-auth
         worktree removed: ...
         features dir removed: ...
         ...
[skip] payment: status is 'running' (not eligible for cleanup)

Done: 1 cleaned, 1 skipped.
```

## 동작

1. `.built/runtime/runs/<feature>/state.json` 을 읽어 `status == running` 이면 거부 (안전 장치)
2. 미적용 변경은 `/built:apply <feature> --dry-run`을 안내하고 정리를 거부
3. patch 적용 완료 상태는 기록된 patch 해시와 현재 worktree 변경이 같을 때만 제거 허용
4. `git worktree remove .claude/worktrees/<feature> --force` 실행 (없으면 무시)
5. `.built/features/<feature>/` 아카이빙(`--archive`) 또는 삭제
6. `.built/runtime/runs/<feature>/` 삭제
7. `.built/runtime/registry.json` 에서 해당 feature unregister
8. `.built/runtime/locks/<feature>.lock` 삭제 (없으면 무시)

`--all` 플래그 사용 시:
- `registry.json` 에 등록된 feature 중 `done / completed / aborted / failed` 상태인 것을 모두 정리
- `registry.json` 에 없더라도 `.built/runtime/runs/` 하위에서 종료 상태 feature를 추가 탐지

## 주의

- **running 상태 feature는 정리하지 않습니다.** 먼저 `/built:abort <feature>` 로 중단하세요.
- root 미적용 worktree는 먼저 `/built:apply <feature> --dry-run`으로 확인하세요.
- `state_recovery_required`는 정리하지 않고 먼저 `/built:apply <feature> --recover-state`로 lifecycle state를 복구하세요.
- apply 후 worktree를 다시 수정하면 cleanup은 새 변경을 보존하기 위해 중단합니다.
- 외부 npm 패키지 없음. Node.js 20+ 필요.
- 대상 프로젝트 루트에서 실행합니다.
- `--archive` 없이 실행하면 `.built/features/<feature>/` 가 **영구 삭제**됩니다.
