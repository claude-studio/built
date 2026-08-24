---
id: WF-25
title: execution worktree-first run 검증 워크플로우
type: workflow
date: 2026-08-24
validated_by: [BUI-196, BUI-379, BUI-386, BUI-966]
tags: [workflow, worktree, run, apply, status, cost, cleanup, offline-test]
---

## 패턴 설명

`/built:run`이 execution worktree를 생성하거나 재사용할 때 root runtime state와 worktree phase 산출물이 같은 canonical pointer를 공유하는지 확인하는 검증 워크플로우.
worktree-first 실행은 경로 분리가 핵심이므로 run 성공만 보지 않고 status/cost/cleanup 소비자가 같은 `resultDir`을 따라가는지 함께 확인한다.

## 언제 사용하나

- `/built:run`의 execution worktree 생성, 재사용, branch naming, result path를 바꿀 때
- Do/Check/Iter/Report 또는 plan synthesis의 CWD/result output path를 수정할 때
- `/built:status`, `/built:cost`, `/built:cleanup`이 registry/state pointer를 소비하는 방식을 바꿀 때
- run 완료 후 root 적용/merge handoff 출력이나 root 적용 상태 필드를 바꿀 때
- `/built:apply`의 preflight, patch, fast-forward, dry-run, failure code를 바꿀 때
- worktree cleanup safety gate를 완화하거나 확장할 때

## 검증 절차

1. git project fixture에서 `/built:run`을 실행해 `.claude/worktrees/<feature>` 아래 execution worktree가 생기는지 확인한다.
2. `state.execution_worktree`와 runtime registry에 path, branch, resultDir, cleanup command가 기록되는지 확인한다.
3. Do/Check/Iter/Report와 plan synthesis가 worktree CWD와 worktree resultDir을 사용하되, root runtime state는 기존 위치에 남는지 확인한다.
4. worktree `resultDir/progress.json`에 누적 비용을 둔 뒤 재실행 비용 guard가 root fallback이 아니라 canonical pointer를 읽는지 확인한다.
5. `/built:status`와 `/built:cost`가 registry/state의 `resultDir` pointer를 우선하고, pointer가 없을 때만 root `.built/features/<feature>`로 폴백하는지 확인한다.
6. run 완료 stdout와 `report.md`가 worktree branch, worktree path, result_dir, root 미변경 의도, inspect/patch apply/branch merge/cleanup next step을 노출하는지 확인한다.
7. state `execution_worktree.root_applied`, `root_apply_status`, `root_apply_summary`가 root 적용 상태를 남기는지 확인한다.
8. `/built:status`, `/built:cleanup`, `provider-doctor`가 completed worktree run의 root 적용 상태를 registry/state pointer 기준으로 표시하는지 확인한다.
9. `/built:apply <feature> --dry-run`이 completed 상태, root clean 상태, 허용된 worktree path, expected branch, state/registry/resultDir pointer를 preflight하고 root/state를 바꾸지 않는지 확인한다.
10. commit 없는 uncommitted 변경은 untracked/binary 파일을 포함한 patch와 `git apply --check` 뒤에만 적용되고, committed 변경은 clean worktree와 fast-forward 가능 조건에서 `git merge --ff-only` 한 방식으로만 적용되는지 확인한다.
11. dirty root, patch conflict, non-fast-forward, committed/uncommitted mixed 상태, stale pointer, branch mismatch가 machine-readable code로 실패하며 root와 state에 부분 변경을 남기지 않는지 확인한다.
12. 성공한 patch/fast-forward/no-op 뒤에만 control-plane writer가 `root_applied`, status/summary, method, 적용 시각, commit/patch hash evidence를 기록하는지 확인한다.
13. `/built:apply --dry-run`과 실제 apply가 같은 skill invocation에서 연속 실행되지 않고 상호 배타적으로 종료되는지 확인한다.
14. 이미 적용된 feature 재실행이 멱등 no-op으로 끝나는지 확인한다.
15. patch 적용 뒤 state patch hash와 worktree 변경이 같을 때만 cleanup을 허용하고, 적용 이후 추가 변경이 있으면 cleanup을 중단하는지 확인한다.
16. cleanup archive가 registry `resultDir`, state `execution_worktree.result_dir`, root fallback 후보 중 실제 존재하는 canonical result dir를 worktree 제거 전에 보존하는지 확인한다.
17. root fallback과 worktree result dir가 함께 있으면 worktree result dir가 archive 최상위에 남고 root fallback은 `_root-fallback/`에 분리되는지 확인한다.
18. cleanup 대상 explicit worktree path가 허용 루트 안에 있고 expected branch와 일치하는지 확인한다.
19. `--archive` cleanup에서 canonical result dir 내부 untracked 산출물은 built-owned artifact로 허용하되, result dir 밖 dirty 변경은 cleanup을 중단하는지 확인한다.
20. unsafe cleanup은 worktree뿐 아니라 runtime/result 삭제도 중단하는지 확인한다.

