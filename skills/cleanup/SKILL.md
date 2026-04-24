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

```bash
node scripts/cleanup.js <feature> [--archive]
node scripts/cleanup.js --all [--archive]
```

로컬 개발(`--plugin-dir` 방식)에서는 프로젝트 루트에서:

```bash
node scripts/cleanup.js user-auth
node scripts/cleanup.js user-auth --archive
node scripts/cleanup.js --all
node scripts/cleanup.js --all --archive
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
2. `git worktree remove .claude/worktrees/<feature> --force` 실행 (없으면 무시)
3. `.built/features/<feature>/` 아카이빙(`--archive`) 또는 삭제
4. `.built/runtime/runs/<feature>/` 삭제
5. `.built/runtime/registry.json` 에서 해당 feature unregister
6. `.built/runtime/locks/<feature>.lock` 삭제 (없으면 무시)

`--all` 플래그 사용 시:
- `registry.json` 에 등록된 feature 중 `done / completed / aborted / failed` 상태인 것을 모두 정리
- `registry.json` 에 없더라도 `.built/runtime/runs/` 하위에서 종료 상태 feature를 추가 탐지

## 주의

- **running 상태 feature는 정리하지 않습니다.** 먼저 `/built:abort <feature>` 로 중단하세요.
- 외부 npm 패키지 없음. Node.js 20+ 필요.
- 대상 프로젝트 루트에서 실행합니다.
- `--archive` 없이 실행하면 `.built/features/<feature>/` 가 **영구 삭제**됩니다.
