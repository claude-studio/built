---
title: Daemon Worktree & Branch Cleanup 운영 정책
scope: ops
created: 2026-04-26
updated: 2026-04-26
related_issues: [BUI-133]
related_adr: [ADR-2]
tags: [ops, worktree, cleanup, daemon, finisher, operator]
---

# Daemon Worktree & Branch Cleanup 운영 정책

## 1. 배경 및 목적

Multica agent 작업은 daemon host의 bare clone cache와 worktree를 사용한다.
built 프로젝트에서 Builder 에이전트가 작업 branch를 checkout하면, Multica daemon이
자체 workspace 경로(예: `~/multica_workspaces/<workspace-id>/<run-id>/workdir/`)에
worktree를 생성한다.

이 경로는 **로컬 프로젝트에서 `git worktree list`를 실행해도 나타나지 않는다.**
따라서 PR merge 이후 stale worktree/branch 여부를 확인하려면 별도 절차가 필요하다.

---

## 2. Daemon Worktree 가시성

### 2-1. 로컬 `git worktree list` 의 한계

로컬 레포(`~/Desktop/jb/built`) 에서 `git worktree list`를 실행하면 해당 레포에서
`git worktree add`로 생성한 worktree만 표시된다.

Multica daemon이 생성한 worktree는 **daemon host의 별도 경로에 있는 clone**을 기반으로
하므로, 로컬 `git worktree list`에 포함되지 않는다.

```
# 로컬 레포에서 실행 — daemon worktree는 여기서 보이지 않음
git -C ~/Desktop/jb/built worktree list
```

### 2-2. Daemon Worktree 감지 방법

1. **원격 branch 목록 확인**: `git ls-remote --heads origin` 으로 원격에 살아있는 branch 확인
2. **merged branch 확인**: `git branch -r --merged origin/main` 으로 이미 merge된 원격 branch 확인
3. **`check-stale-branches.js` 실행**: 원격 branch 기준 stale 후보를 자동 감지 (`scripts/check-stale-branches.js`)

---

## 3. Stale Worktree/Branch 감지 기준

다음 조건을 모두 만족하면 stale 후보로 분류한다:

| # | 조건 | 판단 근거 |
|---|------|-----------|
| 1 | `agent/builder/` 또는 `agent/` prefix를 가진 원격 branch | Builder/Operator가 생성한 작업 branch |
| 2 | `git merge-base --is-ancestor <branch> origin/main` 통과 | main에 이미 merge된 상태 |
| 3 | 해당 branch에 연결된 open PR이 없음 | PR이 닫힌(merged/closed) 상태 |

감지 결과는 **stale 후보 목록(branch명, 최종 커밋 날짜, PR 상태)**으로 출력한다.

---

## 4. Cleanup 안전 규칙

cleanup은 아래 조건 중 하나라도 해당하면 **자동 삭제하지 않고 blocked/알림으로 남긴다**:

| 위험 조건 | 처리 |
|-----------|------|
| open PR이 있음 (merged/closed 아님) | blocked: PR 확인 필요 |
| `state.json` status가 `running` | blocked: 실행 중인 작업 중단 후 재시도 |
| branch에 main에 없는 커밋이 존재 | blocked: unmerged 변경사항 확인 필요 |
| cleanup 대상 worktree 경로에 uncommitted 변경이 있음 | blocked: 변경 보존 필요 |

안전 조건을 모두 통과한 경우에만 아래 순서로 삭제한다:

1. `git push origin --delete <branch>` — 원격 branch 삭제
2. `git branch -d <branch>` — 로컬 branch 삭제 (있으면)
3. `node scripts/cleanup.js <feature>` — worktree 및 runtime 정리

---

## 5. 역할 책임 경계

### Finisher 책임

Finisher는 PR squash merge 직후:

1. **원격 branch 삭제**: GitHub에서 "Delete branch" 버튼 또는 `git push origin --delete <branch>`
2. **cleanup 스크립트 실행 권장**: `node scripts/cleanup.js <feature>` 로 로컬 worktree/runtime 정리
3. **이슈 코멘트에 cleanup evidence 기록**: 삭제한 branch명, 실행 결과 요약

Finisher는 다음은 하지 않는다:

- daemon host의 bare clone 직접 조작
- open PR이 있는 branch 삭제
- running 상태 feature의 worktree 강제 삭제

### Operator 책임

Operator는 주기적 또는 수동 점검 시:

1. **stale branch 감지**: `node scripts/check-stale-branches.js` 실행
2. **감지 결과 코멘트**: stale 후보 목록을 이슈 코멘트로 남김
3. **안전한 경우 cleanup 수행**: 위 안전 규칙 통과 시 `cleanup.js` 실행
4. **위험한 경우 알림**: Coordinator 또는 사용자에게 판단 요청

Operator는 다음은 하지 않는다:

- Finisher가 이미 처리한 branch를 중복 삭제
- 자동으로 `--force` push/delete 수행
- blocked 이슈를 임의로 재개

---

## 6. Cleanup Evidence 형식

이슈 코멘트에 남길 cleanup evidence 형식:

```
[Cleanup Evidence]
- 삭제한 원격 branch: agent/builder/c435ce11
- cleanup.js 결과: worktree removed, runtime run dir removed
- stale branch 없음 / N개 stale 후보 발견 (목록 첨부)
- 실행 시각: 2026-04-26 11:00 KST
```

---

## 7. 주의사항

- **`git worktree list`는 로컬 레포에서만 동작**한다. daemon이 사용하는 clone은 별도 경로에 있으므로 로컬에서는 보이지 않는다.
- **원격 branch 상태가 SSOT**다. 로컬 branch 목록보다 `git ls-remote` 결과를 우선 확인한다.
- cleanup을 자동화할 때는 반드시 PR 상태(open/merged/closed)를 먼저 확인한다. GitHub API 없이는 `gh pr list --head <branch>` CLI로 확인한다.
- `scripts/cleanup.js`는 로컬 worktree(`.claude/worktrees/`)와 `.built/runtime/runs/` 정리를 담당한다. 원격 branch 삭제는 별도 git 명령이 필요하다.
