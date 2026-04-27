---
id: ADR-42
title: Report agent-local KG 계약
type: decision
date: 2026-04-27
status: accepted
context_issue: BUI-415
tags: [architecture, report, kg, artifacts, provider-boundary]
---

## 컨텍스트

Report 단계는 완료된 실행 결과를 다음 Plan이 재사용할 수 있는 durable memory로 남겨야 한다.
이전 BUI-385 계약은 Report KG draft를 target project `kg/issues/<FEATURE>.md`로 정렬했지만, BUI-415의 기준은 built와 target repo 바깥의 agent folder KG다.

agent runtime은 프로젝트별 기억을 `~/Desktop/agents/codex-pdca-agent/projects/<project-slug>/kg/`에서 읽는다.
target repo나 built plugin repo/cache 아래 `kg/`에 KG draft를 쓰면 agent-local memory와 코드 저장소의 책임이 섞인다.

## 결정

Report KG 산출물의 canonical root는 agent folder 내부 `~/Desktop/agents/codex-pdca-agent/projects/<project-slug>/kg/`다.

Report artifact와 `root-context.json`은 KG 위치를 `agent_kg_issue`와 `agent_kg_root`로 기록한다.
`agent_kg_issue`는 생성된 issue 문서 경로이고, `agent_kg_root`는 project-local KG root다.

Report runner는 provider 결과와 `kg_candidates`를 해석해 writer 계층을 호출한다.
provider는 KG Markdown 파일을 직접 쓰지 않는다.

`kg_draft`, `kg_draft_target_root`, `artifact_paths.kg_draft`는 BUI-415 이후 새 Report KG 계약에서 사용하지 않는다.
과거 BUI-385 기록의 target repo `kg_draft` 계약은 superseded context로만 참조한다.

## 근거

- agent-local KG가 다음 Plan의 prior art이므로 Report 결과도 같은 root에 있어야 한다.
- target repo에 KG draft를 남기면 제품 repository와 agent memory가 결합된다.
- built plugin repo나 설치형 cache에 KG draft를 남기면 project별 memory가 runtime 위치에 묶여 drift가 발생한다.
- provider/runner 경계는 기존 ADR-3처럼 유지되어야 한다. 파일 계약은 runner와 writer 계층이 소유해야 provider 교체 중 산출물 구조가 흔들리지 않는다.
- `agent_kg_issue`와 `agent_kg_root`를 metadata에 남기면 issue comment나 전체 execution dump 없이도 KG 위치를 복원할 수 있다.

## 결과

- `src/agent-kg-writer.js`가 agent-local Markdown KG writer의 기준 구현이 됐다.
- `scripts/report.js`는 Report 결과에서 KG issue 문서와 decision/pattern/entity/workflow 후보 초안을 생성할 수 있다.
- `scripts/run.js`와 report artifact는 `agent_kg_issue`/`agent_kg_root` metadata를 남긴다.
- `docs/contracts/file-contracts.md`와 root artifact workflow는 target repo/plugin repo `kg/` 미작성 조건을 검증한다.
- 다음 Plan은 `skills/plan/SKILL.md`에 명시된 agent-local KG prior art 경로를 읽는다.

## 대안

- target repo `kg/issues`에 계속 쓴다: 제품 repo에 agent memory를 남기게 되어 이슈의 비범위와 충돌한다.
- built plugin repo/cache에 쓴다: 설치 위치와 프로젝트 memory가 섞이고 multi-project 운영에서 재사용성이 떨어진다.
- provider가 직접 KG 파일을 쓴다: provider별 파일 계약이 중복되고 runner-level artifact 검증이 약해진다.
- Report artifact에 KG 경로를 남기지 않는다: 다음 Plan과 Finisher가 KG 위치를 추적하려면 issue comment나 실행 로그에 의존해야 한다.

## 되돌릴 조건

agent runtime이 project memory root를 target repo 내부로 공식 이전하거나, 별도 동기화 계층이 agent folder와 target repo KG를 일관되게 관리하는 새 계약이 승인되면 이 결정을 재검토한다.
그 전까지 Report KG 산출물은 agent-local root와 `agent_kg_issue`/`agent_kg_root` metadata를 기준으로 한다.
