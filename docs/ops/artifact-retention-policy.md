---
title: Provider Runtime Artifact 보존 정책
scope: ops
created: 2026-04-26
updated: 2026-04-27
related_issues: [BUI-180]
related_docs:
  - docs/contracts/file-contracts.md
  - docs/ops/worktree-cleanup-policy.md
  - docs/ops/provider-comparison-mode.md
  - docs/smoke-testing.md
tags: [ops, cleanup, artifact, comparison, smoke, retention]
---

# Provider Runtime Artifact 보존 정책

## 1. 개요

`.built/runtime` 하위에는 run, comparison, smoke 실행 결과물(artifact)이 누적된다.
이 문서는 각 artifact의 보존 기준, cleanup 대상, 안전 조건, 실행 도구를 정의한다.

cleanup 도구:

| 도구 | 대상 | 문서 |
|------|------|------|
| `node scripts/cleanup.js` | feature run dir, worktree, features 디렉토리 | 이 문서 §2 |
| `node scripts/cleanup-artifacts.js` | comparison worktree/branch, smoke 임시 디렉토리 | 이 문서 §3~§4 |
| `node scripts/check-stale-branches.js` | stale agent branch 감지 | `docs/ops/worktree-cleanup-policy.md` §3 |

---

## 2. Run Artifact 보존 정책

경로:

- `.built/runtime/runs/<feature>/`
- `.built/features/<feature>/` (legacy/root fallback result dir)
- `state.execution_worktree.result_dir` (worktree-first run의 canonical result dir)

### 보존 대상

| 파일 | 보존 기준 |
|------|-----------|
| `state.json` | feature cleanup 전까지 유지 (lifecycle SSOT) |
| `run-request.json` | feature cleanup 전까지 유지 (handoff snapshot) |
| `comparisons/` | 아래 §3 비교 모드 정책 참고 |
| `state.execution_worktree.result_dir`의 `report.md`, `do-result.md`, `check-result.md`, `logs/`, `progress*` | `--archive` cleanup 시 `.built/archive/<feature>/`에 보존 |

worktree-first run에서는 `state.execution_worktree.result_dir`와 registry `resultDir`이 canonical 산출물 위치다.
`node scripts/cleanup.js <feature> --archive`는 worktree를 삭제하기 전에 이 result dir를 `.built/archive/<feature>/`로 복사한다.
root fallback `.built/features/<feature>/`와 worktree result dir가 모두 존재하면 worktree result dir가 archive 최상위의 우선 산출물이며, root fallback은 `.built/archive/<feature>/_root-fallback/` 아래에 별도로 보존한다.

`--archive` 없이 cleanup하면 feature result dir와 worktree는 삭제 대상이다. 감사나 handoff evidence가 필요한 경우에는 삭제 전 반드시 `--archive`를 사용한다.

### Cleanup 조건

다음 중 하나라도 해당하면 cleanup 대상이다.

- feature status가 `done`, `completed`, `aborted`, `failed`
- feature에 연결된 open PR이 없음

### Cleanup 도구

```bash
# 단일 feature
node scripts/cleanup.js <feature>

# 완료 상태 전체
node scripts/cleanup.js --all

# 아카이빙 (삭제 대신 .built/archive/로 이동)
node scripts/cleanup.js <feature> --archive
```

### 안전 규칙

- `state.json` status가 `running`이면 자동 거부
- open PR이 있는 branch와 연관된 feature는 수동 확인 후 처리

---

## 3. Comparison Artifact 보존 정책

comparison 모드 실행(`node scripts/compare-providers.js`)이 생성하는 artifact:

### 경로 구조

```
.built/runtime/runs/<feature>/comparisons/<comparison-id>/
  manifest.json          # comparison 메타 (base_ref, candidate branch, worktree path)
  input-snapshot.json    # 입력 고정 snapshot
  acceptance-criteria.md
  verification-plan.json
  report.md              # 비교 결과 — evidence로 영구 보존
  providers/
    <candidate-id>/
      state.json
      progress.json
      logs/<phase>.jsonl
      result/<phase>-result.md
      verification.json
      diff.patch          # evidence로 영구 보존
      git-status.txt

.claude/worktrees/<feature>-compare-<comparison-id>-<candidate-id>/
  # candidate별 실행 worktree

compare/<feature>/<comparison-id>/<candidate-id>   (git branch)
  # candidate별 실행 branch
```

### 보존 기준

