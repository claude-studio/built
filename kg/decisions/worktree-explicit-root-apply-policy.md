---
id: ADR-42
title: execution worktree 결과의 명시적 root apply 안전 정책
type: decision
date: 2026-08-24
status: accepted
context_issue: BUI-966
supports_goal: [GOAL-1]
tags: [architecture, worktree, apply, safety, state, cleanup]
---

## 컨텍스트

ADR-24는 execution worktree와 control-plane state/resultDir 경계를, ADR-41은 `/built:run` 완료 뒤 root 자동 적용 금지와 수동 handoff를 확정했다.
수동 handoff는 root를 보호하지만 사용자가 여러 Git 명령을 조합해야 하므로, BUI-966은 격리 원칙을 유지하면서 검증된 결과를 한 번의 명시 호출로 적용하는 안전 경계를 결정해야 했다.

## 결정

`/built:apply <feature>`는 사용자가 명시적으로 호출한 경우에만 completed execution worktree 결과를 root에 적용한다. `/built:run`은 계속 자동 apply하지 않는다.

적용 전에 control root의 `state.json`과 registry pointer로 canonical worktree path, expected branch, resultDir을 해석하고 다음 조건을 모두 확인한다.

- run이 `completed`이고 아직 root에 적용되지 않았을 것
- worktree path가 허용된 root 안에 있고 expected branch와 일치할 것
- root working tree가 clean할 것
- state, registry, resultDir pointer가 같은 실행을 가리킬 것
- worktree 변경이 patch 또는 fast-forward 한 방식으로만 적용 가능할 것

commit 없는 uncommitted 변경은 untracked 파일을 포함한 binary patch를 만들고 root에서 `git apply --check`를 통과한 뒤 적용한다.
committed branch는 uncommitted 변경이 없고 root HEAD에서 fast-forward 가능할 때만 `git merge --ff-only`로 적용한다.
committed/uncommitted mixed 상태, non-fast-forward, conflict, dirty root, stale pointer, branch mismatch는 자동 정리하거나 병합하지 않는다.

`--dry-run`은 preflight 결과와 예정 method만 출력하고 root와 state를 바꾸지 않는다.
skill entrypoint에서도 dry-run과 실제 apply는 하나의 invocation 안에서 상호 배타적이다.

성공한 patch, fast-forward 또는 검증된 no-op 뒤에만 control-plane writer가 `state.execution_worktree.root_applied`와 `root_apply_*` evidence를 갱신한다.
evidence에는 status, summary, method, 적용 시각, root/worktree commit, patch 방식의 SHA-256이 포함될 수 있다. provider는 root와 file contract를 직접 쓰지 않는다.

patch 적용 후 cleanup은 기록된 patch hash와 현재 worktree 변경이 같을 때만 허용한다. 적용 이후 worktree에 새 변경이 생기면 cleanup을 중단해 해당 변경을 보존한다.

## 근거

- 별도 명시 호출은 worktree-first 격리와 사용자의 변경 의도를 동시에 보존한다.
- binary patch와 fast-forward는 적용 범위와 성공 조건을 사전에 검증할 수 있고, 충돌 해결이나 이력 재작성 없이 결과가 결정적이다.
- mixed 상태와 non-fast-forward를 거부하면 자동화가 commit/working tree 변경을 임의로 합치거나 충돌 해결 책임을 떠안지 않는다.
- success-only state evidence는 진단 도구가 실제 적용 결과를 lifecycle SSOT에서 재구성하게 한다.
- machine-readable failure code와 복구 안내는 변경 없는 실패를 자동화와 사람이 같은 의미로 다룰 수 있게 한다.
- patch hash는 원본 patch나 사용자 데이터를 state에 보존하지 않고도 적용 뒤 추가 변경을 식별하는 최소 evidence다.

## 결과

- `scripts/apply.js`, `/built:apply`, `src/worktree-apply.js`가 명시적 root apply 경로를 제공한다.
- `status`, `cleanup`, `provider-doctor`가 같은 state evidence와 복구 경로를 노출한다.
- `dirty_root`, `mixed_worktree`, `apply_conflict`, `non_fast_forward`, `stale_pointer`, `branch_mismatch` 같은 failure code가 root/state 무변경 preflight 결과를 표현한다.
- 이미 적용됐거나 적용할 변경이 없는 경로는 멱등 no-op으로 수렴한다.
- Git 적용 뒤 state 원자 쓰기가 실패하면 `state_update_failed`를 보고한다. 이 시점에는 root가 이미 바뀌었을 수 있으므로 자동 rollback 대신 실제 Git 상태 확인과 state 복구를 요구한다.

## 대안

- `/built:run` 종료 시 자동 적용: 사용자의 root를 예기치 않게 바꾸고 execution worktree 격리를 약화하므로 선택하지 않았다.
- dirty root 위 강제 patch 또는 merge: 사용자 변경과 run 결과의 소유권을 안전하게 구분할 수 없어 선택하지 않았다.
- mixed 상태를 commit 또는 patch로 자동 정규화: 적용 범위와 history 생성 의도를 자동화가 대신 결정하게 되어 선택하지 않았다.
- non-fast-forward merge 또는 충돌 자동 해결: 결과가 사전 검증 가능한 단일 적용이 아니며 rollback 범위가 커져 선택하지 않았다.
- Git 적용 뒤 state 쓰기 실패 시 자동 rollback: rollback 자체가 새 충돌이나 사용자 변경 유실을 만들 수 있고 BUI-966 범위를 넘어 선택하지 않았다.
- 원본 patch를 state에 저장: lifecycle SSOT에 사용자 변경 내용을 복제하므로 hash evidence만 저장한다.

## 되돌릴 조건

transactional Git/state commit과 검증된 rollback engine이 도입되어 적용과 evidence 기록을 원자적으로 되돌릴 수 있으면 `state_update_failed` 복구 정책을 재검토할 수 있다.
partial apply 또는 non-fast-forward 통합을 지원하려면 별도 사용자 승인, 충돌 resolution artifact, rollback 계약, 회귀 테스트를 먼저 정의해야 한다.

root 자동 적용 금지, dirty root 보호, provider 직접 쓰기 금지는 별도 승인된 상위 정책 없이는 유지한다.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Decision",
  "identifier": "ADR-42",
  "name": "execution worktree 결과의 명시적 root apply 안전 정책",
  "about": "validated explicit application of execution worktree results to the root working tree",
  "isBasedOn": ["BUI-966", "ADR-24", "ADR-41"]
}
```
