---
id: WF-25
title: execution worktree-first run 검증 워크플로우
type: workflow
date: 2026-04-27
validated_by: [BUI-196, BUI-379]
tags: [workflow, worktree, run, status, cost, cleanup, offline-test]
---

## 패턴 설명

`/built:run`이 execution worktree를 생성하거나 재사용할 때 root runtime state와 worktree phase 산출물이 같은 canonical pointer를 공유하는지 확인하는 검증 워크플로우.
worktree-first 실행은 경로 분리가 핵심이므로 run 성공만 보지 않고 status/cost/cleanup 소비자가 같은 `resultDir`을 따라가는지 함께 확인한다.

## 언제 사용하나

- `/built:run`의 execution worktree 생성, 재사용, branch naming, result path를 바꿀 때
- Do/Check/Iter/Report 또는 plan synthesis의 CWD/result output path를 수정할 때
- `/built:status`, `/built:cost`, `/built:cleanup`이 registry/state pointer를 소비하는 방식을 바꿀 때
- worktree cleanup safety gate를 완화하거나 확장할 때

## 검증 절차

1. git project fixture에서 `/built:run`을 실행해 `.claude/worktrees/<feature>` 아래 execution worktree가 생기는지 확인한다.
2. `state.execution_worktree`와 runtime registry에 path, branch, resultDir, cleanup command가 기록되는지 확인한다.
3. Do/Check/Iter/Report와 plan synthesis가 worktree CWD와 worktree resultDir을 사용하되, root runtime state는 기존 위치에 남는지 확인한다.
4. worktree `resultDir/progress.json`에 누적 비용을 둔 뒤 재실행 비용 guard가 root fallback이 아니라 canonical pointer를 읽는지 확인한다.
5. `/built:status`와 `/built:cost`가 registry/state의 `resultDir` pointer를 우선하고, pointer가 없을 때만 root `.built/features/<feature>`로 폴백하는지 확인한다.
6. cleanup archive가 registry `resultDir`, state `execution_worktree.result_dir`, root fallback 후보 중 실제 존재하는 canonical result dir를 worktree 제거 전에 보존하는지 확인한다.
7. root fallback과 worktree result dir가 함께 있으면 worktree result dir가 archive 최상위에 남고 root fallback은 `_root-fallback/`에 분리되는지 확인한다.
8. cleanup 대상 explicit worktree path가 허용 루트 안에 있고 expected branch와 일치하는지 확인한다.
9. `--archive` cleanup에서 canonical result dir 내부 untracked 산출물은 built-owned artifact로 허용하되, result dir 밖 dirty 변경은 cleanup을 중단하는지 확인한다.
10. unsafe cleanup은 worktree뿐 아니라 runtime/result 삭제도 중단하는지 확인한다.

## 필수 offline 테스트

- `node test/run.test.js`: execution worktree pointer 기록, worktree canonical 비용 guard, legacy fallback 유지
- `node test/status.test.js`: registry/state `resultDir` pointer 기반 `progress.json` 출력
- `node test/cost.test.js`: 단일 feature와 `--all` 비용 집계의 pointer 우선순위
- `node test/cleanup.test.js`: 허용 루트, branch mismatch, archive source 후보 순회, root fallback 분리, result artifact dirty 예외, result dir 밖 dirty safety gate
- `npm test`: 기존 Claude 기본 run과 e2e fixture 회귀 확인

## 실패 시 복구

- 비용 guard가 root `progress.json`만 읽으면 `prepareExecutionContext()` 이후 canonical resultDir을 설정한 뒤 guard를 실행하도록 순서를 되돌린다.
- status/cost가 worktree 산출물을 보지 못하면 registry entry와 state의 `resultDir` 후보를 root fallback보다 앞에 둔다.
- cleanup archive가 worktree 산출물을 보존하지 못하면 registry `resultDir`, state `execution_worktree.result_dir`, root fallback 후보를 실제 존재 여부 기준으로 순회하도록 되돌린다.
- cleanup이 기본 git 상태의 worktree result artifact 때문에 skipped 되면 canonical result dir 내부 artifact만 built-owned 예외로 허용하고 result dir 밖 dirty 변경은 계속 차단한다.
- cleanup이 unsafe path를 삭제하려 하면 허용 루트, git worktree 여부, expected branch, dirty status 검증을 통과하지 못한 경우 전체 cleanup을 skipped 처리한다.
- legacy/non-worktree 테스트가 깨지면 `BUILT_DISABLE_WORKTREE` 또는 run-request `execution_worktree=false` 경로의 root fallback을 확인한다.

## 관련 문서

- `docs/poc-worktree-reuse.md`
- `docs/ops/worktree-cleanup-policy.md`
- `docs/ops/artifact-retention-policy.md`
- `kg/decisions/worktree-orchestration-pattern.md`
- `kg/decisions/execution-worktree-mvp-boundary.md`
- `kg/decisions/worktree-resultdir-archive-policy.md`
- `kg/workflows/daemon-worktree-cleanup.md`

```json-ld
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "identifier": "WF-25",
  "name": "execution worktree-first run 검증 워크플로우",
  "tool": ["test/run.test.js", "test/status.test.js", "test/cost.test.js", "test/cleanup.test.js", "scripts/cleanup.js"],
  "about": "execution worktree canonical resultDir pointer validation"
}
```
