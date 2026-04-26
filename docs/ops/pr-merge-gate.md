---
title: Finisher PR Pre-Merge Gate 절차
scope: ops
created: 2026-04-26
updated: 2026-04-26
related_issues: [BUI-228]
tags: [ops, finisher, merge, gate, github, checks]
---

# Finisher PR Pre-Merge Gate 절차

## 1. 목적

Finisher가 PR을 merge하기 전에 GitHub checks, review 상태, branch freshness를 일관되게 확인하는 절차를 정의한다.
모든 Finisher 실행은 이 문서의 gate를 순서대로 통과한 뒤에만 merge를 수행한다.

---

## 2. Gate 순서

```
[G1] canonical PR 확인
      ↓
[G2] 중복/stale PR 감지
      ↓
[G3] mergeability 확인
      ↓
[G4] CI/check 상태 확인
      ↓
[G5] review 승인 확인
      ↓
[G6] branch freshness 확인
      ↓
[MERGE OK]
```

---

## 3. Gate 상세 절차

### G1: Canonical PR 확인

이슈 코멘트에서 현재 canonical PR URL과 head branch를 확인한다.

```bash
# 이슈 코멘트의 canonical PR URL을 먼저 확인
gh pr view <PR_NUMBER> --json number,title,state,headRefName,headRefOid,baseRefName,baseRefOid
```

판단:

| 상태 | 처리 |
|------|------|
| PR이 open 상태 | G2로 진행 |
| PR이 merged | 이미 완료 — cleanup evidence 남기고 종료 |
| PR이 closed (unmerged) | Coordinator에게 에스컬레이션 |
| PR URL이 없음 | Coordinator에게 에스컬레이션 |

---

### G2: 중복/Stale PR 감지

같은 이슈 번호(예: BUI-228)에 연결된 PR이 여러 개 있는지 확인한다.

```bash
gh pr list --state open --search "BUI-<N>" --json number,title,headRefName,createdAt
```

판단:

| 상태 | 처리 |
|------|------|
| canonical PR 하나만 open | G3으로 진행 |
| 같은 이슈 번호의 open PR이 여러 개 | 최신 handoff comment 기준 canonical을 하나로 특정, 나머지는 이슈에 기록 후 Coordinator 판단 요청 |
| head branch가 이미 main에 merge됨 | stale PR — 닫고 cleanup evidence 기록 |

stale branch 감지:

```bash
# head branch가 main에 포함됐는지 확인
git fetch origin
git merge-base --is-ancestor origin/<head-branch> origin/main && echo MERGED || echo NOT_MERGED
```

---

### G3: Mergeability 확인

```bash
gh pr view <PR_NUMBER> --json mergeable,mergeStateStatus,headRefName,headRefOid,baseRefOid
```

| `mergeable` / `mergeStateStatus` | 판단 | 처리 |
|-----------------------------------|------|------|
| `MERGEABLE` / `CLEAN` | merge 가능 | G4로 진행 |
| `CONFLICTING` / `DIRTY` | conflict 발생 | **Builder로 되돌림** |
| `MERGEABLE` / `BEHIND` | base branch 뒤처짐 | **Builder로 되돌림** (base 업데이트 요청) |
| `UNKNOWN` | GitHub 아직 계산 중 | 30초 대기 후 재조회, 2회 후에도 UNKNOWN이면 Coordinator 보고 |
| 기타 | 알 수 없는 상태 | Coordinator에게 에스컬레이션 |

Builder로 되돌릴 때는 이슈 코멘트에 다음을 명시한다:
- 현재 canonical PR URL
- head branch명
- head commit SHA
- 충돌 또는 stale 원인

---

### G4: CI/Check 상태 확인

```bash
gh pr checks <PR_NUMBER> --json name,state,conclusion,startedAt,completedAt
# 또는
gh pr view <PR_NUMBER> --json statusCheckRollup
```

`scripts/check-pr-merge-ready.js --pr <PR_NUMBER>` 로 자동 실행 가능.

| check 결과 | 판단 | 처리 |
|------------|------|------|
| 모든 required check `SUCCESS` / `NEUTRAL` | G5로 진행 |
| required check `FAILURE` / `ACTION_REQUIRED` | CI 실패 | **Builder로 되돌림** |
| required check `PENDING` / `IN_PROGRESS` | CI 진행 중 | 완료 대기 (최대 10분), 이후에도 pending이면 Coordinator 보고 |
| required check `SKIPPED` (명시적 skip) | 허용 | G5로 진행 |
| required check 없음 (보호 규칙 없는 브랜치) | 확인 후 진행 가능 |

