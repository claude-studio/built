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

worktree에 uncommitted 변경이 있으면 patch로 적용할 수 있다.

```bash
git -C <worktree-path> diff --binary > .built/runtime/runs/<feature>/worktree.diff
git apply .built/runtime/runs/<feature>/worktree.diff
```

worktree branch에 commit을 만든 경우에는 root에서 merge할 수 있다.

```bash
git -C <worktree-path> add <files>
git -C <worktree-path> commit -m "feat: apply <feature>"
git merge <worktree-branch>
```

## 정리

적용 전 evidence를 보존해야 하면 `--archive`를 사용한다.

```bash
node scripts/cleanup.js <feature> --archive
```

`cleanup.js`는 정리 전에 root 적용 상태, worktree branch, worktree path, result_dir를 출력한다.
미적용 uncommitted 변경이 있으면 기본 cleanup은 중단되고, 먼저 inspect/apply/archive 절차를 수행해야 한다.

`provider-doctor`는 completed worktree run 중 root 미적용 상태가 남아 있으면 `worktree_handoff`
warning으로 표시한다.
