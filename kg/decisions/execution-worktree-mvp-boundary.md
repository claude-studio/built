---
id: ADR-24
title: execution worktree-first MVP 산출물 경계
type: decision
date: 2026-04-27
status: accepted
context_issue: BUI-196
tags: [architecture, worktree, runtime, result, cleanup, run]
---

## 컨텍스트

BUI-75 PoC와 ADR-2는 execution worktree를 `git worktree add`로 만들고 phase 실행과 산출물을 원본 레포에서 분리하는 방향을 정했다.
BUI-196에서는 이 결정을 `/built:run` MVP 경로에 연결하면서, 기존 non-worktree 실행과 provider runner/writer 계약을 깨지 않는 범위가 필요했다.

동시에 root `.built/`에 남는 runtime 상태와 execution worktree 내부에 쌓이는 phase 산출물의 책임이 섞이면 `/built:status`, `/built:cost`, `/built:cleanup`이 서로 다른 `progress.json`을 보거나 잘못된 worktree를 삭제할 수 있다.

## 결정

`/built:run` 기본 실행은 execution worktree-first로 둔다. 단, legacy escape hatch와 root fallback은 유지한다.

경로 책임은 다음과 같이 나눈다.

| 위치 | 책임 |
|------|------|
| root `.built/runtime/runs/<feature>/` | control-plane state, run request, execution worktree pointer |
| root `.built/runtime/registry.json` | feature별 worktree path, branch, canonical resultDir pointer |
| worktree `.built/features/<feature>/` | Do/Check/Iter/Report phase 산출물과 `progress.json` canonical 위치 |
| root `.built/features/<feature>/` | legacy/non-worktree 실행 또는 pointer 부재 시 fallback |

`state.execution_worktree`와 registry entry에는 worktree path, branch, resultDir, cleanup command를 기록한다.
`/built:status`와 `/built:cost`는 registry/state의 `resultDir` pointer를 먼저 읽고, 없을 때만 root `.built/features/<feature>`로 폴백한다.
비용 경고도 execution context 준비 이후 canonical `resultDir/progress.json`을 기준으로 확인한다.

## 결정 이유

- phase 프로세스의 CWD와 산출물 쓰기를 worktree로 모으면 원본 레포의 working tree 오염을 줄일 수 있다.
- root runtime을 control-plane으로 유지하면 기존 run state, registry, run-request 계약을 계속 사용할 수 있다.
- `resultDir` pointer를 SSOT로 두면 status/cost/cleanup이 같은 canonical 산출물을 바라본다.
- legacy escape hatch와 fallback을 유지해야 기존 Claude 기본 run, offline fixture, non-git/비 worktree 흐름이 회귀하지 않는다.
- provider는 파일을 직접 쓰지 않고 runner/writer normalization 경계를 유지해야 하므로, worktree 전환도 runner가 경로와 CWD를 주입하는 방식으로 제한한다.

## 대안

- root `.built/features/<feature>`를 계속 canonical으로 유지: worktree-first 실행의 격리 효과가 약하고 phase 산출물이 원본 레포 상태와 섞인다.
- worktree 내부에 runtime state까지 모두 이동: 기존 state/registry 소비자와 run-request handoff가 크게 바뀌며 호환 비용이 크다.
- worktree 모드를 즉시 강제하고 fallback 제거: 기존 non-worktree 사용자의 회귀 위험이 크고 MVP 범위를 넘는다.

## 되돌릴 조건

다음 조건 중 하나가 확인되면 기본 worktree-first 동작을 재검토한다.

- worktree 생성/재사용이 기본 Claude provider run의 안정성을 반복적으로 떨어뜨린다.
- registry/state pointer가 여러 실행 간 충돌해 canonical resultDir 판정이 불안정해진다.
- provider 비교 모드나 병렬 실행 도입 시 feature 단위 worktree 하나로는 격리가 부족하다는 별도 ADR이 승인된다.

## 검증 기준

- `state.execution_worktree`와 registry에 worktree path, branch, resultDir가 기록된다.
- Do/Check/Iter/Report와 plan synthesis가 같은 execution worktree 컨텍스트에서 실행된다.
- `/built:status`와 `/built:cost`는 worktree canonical `progress.json`을 root fallback보다 우선한다.
- 비용 guard는 worktree 재실행 시 canonical resultDir의 누적 비용을 읽는다.
- cleanup은 explicit worktree path를 허용 루트, expected branch, dirty 상태로 검증한 뒤에만 삭제한다.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Decision",
  "identifier": "ADR-24",
  "name": "execution worktree-first MVP 산출물 경계",
  "isBasedOn": ["BUI-196", "ADR-2"],
  "result": "root runtime은 control-plane pointer로 유지하고 worktree .built/features/<feature>를 phase 산출물 canonical 위치로 사용한다."
}
```