required vs optional check 구분:
- GitHub branch protection rules에서 required로 설정된 check만 blocking으로 처리한다.
- optional check 실패는 이슈 코멘트에 기록하되 merge를 막지 않는다.

---

### G5: Review 승인 확인

```bash
gh pr view <PR_NUMBER> --json reviewDecision,reviews
```

| `reviewDecision` | 판단 | 처리 |
|------------------|------|------|
| `APPROVED` | 승인됨 | G6으로 진행 |
| `CHANGES_REQUESTED` | 수정 요청 | **Builder로 되돌림** (Reviewer 지시 내용과 함께) |
| `REVIEW_REQUIRED` | 미승인 | merge 하지 않음. Coordinator에게 에스컬레이션 |
| 없음 (review 규칙 없는 레포) | 확인 후 진행 가능 |

주의:
- conflict 해결 후 base가 바뀐 경우 이전 `APPROVED`를 재사용하지 않는다.
  base 변경이 있었으면 Reviewer 재검토가 필요하다.

---

### G6: Branch Freshness 확인

```bash
gh pr view <PR_NUMBER> --json mergeStateStatus
# BEHIND 이면 stale
```

또는:

```bash
git fetch origin
git log origin/main..origin/<head-branch> --oneline  # head가 main보다 앞에 있어야 함
git log origin/<head-branch>..origin/main --oneline  # main이 head보다 앞이면 stale
```

| 상태 | 처리 |
|------|------|
| head branch가 main을 포함하거나 최신 main 기반 | G3 CLEAN과 일치 — merge 진행 |
| head branch가 main보다 뒤처짐 (BEHIND) | **Builder로 되돌림** (rebase/merge 요청) |

---

## 4. 처리 결과 분류

| 결과 | 의미 | 액션 |
|------|------|------|
| `MERGE_OK` | 모든 gate 통과 | squash merge 실행 |
| `NEEDS_BUILDER` | Builder가 해결 가능한 문제 | status=in_progress, assignee=Builder, 한글 코멘트 |
| `NEEDS_REVIEWER` | Reviewer 재검토 필요 (base 변경 후) | status=in_review, assignee=Reviewer, 한글 코멘트 |
| `BLOCKED` | 권한/인증/외부 승인 등 플로우 내 해결 불가 | status=blocked, 한글 코멘트, Coordinator 보고 |
| `COORDINATOR` | 중복 PR, canonical 불명확, UNKNOWN 등 판단 필요 | assignee=Coordinator, 한글 코멘트 |

---

## 5. Builder 되돌림 코멘트 형식

```
[Pre-Merge Gate: NEEDS_BUILDER]
원인: <한 줄 원인 요약>

현재 canonical PR: <PR URL>
head branch: <branch명>
head commit: <SHA>

상세:
- G<N> <gate명>: <실패 내용>

조치 요청:
- <Builder가 해야 할 작업>

조치 완료 후 status=in_review, assignee=Reviewer로 변경 필요.
(base 변경이 있었으면 Reviewer 재검토 후 Finisher에게 다시 넘겨야 함)

확인 시각: <KST 시각>
```

---

## 6. Merge Evidence 코멘트 템플릿

merge 성공 후 이슈 코멘트에 남길 형식:

```
[Merge Evidence]
PR: <PR URL>
merge commit: <SHA>
head branch: <branch명>
squash merge 완료 시각: <KST 시각>

Pre-Merge Gate 결과:
- G1 canonical PR: PASS
- G2 중복/stale PR: PASS (중복 없음)
- G3 mergeability: PASS (MERGEABLE/CLEAN)
- G4 CI/checks: PASS (required checks: N개 모두 SUCCESS)
- G5 review: PASS (APPROVED by <reviewer>)
- G6 branch freshness: PASS (CLEAN)

Cleanup:
- 원격 branch 삭제: <branch명>
- cleanup.js 결과: <결과 요약>
- stale branch: 없음 / N개 발견 (목록 첨부)
```

---

## 7. 자동화 스크립트

`scripts/check-pr-merge-ready.js`를 사용해 G3~G5 상태를 한 번에 조회할 수 있다.

```bash
node scripts/check-pr-merge-ready.js --pr <PR_NUMBER>
```

출력:

```
MERGE_OK | NEEDS_BUILDER | NEEDS_REVIEWER | BLOCKED | COORDINATOR
---
G3 mergeable: MERGEABLE / CLEAN
G4 checks: 3/3 SUCCESS (0 FAILURE, 0 PENDING)
G5 review: APPROVED
G6 freshness: CLEAN
```

---

## 8. 비범위

- GitHub branch protection rules 자체를 변경하지 않는다.
- Reviewer 역할을 Finisher가 대체하지 않는다.
- CI 실패를 Finisher가 직접 수정하지 않는다.
