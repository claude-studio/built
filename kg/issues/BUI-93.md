---
id: BUI-93
title: "[Security] sanitize/pre-commit 대상을 현재 산출물 계약과 정렬"
type: issue
date: 2026-07-27
status: completed
supports_goal: [GOAL-1]
agent: Builder
branch: agent/builder/638b77a0
pr: https://github.com/claude-studio/built/pull/143
merge_commit: ""
kg_files: [kg/issues/BUI-93.md, kg/workflows/artifact-redaction-regression.md]
week: 31
tags: [security, sanitize, pre-commit, artifact, worktree, jsonl]
keywords: [sanitize pre-commit artifact worktree progress JSON JSONL staged redaction]
---

## 목표

`/built:sanitize`와 설치형 pre-commit hook의 대상을 현재 file/worktree contract와 정렬해, current project 또는 execution worktree의 커밋 가능한 public artifact가 공통 redaction 안전망을 우회하지 않게 한다.

## 구현 내용

- `scripts/sanitize.js`의 인자 없는 기본 대상에 기존 `.built/runs/`와 현재 phase 산출물 위치인 `.built/features/`를 함께 포함했다.
- Markdown, JSON, JSONL을 지원하고 JSON document와 JSONL의 비어 있지 않은 각 줄이 redaction 후에도 parse 가능한 구조를 유지하게 했다.
- 숫자·boolean 형태의 민감 필드도 따옴표 없는 text 치환이 아니라 유효한 JSON string redaction 값으로 바꾼다.
- 명시 target CLI와 기존 `runsDir` API 호환성을 유지하면서 project root 밖 경로와 symlink 이탈을 거부한다.
- `scripts/install-hooks.js`는 staged `.built/runs/`, `.built/features/` artifact blob만 검사하고 실제로 변경된 index entry만 갱신한다.
- hook은 공백이 포함된 파일명과 부분 stage를 처리하고, unstaged working tree 변경과 index mode를 보존한다.
- `README.md`, `skills/sanitize/SKILL.md`, `docs/contracts/file-contracts.md`를 기본 대상, 지원 형식, execution worktree 의미, staged-blob 경계와 일치시켰다.
- `test/sanitize.test.js`와 `test/install-hooks.test.js`에 runs/features, custom target, worktree 격리, 경로 이탈, symlink, JSON/JSONL 구조, 공백 파일명, 부분 stage, 비대상 파일 회귀를 추가했다.

## 결정 사항

- 기본 sanitize 대상은 current project 또는 execution worktree root의 `.built/runs/`, `.built/features/` public Markdown/JSON/JSONL artifact로 제한한다.
  현재 canonical artifact 경로를 모두 포함하면서 `.built/runtime/`, 다른 worktree, project 밖 파일까지 넓게 탐색하지 않기 위해서다.
- JSON/JSONL은 text 치환만 적용하지 않고 parse 후 구조화 redaction을 수행한다.
  숫자형 민감 값에 문자열 placeholder를 그대로 덮으면 JSON 문법이 깨져 `progress.json`과 phase log가 복구 불가능해지기 때문이다.
- pre-commit hook은 working tree 전체를 다시 stage하지 않고 변경된 staged blob만 교체한다.
  보안 마스킹을 적용하면서 사용자가 의도하지 않은 unstaged 변경이 commit에 섞이는 것을 막기 위해서다.
- 공통 sanitizer는 마지막 안전망이며 writer 계약을 대체하지 않는다.
  provider는 결과 파일을 직접 쓰지 않고 runner/control plane writer가 저장 직전 redaction과 file contract를 계속 소유한다.

## 발생한 이슈와 review history

- 이 이슈는 2026-04-25 KST에 agents-v2 운영모델과 provider/file contract 재정의를 기다리며 freeze되었다.
- 2026-07-27 KST 재검증에서 역할별 운영모델, writer 소유권, lifecycle SSOT, execution worktree resultDir 계약이 accepted 상태로 확인되어 작업이 재개되었다.
- Builder는 canonical PR #143, branch `agent/builder/638b77a0`, 최초 head `e7c414e74b461505d85a673c70be9ead3ca476c7`로 기본 대상과 hook 경계를 구현했다.
- Reviewer 1차 검토는 숫자형 `chat_id`가 따옴표 없는 redaction 문자열로 치환되어 JSON/JSONL parse 계약을 깨는 문제를 FAIL로 판정했다.
- Builder는 JSON document와 JSONL 각 줄을 구조적으로 처리하고 숫자·boolean 민감 필드 회귀 테스트를 추가한 head `114d7877177870bac693f355dd09ed02ccc453fb`를 push했다.
- Reviewer는 2026-07-27 09:42 KST에 2차 PASS를 판정했다. 같은 BUI 번호의 다른 open PR과 superseded PR은 없고 PR #143은 mergeable/CLEAN으로 확인되었다.
- GitHub와 issue metadata는 PR #143을 canonical로 일치하게 가리켰지만, Recorder 시작 시점의 `multica issue pull-requests` 링크 테이블은 비어 있었다. 구현·계약 blocker는 아니며 Finisher가 병합 전 같은 PR의 링크 상태를 다시 확인해야 한다.

