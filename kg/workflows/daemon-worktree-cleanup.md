---
id: WF-10
title: Daemon Worktree 및 Branch Cleanup 점검
type: workflow
date: 2026-04-26
validated_by: [BUI-133]
tags: [ops, worktree, cleanup, stale-branch, finisher, operator]
---

## 패턴 설명

PR merge 이후 Multica daemon worktree와 작업 branch가 stale 상태로 남지 않도록 확인하는 운영 워크플로우.
로컬 `git worktree list`는 daemon이 만든 worktree를 보여주지 않으므로, 원격 `agent/` branch 상태를 기준으로 stale 후보를 감지한다.

## 언제 사용하나

- Finisher가 PR을 merge한 직후 branch/worktree cleanup evidence를 남길 때
- Operator가 주기적 운영 점검에서 orphan branch나 stale worktree 후보를 찾을 때
- cleanup 대상에 open PR, running 작업, unmerged commit 같은 위험 조건이 있는지 확인해야 할 때

## Finisher 절차

1. PR이 merge되었고 canonical PR head branch가 더 이상 open PR에 필요하지 않은지 확인한다.
2. 원격 branch를 삭제한다: `git push origin --delete <branch>`.
3. 가능한 경우 `node scripts/cleanup.js <feature>`를 실행해 로컬 worktree와 `.built/runtime/runs/`를 정리한다.
4. 이슈 코멘트에 cleanup evidence를 남긴다: 삭제한 branch, cleanup 결과, 실행 시각(KST), 남은 blocker.
5. cleanup이 안전하지 않으면 삭제하지 않고 blocked 사유를 남긴다.

## Operator 절차

1. `node scripts/check-stale-branches.js`를 실행한다.
2. 자동화나 보고서가 구조화 결과를 필요로 하면 `node scripts/check-stale-branches.js --json`을 사용한다.
3. stale 후보, blocked 후보, 경고를 이슈 코멘트에 요약한다.
4. stale 후보가 안전 조건을 모두 만족할 때만 원격 branch 삭제와 `cleanup.js` 실행을 진행한다.
5. open PR, unmerged commit, PR 상태 unknown, running 상태가 있으면 삭제하지 않고 Coordinator 또는 사용자 판단을 요청한다.

## 검증 기준

- stale 후보는 `agent/` prefix 원격 branch, `origin/main`에 merge 완료, open PR 없음 조건을 모두 만족해야 한다.
- `gh` CLI가 없거나 PR 상태를 확인할 수 없으면 PR 상태를 `unknown`으로 보고 수동 확인을 요구한다.
- `scripts/check-stale-branches.js`는 감지만 수행하고 자동 삭제하지 않는다.
- cleanup evidence에는 branch명, cleanup 결과, stale/blocked 개수, KST 실행 시각이 있어야 한다.

## 실패 시 복구

- open PR이 있으면 PR 상태와 canonical branch를 먼저 확인하고 cleanup을 중단한다.
- branch에 `origin/main`에 없는 커밋이 있으면 Builder 또는 Coordinator에게 보존 여부를 확인한다.
- `cleanup.js`가 실패하면 원격 branch 삭제 여부와 로컬 runtime/worktree 상태를 분리해서 기록한다.
- daemon-side worktree가 의심되면 로컬 `git worktree list` 결과만으로 완료 판단하지 않고 원격 branch 상태와 실행 이슈 상태를 함께 확인한다.

## 참고

- 정책 전문: `docs/ops/worktree-cleanup-policy.md`
- 감지 스크립트: `scripts/check-stale-branches.js`
- 로컬 cleanup: `scripts/cleanup.js`

```json-ld
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "identifier": "WF-10",
  "name": "Daemon Worktree 및 Branch Cleanup 점검",
  "tool": ["scripts/check-stale-branches.js", "scripts/cleanup.js"],
  "about": "stale branch and daemon worktree cleanup workflow"
}
```