| Artifact | 보존 정책 |
|----------|-----------|
| `report.md` | **영구 보존** — audit evidence. cleanup으로 삭제하지 않는다. |
| `diff.patch` | **영구 보존** — 변경 사항 증거. cleanup으로 삭제하지 않는다. |
| `manifest.json`, `verification.json` | 영구 보존 — report 맥락 유지에 필요 |
| `providers/<candidate-id>/logs/` | 영구 보존 — 실패 원인 추적용 |
| comparison worktree | PR 미승격 시 cleanup 가능 (안전 조건 확인 후) |
| compare/* branch | PR 미승격 + merged 상태 시 cleanup 가능 |

### Cleanup 조건 (worktree/branch)

candidate worktree와 branch는 다음 조건을 **모두** 충족할 때만 cleanup 대상이다.

| # | 조건 |
|---|------|
| 1 | candidate branch의 변경이 main에 완전히 merge되었거나, PR이 closed/merged 상태 |
| 2 | 해당 branch에 open PR이 없음 |
| 3 | worktree에 uncommitted 변경이 없음 |

하나라도 충족하지 못하면 blocked 후보로 분류하고 삭제하지 않는다.

### Cleanup 도구

```bash
# dry-run: 삭제 대상 후보 확인 (실제 삭제 없음)
node scripts/cleanup-artifacts.js --dry-run

# 특정 feature만
node scripts/cleanup-artifacts.js --feature <feature> --dry-run

# 실제 삭제 (worktree/branch만; evidence dir는 유지)
node scripts/cleanup-artifacts.js --feature <feature>

# smoke 임시 디렉토리도 포함
node scripts/cleanup-artifacts.js --dry-run --smoke
```

### 금지 사항

- comparison evidence dir(`.built/runtime/runs/<feature>/comparisons/<comparison-id>/`)을 통째로 삭제하지 않는다.
- open PR이 있는 candidate branch를 삭제하지 않는다.
- 실행 중인 comparison candidate의 worktree를 강제 삭제하지 않는다.

---

## 4. Smoke Artifact 보존 정책

smoke 스크립트(`scripts/smoke-codex-*.js`)는 `/tmp/built-codex-*-smoke-*/` 임시 디렉토리를 생성한다.

### 기본 동작

- smoke 완료 후 임시 디렉토리는 **자동 삭제**된다.
- `BUILT_KEEP_SMOKE_DIR=1` 환경 변수를 설정한 경우에만 디렉토리가 남는다.

### 잔여 디렉토리 처리

`BUILT_KEEP_SMOKE_DIR=1`로 실행한 smoke 결과물은 디버그 목적으로만 유지한다.

보존 기준:

| 상태 | 처리 |
|------|------|
| smoke 실행 후 24시간 이내 | 보존 (디버그 기간) |
| 24시간 초과 | cleanup 대상 |

```bash
# smoke 임시 디렉토리 확인 + 삭제 (dry-run)
node scripts/cleanup-artifacts.js --smoke --dry-run

# 실제 삭제
node scripts/cleanup-artifacts.js --smoke
```

---

## 5. Operator/Finisher 역할 분담

### Finisher 책임

PR squash merge 직후:
1. `node scripts/cleanup.js <feature>` 실행 (run dir/worktree 정리)
2. 이슈 코멘트에 cleanup evidence 기록

Finisher는 comparison evidence dir를 삭제하지 않는다.

### Operator 책임

주기적 점검 시:
1. `node scripts/check-stale-branches.js` 실행 (stale agent branch 감지)
2. `node scripts/cleanup-artifacts.js --dry-run` 실행 (comparison/smoke artifact 감지)
3. 안전 조건 통과한 항목만 실제 cleanup 수행
4. blocked 항목은 Coordinator 또는 사용자에게 판단 요청

---

## 6. Cleanup Evidence 형식

이슈 코멘트에 남길 cleanup evidence:

```
[Cleanup Evidence — comparison artifacts]
- feature: user-auth
- comparison id: 20260426-153000-do-claude-codex
- 삭제한 worktree: .claude/worktrees/user-auth-compare-20260426-153000-do-claude-codex-claude
- 삭제한 branch: compare/user-auth/20260426-153000-do-claude-codex/claude
- 보존한 evidence: .built/runtime/runs/user-auth/comparisons/20260426-153000-do-claude-codex/
- blocked 후보: compare/.../codex (open PR 있음)
- 실행 시각: 2026-04-26 15:30 KST
```
