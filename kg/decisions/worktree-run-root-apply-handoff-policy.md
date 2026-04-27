---
id: ADR-41
title: worktree-first Run 완료 후 root 적용 handoff 정책
type: decision
date: 2026-04-27
status: accepted
context_issue: BUI-386
tags: [architecture, worktree, run, handoff, dx]
---

## 컨텍스트

`/built:run`은 기본적으로 execution worktree에서 Do, Check, Iter, Report를 수행한다.
이 구조는 root working tree를 보호하지만, run 성공 후 사용자가 root에서 변경사항을 바로 보지 못하면 제품 코드 반영 단계가 빠진 것처럼 느낄 수 있다.

기존 worktree KG는 worktree 생성, resultDir pointer, cleanup archive를 다뤘지만, run 완료 후 root 적용 여부와 다음 행동을 사용자에게 어떻게 전달할지는 별도 정책으로 명확하지 않았다.

## 결정

worktree-first run은 root working tree에 변경사항을 자동 적용하지 않는다.
대신 run 완료 stdout, `report.md`, `status`, `cleanup`, `provider-doctor`가 같은 root 적용 handoff 상태를 노출한다.

root 적용 상태는 `state.execution_worktree` 아래 다음 필드를 durable contract 후보로 기록한다.

- `root_applied`: root에 worktree 결과가 적용됐는지의 boolean
- `root_apply_status`: 적용 상태 machine-readable code
- `root_apply_summary`: 사람이 읽는 적용 상태 요약

`status`와 `cleanup`은 registry/state pointer를 우선해 worktree branch, worktree path, result_dir, root 적용 상태를 표시한다.
`provider-doctor`는 completed worktree run이 root 미적용 상태이면 `worktree_handoff` warning을 표시한다.

## 근거

- root 자동 적용은 사용자의 root working tree와 uncommitted 변경을 예기치 않게 바꿀 수 있다.
- execution worktree는 root 보호와 독립 실행이 핵심이므로, 적용은 사용자가 inspect 후 patch apply 또는 branch merge로 명시 수행해야 한다.
- 같은 handoff 정보를 stdout/report/status/cleanup/doctor에 반복 노출하면 사용자가 어느 artifact에서 시작해도 다음 행동을 찾을 수 있다.
- 상태 필드를 state에 남기면 run 직후 stdout을 놓쳐도 후속 진단 도구가 같은 판단을 재구성할 수 있다.

## 대안

- `/built:run` 완료 시 root에 patch를 자동 적용한다: root dirty 상태와 충돌을 안전하게 처리하기 어렵고, worktree-first 격리 원칙을 약화해 선택하지 않았다.
- 별도 `/built:apply` 명령을 이번 범위에서 구현한다: UX는 명확해질 수 있지만 apply 충돌 처리, rollback, partial apply 정책이 별도 설계가 필요해 이번 이슈에서는 문서와 handoff 출력으로 제한했다.
- report에만 next step을 남긴다: 사용자가 `status`, `cleanup`, `doctor`에서 문제를 확인할 때 같은 정보를 얻지 못해 선택하지 않았다.

## 결과

- `src/worktree-handoff.js`가 root 적용 상태 평가와 stdout/report handoff formatter의 공통 helper가 됐다.
- `/built:run`은 완료 시 `state.execution_worktree.root_applied`, `root_apply_status`, `root_apply_summary`를 기록하고 stdout/report에 inspect, patch apply, branch merge, cleanup 절차를 출력한다.
- `scripts/status.js`, `scripts/cleanup.js`, `src/providers/doctor.js`가 completed worktree run의 root 적용 상태를 소비한다.
- `docs/ops/run-worktree-handoff.md`가 사용자-facing handoff 기준 문서가 됐다.

## 되돌릴 조건

안전한 `/built:apply` 명령이 root dirty state, conflict recovery, rollback, branch merge policy를 모두 갖추면 handoff의 다음 단계 일부를 명령 중심으로 축소할 수 있다.
그래도 root 자동 적용 금지는 사용자가 명시적으로 apply를 선택하는 UX가 확립될 때까지 유지한다.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Decision",
  "identifier": "ADR-41",
  "name": "worktree-first Run 완료 후 root 적용 handoff 정책",
  "about": "execution worktree run root apply handoff",
  "isBasedOn": ["BUI-386", "ADR-2", "ADR-37", "ADR-39"]
}
```
