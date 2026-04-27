---
id: ADR-37
title: Plan/Design/Run root-context artifact 계약
type: decision
date: 2026-04-27
status: accepted
context_issue: BUI-351
tags: [architecture, artifacts, root-context, provider-doctor, dx]
---

## 컨텍스트

built plugin code는 plugin repo나 cache에서 실행될 수 있고, target project artifact는 별도 project root 아래에 생성된다.
provider execution은 worktree cwd에서 일어날 수도 있어 `project_root`, `plugin_root`, `execution_root`, `runtime_root`, `result_root`가 서로 다를 수 있다.
이 구분이 artifact에 남지 않으면 dogfooding 실패 보고에서 어느 `.built/runs`, `.built/features`, `.built/runtime`을 확인해야 하는지 불명확해진다.

## 결정

Plan, Design/`plan_synthesis`, Run 시작 시점에 같은 의미의 `root-context.json` 또는 root/path 로그를 남긴다.
공통 필드는 `schema_version`, `phase`, `feature`, `project_root`, `plugin_root`, `execution_root`, `runtime_root`, `result_root`, `artifact_paths`, `warnings`다.

`project_root`는 target project의 기준이다.
`plugin_root`는 helper code 위치 추적용이며 artifact 저장 기준이 아니다.
`execution_root`는 provider가 실제 파일을 수정하는 cwd일 수 있고 worktree 실행에서는 `project_root`와 다를 수 있다.
`runtime_root`는 lifecycle artifact 기준이며 기본값은 `<project_root>/.built/runtime`이다.
`result_root`는 사람이 읽는 phase 결과, progress, log artifact 기준이다.

root-context warning은 `project_root_matches_plugin_root`, `runtime_root_outside_project_root`, `result_root_outside_project_root`로 시작한다.
provider-doctor는 feature가 지정된 상태에서 cwd가 plugin/repository root로 보이고 target feature spec이 없으면 `root_separation` hard failure를 반환한다.

## 근거

- 실패 보고에서 root/path summary가 먼저 보이면 전체 로그나 실행 환경을 재현하지 않고도 artifact 위치를 좁힐 수 있다.
- plugin root는 code provenance에는 중요하지만 target project `.built` 저장 위치로 쓰면 안 된다.
- provider execution cwd는 worktree나 broker runtime과 결합될 수 있으므로 target artifact 위치와 같은 개념으로 취급하면 안 된다.
- target feature spec이 없는 plugin repo cwd 실행은 사용자가 의도한 target project를 벗어난 가능성이 높아 smoke 전에 막는 편이 안전하다.

## 대안

- stdout 로그만 남긴다: 실패 보고에서 artifact만 공유된 경우 추적성이 떨어져 선택하지 않았다.
- `process.cwd()`만 project root로 사용한다: runner나 plugin cache 호출에서 cwd 보장이 깨질 수 있어 선택하지 않았다.
- root 혼동을 모두 warning으로 둔다: smoke artifact가 잘못된 root에 쓰인 뒤에야 발견될 수 있어 feature 지정 doctor에서는 hard failure를 선택했다.

## 결과

- `docs/contracts/file-contracts.md`가 Plan/Design/Run root-context 계약의 기준 문서가 됐다.
- `src/root-context.js`가 root-context 생성과 warning 판단의 공통 helper가 됐다.
- `provider-doctor root_separation`이 target project와 plugin repo 혼동을 사전 차단하는 게이트가 됐다.
- `plan_synthesis` canonical writer는 명시 `resultRoot`가 있을 때 root-context와 같은 result root에 산출물을 쓴다.

## 되돌릴 조건

plugin runtime이 target project root를 구조적으로 보장하고 provider execution root와 artifact root가 더 이상 분리되지 않는 architecture로 바뀌면 root-context 필드 일부를 축소할 수 있다.
그 전까지는 root-context와 provider-doctor root separation을 유지한다.