## 필수 offline 테스트

- `node test/run.test.js`: execution worktree pointer 기록, worktree canonical 비용 guard, legacy fallback 유지
- `node test/status.test.js`: registry/state `resultDir` pointer 기반 `progress.json` 출력, root 적용 handoff 상태 표시
- `node test/cost.test.js`: 단일 feature와 `--all` 비용 집계의 pointer 우선순위
- `node test/cleanup.test.js`: 허용 루트, branch mismatch, archive source 후보 순회, root fallback 분리, result artifact dirty 예외, result dir 밖 dirty safety gate, cleanup 전 root 적용 상태 표시
- `node test/provider-doctor.test.js`: completed worktree run의 root 미적용 `worktree_handoff` warning
- `node test/apply.test.js`: binary/untracked patch, fast-forward, dry-run, 거부 경로 무변경, 멱등 no-op, skill dry-run/실제 apply 상호 배타성
- `npm test`: 기존 Claude 기본 run과 e2e fixture 회귀 확인

## 실패 시 복구

- 비용 guard가 root `progress.json`만 읽으면 `prepareExecutionContext()` 이후 canonical resultDir을 설정한 뒤 guard를 실행하도록 순서를 되돌린다.
- status/cost가 worktree 산출물을 보지 못하면 registry entry와 state의 `resultDir` 후보를 root fallback보다 앞에 둔다.
- run 성공 후 root 적용 next step이 보이지 않으면 `src/worktree-handoff.js` formatter와 `scripts/run.js`의 report/stdout 삽입 경로를 확인한다.
- status/cleanup/doctor가 root 적용 상태를 놓치면 `state.execution_worktree.root_applied`, `root_apply_status`, `root_apply_summary` 소비 경로를 확인한다.
- apply가 `dirty_root`, `mixed_worktree`, `apply_conflict`, `non_fast_forward`, `stale_pointer`, `branch_mismatch`로 실패하면 failure code가 가리키는 root/worktree/pointer 조건을 먼저 복구하고 강제 적용으로 우회하지 않는다.
- dry-run이 실제 apply로 이어지면 `skills/apply/SKILL.md`에서 `$ARGUMENTS`의 `--dry-run` 분기를 확인하고 한 invocation에서 두 bash block이 연속 실행되지 않게 되돌린다.
- patch 적용 뒤 cleanup이 중단되면 state의 patch hash와 현재 worktree diff hash를 비교한다. 불일치는 적용 이후 추가 변경 evidence이므로 worktree를 삭제하지 않는다.
- `state_update_failed`가 발생하면 Git 적용이 이미 끝났을 수 있다. apply를 즉시 재실행하지 말고 root HEAD/status와 worktree 변경을 확인한 뒤 state evidence를 복구한다.
- cleanup archive가 worktree 산출물을 보존하지 못하면 registry `resultDir`, state `execution_worktree.result_dir`, root fallback 후보를 실제 존재 여부 기준으로 순회하도록 되돌린다.
- cleanup이 기본 git 상태의 worktree result artifact 때문에 skipped 되면 canonical result dir 내부 artifact만 built-owned 예외로 허용하고 result dir 밖 dirty 변경은 계속 차단한다.
- cleanup이 unsafe path를 삭제하려 하면 허용 루트, git worktree 여부, expected branch, dirty status 검증을 통과하지 못한 경우 전체 cleanup을 skipped 처리한다.
- legacy/non-worktree 테스트가 깨지면 `BUILT_DISABLE_WORKTREE` 또는 run-request `execution_worktree=false` 경로의 root fallback을 확인한다.

## 관련 문서

- `docs/poc-worktree-reuse.md`
- `docs/ops/worktree-cleanup-policy.md`
- `docs/ops/artifact-retention-policy.md`
- `docs/ops/run-worktree-handoff.md`
- `kg/decisions/worktree-orchestration-pattern.md`
- `kg/decisions/execution-worktree-mvp-boundary.md`
- `kg/decisions/worktree-resultdir-archive-policy.md`
- `kg/decisions/worktree-run-root-apply-handoff-policy.md`
- `kg/decisions/worktree-explicit-root-apply-policy.md`
- `kg/workflows/daemon-worktree-cleanup.md`

```json-ld
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "identifier": "WF-25",
  "name": "execution worktree-first run 검증 워크플로우",
  "tool": ["test/run.test.js", "test/apply.test.js", "test/status.test.js", "test/cost.test.js", "test/cleanup.test.js", "scripts/apply.js", "scripts/cleanup.js"],
  "about": "execution worktree canonical pointer, explicit root apply, and cleanup safety validation"
}
```
