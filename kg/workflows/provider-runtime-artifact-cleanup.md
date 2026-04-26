---
id: WF-12
title: Provider Runtime Artifact Cleanup 점검
type: workflow
date: 2026-04-26
validated_by: [BUI-180]
tags: [ops, provider, cleanup, retention, comparison, smoke, operator, finisher]
---

# Provider Runtime Artifact Cleanup 점검

## 패턴 설명

provider comparison worktree/branch와 smoke 임시 디렉토리가 누적될 때 evidence를 보존하면서 삭제 가능한 실행 잔여물만 정리하는 운영 워크플로우.

핵심 원칙은 comparison evidence directory를 보존하고, dry-run으로 후보와 blocked 사유를 먼저 확인하는 것이다.

## 언제 사용하나

- Operator가 주기적으로 `.built/runtime` 및 smoke 임시 디렉토리 잔여물을 점검할 때
- Finisher가 PR merge 후 cleanup evidence를 남긴 뒤 comparison worktree/branch 잔여 여부를 확인할 때
- provider comparison 실행 후 candidate worktree나 compare branch가 남아 있는지 확인할 때
- smoke 디버그 목적으로 남긴 `/tmp/built-codex-*-smoke-*/` 디렉토리가 24시간을 넘겼는지 점검할 때

## 단계

1. 현재 이슈나 PR의 canonical branch와 open PR 상태를 확인한다.
2. comparison cleanup 후보를 dry-run으로 확인한다.
   `node scripts/cleanup-artifacts.js --dry-run`
3. 특정 feature만 확인할 때는 범위를 좁힌다.
   `node scripts/cleanup-artifacts.js --feature <feature> --dry-run`
4. smoke 임시 디렉토리까지 확인할 때는 `--smoke`를 추가한다.
   `node scripts/cleanup-artifacts.js --smoke --dry-run`
5. dry-run 결과에서 `blocked` 후보를 먼저 기록한다.
   open PR, unmerged branch, uncommitted 변경, PR 상태 unknown이 있으면 삭제하지 않는다.
6. 삭제해도 되는 후보만 실제 삭제 모드로 실행한다.
   comparison evidence directory는 삭제 대상이 아니다.
7. 이슈 코멘트에 cleanup evidence를 남긴다.
   삭제한 worktree/branch, 삭제한 smoke dir, 보존한 evidence path, blocked 후보, 실행 시각(KST)을 포함한다.

## Operator 절차

1. `node scripts/check-stale-branches.js`로 stale agent branch 후보를 별도 확인한다.
2. `node scripts/cleanup-artifacts.js --dry-run`으로 comparison worktree/branch 후보를 확인한다.
3. smoke 잔여물 점검이 필요하면 `node scripts/cleanup-artifacts.js --smoke --dry-run`을 추가 실행한다.
4. blocked 후보는 Coordinator 또는 사용자 판단으로 넘기고, 자동 삭제하지 않는다.
5. 삭제 후에는 dry-run 결과와 실제 삭제 결과를 함께 요약한다.

## Finisher 절차

1. PR merge 후 canonical branch가 더 이상 open PR에 묶여 있지 않은지 확인한다.
2. feature run cleanup은 기존 `node scripts/cleanup.js <feature>` 기준을 따른다.
3. comparison evidence directory는 삭제하지 않는다.
4. comparison worktree/branch cleanup이 필요한 경우 dry-run 결과를 먼저 남긴다.
5. cleanup을 수행했다면 merge 결과 코멘트에 보존 evidence와 삭제 대상을 분리해 기록한다.

## 주의사항

- `report.md`, `diff.patch`, `providers/<candidate-id>/`, `manifest.json`, `verification.json`, 로그는 삭제하지 않는다.
- open PR이 있는 branch는 삭제하지 않는다.
- branch가 `origin/main`에 merge되지 않았거나 PR closed/merged 상태가 확인되지 않으면 삭제하지 않는다.
- worktree에 uncommitted 변경이 있으면 삭제하지 않는다.
- smoke 임시 디렉토리는 24시간 이내에는 보존한다.
- `gh` CLI가 없거나 PR 상태가 `unknown`이면 warning/blocked 근거를 기록하고 수동 확인을 요청한다.

## 실패 시 복구

- remote branch 삭제가 실패하면 local cleanup 성공 여부와 분리해서 기록하고, 남은 branch를 blocked 또는 follow-up 후보로 남긴다.
- cleanup 중 일부만 성공하면 삭제된 대상과 보존된 evidence path를 함께 남겨 재시도 범위를 좁힌다.
- comparison evidence가 손상된 것으로 의심되면 PR merge나 provider decision을 진행하지 말고 `docs/ops/artifact-retention-policy.md` 기준으로 Coordinator 판단을 요청한다.

## 참고

- 정책 전문: `docs/ops/artifact-retention-policy.md`
- cleanup script: `scripts/cleanup-artifacts.js`
- stale branch 점검: `scripts/check-stale-branches.js`
- 관련 결정: `kg/decisions/provider-runtime-artifact-retention-policy.md`

```json-ld
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "identifier": "WF-12",
  "name": "Provider Runtime Artifact Cleanup 점검",
  "tool": ["scripts/cleanup-artifacts.js", "scripts/check-stale-branches.js"],
  "about": "provider comparison and smoke artifact cleanup workflow"
}
```