## 완료 기준 충족 여부

| 기준 | 상태 |
|------|------|
| 기본 실행이 `.built/runs/`, `.built/features/` public artifact를 처리 | 완료, Markdown/JSON/JSONL 지원 |
| execution worktree의 canonical resultDir만 처리 | 완료, current project root 경계와 symlink 이탈 거부 |
| phase result, `progress.json`, JSONL log가 sanitizer를 우회하지 않음 | 완료, 기본 실행과 staged hook에 포함 |
| pre-commit이 정확한 staged 파일만 sanitize 후 갱신 | 완료, 부분 stage·공백 파일명·비대상 파일 회귀 검증 |
| 기존 runs 및 custom target 호환성 유지 | 완료, 기존 `runsDir` API와 명시 target 검증 |
| JSON/JSONL 구조 유효성 보존 | 완료, 전체 document와 각 JSONL line parse 검증 |
| provider/writer 소유권 경계 유지 | 완료, provider/runner/writer 구현은 변경하지 않음 |
| 문서와 skill 정렬 | 완료, README·skill·file contract 갱신 |

Reviewer가 확인한 검증 결과:

- `node test/sanitize.test.js`: 62/62 통과
- `node test/install-hooks.test.js`: 3/3 통과
- `node test/file-contracts.test.js`: 33/33 통과
- `npm test`: 단위 테스트 파일 47/47, E2E 시나리오 5/5 통과
- 추가 재현: 숫자·boolean 민감 필드를 포함한 JSON 및 JSONL parse 통과
- `git diff --check origin/main...HEAD`: 통과

## 재발 방지 포인트

- `.built/features/<feature>/progress.json`과 `logs/*.jsonl`을 text sanitizer로만 처리하지 않는다. redaction 후 JSON document와 JSONL one-object-per-line 구조를 반드시 재검증한다.
- 숫자·boolean 민감 필드는 따옴표 없는 placeholder로 치환하지 않고 구조화된 JSON string redaction 값으로 바꾼다.
- pre-commit hook에서 working tree 파일을 통째로 `git add`하지 않는다. staged blob을 읽고 실제 변경된 index entry만 갱신해 부분 stage를 보존한다.
- 기본 탐색 범위를 `.built/runtime/`, 다른 worktree, project 밖 경로까지 넓히지 않는다. 명시 target도 current project root 내부인지와 symlink 이탈 여부를 확인한다.
- sanitizer는 writer 단계 redaction의 대체물이 아니다. 새 artifact writer는 저장 직전 공통 helper를 적용하고 sanitizer는 커밋 전 마지막 안전망으로 유지한다.
- KG, 문서, 테스트 fixture에 실제 secret, private environment value, raw execution dump, private local path를 남기지 않는다.

## 관련 기준

- `kg/goals/north-star.md`
- `kg/decisions/provider-event-normalization-and-standard-writer.md`
- `kg/decisions/artifact-redaction-public-private-boundary.md`
- `kg/decisions/execution-worktree-mvp-boundary.md`
- `kg/workflows/artifact-redaction-regression.md`
- `docs/contracts/file-contracts.md`

## KG 판단

- 새 ADR은 만들지 않는다. 이번 변경은 ADR-25의 public artifact redaction 경계와 ADR-24의 execution worktree 경계를 sanitize CLI와 pre-commit 안전망에 적용한 후속 보강이다.
- 재사용 가능한 검증 순서와 실패 모드는 `kg/workflows/artifact-redaction-regression.md`에 추가한다.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-93",
  "name": "[Security] sanitize/pre-commit 대상을 현재 산출물 계약과 정렬",
  "agent": {"@type": "SoftwareAgent", "name": "Builder"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/143"},
  "actionStatus": "CompletedActionStatus"
}
```
