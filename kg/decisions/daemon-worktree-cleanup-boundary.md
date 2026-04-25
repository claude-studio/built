---
id: ADR-12
title: daemon worktree와 branch cleanup 책임 경계
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-133
tags: [ops, worktree, branch, cleanup, finisher, operator]
---

## 컨텍스트

Multica agent 실행은 daemon host의 bare clone cache와 실행별 worktree를 사용한다.
provider 전환 이후 agent 작업 branch와 worktree가 늘어나면서, PR merge 후 branch/worktree 정리와 stale 작업 감지가 운영 책임으로 올라왔다.

중요한 제약은 daemon이 만든 worktree가 사용자의 로컬 프로젝트에서 실행한 `git worktree list`에 나타나지 않는다는 점이다.
따라서 cleanup 판단의 SSOT를 로컬 worktree 목록에 두면 orphan branch나 daemon-side stale worktree를 놓칠 수 있다.

## 결정

PR merge 직후의 정리는 Finisher 책임으로 둔다.
Finisher는 merge 완료 후 원격 작업 branch를 삭제하고, 가능한 경우 `node scripts/cleanup.js <feature>`로 로컬 worktree와 runtime 디렉토리를 정리한 뒤 cleanup evidence를 이슈 코멘트에 남긴다.

주기적 또는 수동 stale 점검은 Operator 책임으로 둔다.
Operator는 `node scripts/check-stale-branches.js`를 실행해 원격 `agent/` branch 기준으로 stale 후보와 blocked 후보를 분리하고, 결과를 운영 코멘트로 남긴다.

cleanup 판단의 기준은 로컬 `git worktree list`가 아니라 원격 branch 상태다.
merged into `origin/main`이고 open PR이 없는 `agent/` branch만 stale 후보로 본다.

위험 조건이 있으면 자동 삭제하지 않는다.
open PR, `running` 상태 feature, `origin/main`에 없는 커밋, cleanup 대상의 uncommitted 변경이 있으면 blocked/알림으로 남기고 수동 판단을 요청한다.

## 근거

- merge 직후 정리는 PR 문맥과 branch 정보를 가진 Finisher가 가장 정확하게 수행할 수 있다.
- daemon-side worktree는 로컬 worktree 목록으로 보이지 않으므로 원격 branch 기준 확인이 더 보수적이고 재현 가능하다.
- Operator는 운영 점검 역할이므로 누락된 branch cleanup을 주기적으로 발견하되, PR 완료 판정과 merge 자체는 수행하지 않는다.
- 자동 삭제를 stale 후보에만 제한하면 open PR이나 unmerged 작업을 실수로 삭제하는 위험을 줄일 수 있다.
- cleanup evidence를 이슈 코멘트에 남기면 Finisher와 Operator 사이의 중복 삭제 여부를 추적할 수 있다.

## 대안

- Finisher가 daemon host의 bare clone이나 worktree를 직접 조작한다: daemon 내부 경로와 소유권을 PR 종료 역할에 노출하므로 선택하지 않았다.
- 로컬 `git worktree list`만 기준으로 stale 여부를 판단한다: Multica daemon worktree가 보이지 않아 false negative가 발생하므로 선택하지 않았다.
- stale 후보를 자동으로 강제 삭제한다: open PR, running 작업, unmerged commit 보존 요구와 충돌하므로 선택하지 않았다.
- Operator가 merge 직후 모든 cleanup을 담당한다: PR 종료 시점의 책임과 evidence가 분리되어 누락 추적이 어려워 선택하지 않았다.

## 되돌릴 조건

Multica가 daemon worktree lifecycle API나 cleanup evidence API를 제공하면 원격 branch 기반 점검을 해당 API 기반 점검으로 교체할 수 있다.
그 경우에도 open PR과 unmerged commit 보호, cleanup evidence 기록, Finisher/Operator 책임 분리는 유지해야 한다.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Decision",
  "identifier": "ADR-12",
  "name": "daemon worktree와 branch cleanup 책임 경계",
  "about": "Multica daemon worktree cleanup and stale branch detection",
  "isBasedOn": {"@type": "CreativeWork", "name": "BUI-133"}
}
```
