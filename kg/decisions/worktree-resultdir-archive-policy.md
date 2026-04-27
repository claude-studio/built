---
id: ADR-39
title: worktree resultDir archive 보존 정책
type: decision
date: 2026-04-27
status: accepted
context_issue: BUI-379
tags: [cleanup, worktree, archive, artifact, retention, safety]
---

# Worktree ResultDir Archive 보존 정책

## 컨텍스트

worktree-first run은 Do/Check/Report 산출물을 execution worktree 내부의 `.built/features/<feature>`에 쓸 수 있다.
cleanup은 worktree를 제거하기 전에 이 산출물을 archive해야 하지만, root `.built/features/<feature>`만 보거나 dirty safety gate가 untracked result artifact를 사용자 변경으로 취급하면 `report.md`, `do-result.md`, `check-result.md`, `logs/` evidence가 보존되지 않는다.

## 결정

`node scripts/cleanup.js <feature> --archive`는 worktree 제거 전에 canonical result dir를 archive한다.

- archive source 후보는 registry `resultDir`, state `execution_worktree.result_dir`, root fallback `.built/features/<feature>` 순서로 평가한다.
- 후보 path가 stale이면 다음 후보를 확인하고, 실제 존재하는 worktree result dir를 우선 보존한다.
- worktree result dir와 root fallback이 모두 존재하면 worktree result dir를 `.built/archive/<feature>/` 최상위에 둔다.
- root fallback은 `.built/archive/<feature>/_root-fallback/` 아래에 보존한다.
- canonical result dir 내부 artifact가 git status에서 untracked로 보이는 경우에도 `--archive` cleanup은 이를 built-owned artifact로 보고 archive를 진행한다.
- result dir 밖 uncommitted 변경은 사용자 변경 보호 대상으로 보고 cleanup을 중단한다.
- `--archive` 없이 cleanup하면 result dir와 worktree는 기존처럼 삭제 대상이다.

상세 사용자-facing 정책은 `docs/ops/artifact-retention-policy.md`를 기준으로 한다.

## 근거

- registry pointer와 state pointer는 실행 중 또는 migration 과정에서 불일치할 수 있으므로 cleanup은 실제 존재하는 candidate를 찾아야 한다.
- worktree result dir가 canonical인 run에서 root fallback을 우선하면 오래된 legacy 산출물이 최신 evidence처럼 보일 수 있다.
- root fallback을 `_root-fallback/`에 분리하면 legacy evidence를 잃지 않으면서 canonical 우선순위를 명확히 할 수 있다.
- built-owned result artifact는 cleanup의 보존 대상이므로 dirty safety gate에서 차단하면 archive 기능의 목적과 충돌한다.
- result dir 밖 변경은 사용자 코드나 수동 조사 결과일 수 있으므로 cleanup 자동화가 삭제해서는 안 된다.

## 대안

- root fallback만 archive한다: worktree-first run의 canonical evidence를 유실하므로 선택하지 않았다.
- registry `resultDir`만 신뢰한다: stale pointer가 있으면 state canonical result dir를 놓칠 수 있어 선택하지 않았다.
- worktree 전체 dirty 상태를 무조건 차단한다: 사용자 변경 보호에는 안전하지만 기본 git 상태의 untracked result artifact 때문에 archive가 실행되지 않아 선택하지 않았다.
- worktree dirty 상태를 모두 허용한다: 사용자 변경을 삭제할 수 있어 선택하지 않았다.
- root fallback으로 worktree result dir를 덮어쓴다: 최신 canonical evidence와 legacy fallback 구분이 사라져 선택하지 않았다.

## 결과

- cleanup archive는 worktree-first canonical 산출물을 worktree 제거 전에 보존한다.
- status/cost/cleanup 소비자는 registry/state/root fallback pointer 우선순위에 맞춰 회귀 검증된다.
- user dirty 변경 보호와 built-owned artifact 보존이 분리된 safety policy로 정리되었다.
- Finisher나 Operator가 감사 evidence를 남겨야 하는 경우 `--archive` 옵션을 명시적으로 사용해야 한다.

## 되돌릴 조건

run lifecycle이 모든 phase 산출물을 root runtime artifact store로 동기화하고, worktree result dir가 더 이상 canonical evidence가 아니게 되면 이 archive source 우선순위를 단순화할 수 있다.

그 경우에도 cleanup은 삭제 전에 감사 evidence 보존 여부를 검증해야 하며, 사용자 변경 보호 safety gate는 유지해야 한다.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Decision",
  "identifier": "ADR-39",
  "name": "worktree resultDir archive 보존 정책",
  "about": "worktree-first cleanup archive source and dirty safety policy",
  "isBasedOn": {"@type": "CreativeWork", "name": "BUI-379"}
}
```
