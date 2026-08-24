---
title: Run worktree handoff
tags: [ops, run, worktree, handoff]
---

# Run worktree handoff

`/built:run`은 기본적으로 execution worktree에서 Do, Check, Iter, Report를 실행한다.
이 모드에서는 root working tree를 자동으로 변경하지 않는다.

Run 완료 후 canonical 산출물은 다음 위치에 남는다.

- `state.json`: `.built/runtime/runs/<feature>/state.json`
- `report.md`: `state.execution_worktree.result_dir/report.md`
- 실행 branch: `state.execution_worktree.branch`
- 실행 worktree: `state.execution_worktree.path`

## 완료 후 확인

```bash
node scripts/status.js <feature>
git -C <worktree-path> status --short
git -C <worktree-path> diff
```

`status.js`는 `execution_worktree.root_applied`, `apply_status`, `branch`, `path`,
`resultDir`를 표시한다. `root_applied: no`이면 root에는 아직 변경사항이 적용되지 않은 상태다.

## root에 적용

먼저 target project root에서 preflight만 실행한다.

```bash
node scripts/apply.js <feature> --dry-run
```

예정 방식과 `code`를 확인한 뒤 사용자가 명시적으로 적용한다.

```bash
node scripts/apply.js <feature>
```

`/built:apply <feature>`도 같은 helper를 호출한다. `/built:run` 종료 시 자동 apply는 하지 않는다.

적용 방식은 worktree 상태에 따라 하나만 선택된다.

- commit 없는 uncommitted 변경: `git diff --binary` patch를 만들고 root에서 `git apply --check`를 통과한 경우에만 적용
- uncommitted 변경 없는 committed branch: root HEAD에서 fast-forward 가능한 경우에만 `git merge --ff-only`
- 이미 적용된 state: `already_applied` no-op

dirty root, committed/uncommitted mixed 상태, patch conflict, non-fast-forward, stale/missing pointer,
branch mismatch는 root와 `state.json`을 변경하지 않고 machine-readable failure code와 복구 안내를 출력한다.
성공한 뒤에만 `state.execution_worktree.root_apply_*`가 갱신된다.

| code | 의미 | 복구 방향 |
| --- | --- | --- |
| `dirty_root` | root working tree가 clean하지 않음 | root 변경을 commit/stash/보존 |
| `mixed_worktree` | 미적용 commit과 uncommitted 변경이 함께 존재 | 모두 commit하거나 commit 없는 patch 상태로 정리 |
| `apply_conflict` | binary patch가 현재 root에 clean apply되지 않음 | root/worktree diff inspect 후 수동 해결 |
| `non_fast_forward` | root와 worktree branch가 분기됨 | 최신 root 기준으로 branch 정리 |
| `stale_pointer` | state/registry/resultDir pointer 누락·불일치 | control-plane pointer 복구 또는 run 재실행 |

## 정리

적용 전 evidence를 보존해야 하면 `--archive`를 사용한다.

```bash
node scripts/cleanup.js <feature> --archive
```

`cleanup.js`는 정리 전에 root 적용 상태, worktree branch, worktree path, result_dir를 출력한다.
미적용 uncommitted 변경이 있으면 기본 cleanup은 중단되고 `/built:apply`를 안내한다.
patch 적용 후에는 state에 기록한 patch 해시와 현재 worktree 변경이 같을 때만 cleanup을 허용한다.
적용 이후 worktree가 다시 바뀌면 evidence 불일치로 중단한다.

`provider-doctor`는 completed worktree run 중 root 미적용 상태가 남아 있으면 `worktree_handoff`
warning과 `/built:apply --dry-run` 조치를 표시한다.
