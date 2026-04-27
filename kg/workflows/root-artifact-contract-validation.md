---
id: WF-30
title: Plan/Design/Run/Report root artifact 계약 검증 워크플로우
type: workflow
date: 2026-04-27
validated_by: [BUI-351, BUI-385, BUI-415]
tags: [root-context, artifacts, plan, run, report, provider-doctor, regression]
---

## 패턴 설명

Plan, Design/`plan_synthesis`, Run, Report의 root나 artifact 경로를 바꿀 때는 target project root와 plugin root를 분리해 검증한다.
dogfooding 실패 보고만으로 실제 산출물 위치를 추적할 수 있도록 시작 시점 root-context와 writer output path가 같은 계약을 따라야 한다.

## 언제 사용하나

- `src/root-context.js`의 field, warning, plugin root 추론을 바꿀 때
- `scripts/plan-draft.js`, `scripts/plan-synthesis.js`, `scripts/run.js`, `scripts/report.js`의 root 해석이나 시작 로그/metadata를 바꿀 때
- `BUILT_PROJECT_ROOT`, `BUILT_RUNTIME_ROOT`, `BUILT_RESULT_ROOT` 처리 우선순위를 바꿀 때
- provider execution worktree와 target project artifact root의 관계를 조정할 때
- `provider-doctor root_separation` 기준을 바꿀 때
- `docs/contracts/file-contracts.md`의 root-context 표를 수정할 때

## 단계

1. `docs/contracts/file-contracts.md`의 `root-context.json` 표를 먼저 확인한다.
2. target project fixture와 plugin repo/helper path를 분리해 테스트한다.
3. Plan draft는 target project `.built/runs/<feature>/plan-draft.md`와 `.built/runs/<feature>/root-context.json`에 기록되는지 확인한다.
4. Design/`plan_synthesis`는 `root-context.json`의 `result_root`와 실제 `plan-synthesis.json`, `plan-synthesis.md` writer 경로가 일치하는지 확인한다.
5. Run은 `.built/runtime/runs/<feature>/root-context.json`에 `run_request`, `state`, `progress`, phase result path가 추적 가능한지 확인한다.
6. Report는 `root-context.json`의 `artifact_paths.agent_kg_issue`와 report frontmatter의 `agent_kg_issue`, `agent_kg_root`가 agent folder 기준 `~/Desktop/agents/codex-pdca-agent/projects/<project-slug>/kg/issues/<FEATURE>.md`와 `~/Desktop/agents/codex-pdca-agent/projects/<project-slug>/kg/`를 가리키는지 확인한다.
7. target project, plugin root 또는 helper `__dirname` 아래 `kg/`에 agent-local KG artifact가 생기지 않는지 확인한다.
8. `project_root_matches_plugin_root`, `runtime_root_outside_project_root`, `result_root_outside_project_root` warning이 root 혼동 후보를 표현하는지 확인한다.
9. feature가 지정된 doctor 실행에서 cwd가 plugin/repository root이고 target feature spec이 없으면 `root_separation`이 `fail`인지 확인한다.
10. 관련 변경 후 최소 `node test/plan-draft.test.js`, `node test/plan-synthesis.test.js`, `node test/provider-doctor.test.js`를 실행한다. Report KG draft 경로를 바꿨다면 `node test/report.test.js`와 `node test/run.test.js`도 실행한다.
11. root-context 계약이 runner 전반에 영향을 주면 `node scripts/run-tests.js --unit`까지 실행한다.

## 주의사항

- `plugin_root`는 code 위치를 설명하는 field이며 artifact 저장 기준이 아니다.
- `execution_root`와 `project_root`가 다를 수 있다는 사실을 실패로 보지 않는다. worktree 실행에서는 정상일 수 있다.
- `runtime_root`와 `result_root`가 target project 밖이면 dogfooding 실패 분석에서 강한 root drift 신호로 취급한다.
- `BUILT_RESULT_ROOT`를 별도로 주입하는 phase는 로그만 맞추고 writer path를 기본값으로 두면 안 된다.
- Report KG draft는 agent folder `~/Desktop/agents/codex-pdca-agent/projects/<project-slug>/kg/` 기준이다. target project 또는 설치형 plugin package/cache의 `kg/`에 draft를 쓰면 root drift로 본다.
- BUI-415 이전 Report KG draft 필드명은 superseded 계약이다. Report KG 위치는 `agent_kg_issue`와 `agent_kg_root`를 기준으로 확인한다.
- provider가 built artifact를 직접 쓰는 방식으로 root 혼동을 해결하지 않는다. runner/helper writer 계층이 파일 계약을 소유한다.

## 관련 문서

- `docs/contracts/file-contracts.md`
- `src/root-context.js`
- `src/providers/doctor.js`
- `scripts/plan-draft.js`
- `scripts/plan-synthesis.js`
- `scripts/run.js`
- `scripts/report.js`
- `kg/decisions/root-context-artifact-contract.md`
