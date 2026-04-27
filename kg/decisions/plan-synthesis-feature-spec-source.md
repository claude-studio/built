---
id: ADR-40
title: plan_synthesis feature spec source of truth
type: decision
date: 2026-04-27
status: accepted
context_issue: BUI-381
tags: [architecture, plan_synthesis, root-context, worktree, contracts]
---

## 컨텍스트

`/built:run`은 execution worktree cwd에서 `plan_synthesis`를 실행할 수 있다.
이때 `run-request.json`의 `planPath`가 absolute면 root spec을 그대로 읽고, relative면 cwd 기준 worktree spec을 읽을 수 있어 Design 입력 기준이 달라질 위험이 있었다.

root-context는 `controlRoot`, `executionRoot`, `resultRoot`를 분리하고 있었지만, feature spec path가 어느 root를 source of truth로 삼는지 계약은 명확하지 않았다.
worktree sync 이후 control root spec과 execution worktree spec이 drift하면 같은 feature라도 planPath 표현 방식에 따라 서로 다른 설계 입력이 만들어질 수 있었다.

## 결정

Design / `plan_synthesis`의 feature spec source of truth는 control root다.
`scripts/plan-synthesis.js`는 `BUILT_PROJECT_ROOT`를 control root로 전달하고, `src/plan-synthesis.js`는 relative `planPath`와 execution worktree 내부 absolute `planPath`를 모두 control root의 같은 상대 feature spec으로 정규화한다.

`feature_spec_source` 메타데이터를 payload, `root-context.json`, `plan-synthesis.json`, `plan-synthesis.md`에 기록한다.
필드는 `source`, `source_root`, `requested_path`, `resolved_path`다.
`source`는 이 경로가 control root 기준임을 나타내고, `source_root`와 `resolved_path`는 실제 읽은 spec 위치를 확인하는 감사 필드다.

control root와 execution worktree 어느 쪽에도 속하지 않는 임의 absolute `planPath`는 기존처럼 explicit absolute path로 해석한다.
이번 결정은 `/built:run` worktree 실행에서 같은 feature spec을 안정적으로 고르는 계약을 고정하는 범위다.

## 근거

- Plan/Design 단계의 feature spec은 control plane에서 사용자가 승인한 입력이므로 execution worktree cwd에 의해 바뀌면 안 된다.
- worktree는 구현 변경을 격리하기 위한 실행 공간이지, Design source를 암묵적으로 재선택하는 기준이 아니다.
- absolute/relative 표현 방식에 따라 spec이 달라지면 plan synthesis artifact와 downstream `do` phase가 같은 feature에 대해 서로 다른 요구사항을 따를 수 있다.
- `feature_spec_source`를 artifact에 남기면 raw log 없이도 어떤 spec을 읽었는지 확인할 수 있다.
- provider가 파일을 직접 쓰지 않고 runner/helper가 canonical artifact를 기록하는 기존 provider boundary를 유지한다.

## 대안

- execution worktree spec을 source of truth로 삼는다: worktree sync 타이밍이나 drift에 따라 Design 입력이 바뀌고, control root에서 승인한 spec과 달라질 수 있어 선택하지 않았다.
- `planPath`가 absolute면 absolute, relative면 cwd 기준으로 둔다: 이번 버그의 원인이므로 선택하지 않았다.
- `planPath`를 항상 absolute로만 요구한다: 기존 run-request와 사용자 입력 호환성을 깨고, worktree 내부 absolute path drift도 막지 못해 선택하지 않았다.

## 결과

- 같은 feature의 `plan_synthesis` 입력은 `planPath` 표현 방식과 execution cwd에 따라 달라지지 않는다.
- `docs/contracts/plan-synthesis-input.md`와 `docs/contracts/file-contracts.md`가 control root 기준과 `feature_spec_source` 필드를 계약으로 설명한다.
- `root-context.json`과 `plan-synthesis.json`에서 `feature_spec_source.source_root`와 `resolved_path`를 확인할 수 있다.
- worktree spec drift 회귀는 `test/plan-synthesis.test.js`의 relative/absolute/worktree 테스트로 고정됐다.

## 되돌릴 조건

future architecture에서 Design 입력 자체가 execution worktree spec을 기준으로 삼도록 제품 요구가 바뀌면, 이 ADR을 대체하는 별도 결정과 migration이 필요하다.
그 경우에도 source root와 resolved path artifact 기록은 유지해야 한다.
