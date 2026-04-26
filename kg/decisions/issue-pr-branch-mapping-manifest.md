---
id: ADR-14
title: issue-PR-branch mapping SSOT — kg/issues/ frontmatter
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-229
tags: [ops, mapping, pr, branch, kg, manifest, duplicate-pr]
---

## 컨텍스트

built 워크플로우에서 이슈 하나가 어떤 branch, PR, merge commit, KG 파일과 연결됐는지
단일 위치에서 추적하는 수단이 없었다. 그 결과 중복 PR 생성, 누락된 KG 기록, stale
branch cleanup 판단 어려움이 반복됐다.

## 결정

`kg/issues/BUI-<N>.md` frontmatter를 이슈-PR-branch mapping의 SSOT로 지정한다.

추가된 필드:
- `branch`: Builder가 PR 생성 시 기록
- `pr`: Builder가 PR 생성 시 기록
- `merge_commit`: Finisher가 squash merge 후 기록
- `kg_files`: Recorder가 KG 기록 완료 시 기록

계약 세부 사항은 `docs/contracts/issue-pr-mapping.md`에 정의한다.

## 근거

- `kg/issues/` 파일이 이미 `branch`와 `pr` 필드를 포함하고 있어 기존 패턴의 자연스러운
  확장이다.
- 별도 manifest 디렉토리를 만들면 두 위치를 동기화해야 하는 부담이 생긴다.
- 현재 KG 스키마와 에이전트 역할 분리(Builder/Recorder/Finisher)가 이미 단계별 업데이트
  책임을 구분하기에 적합하다.
- private token, 내부 경로, raw execution log를 포함하지 않는 공개 정보(PR URL, branch명,
  merge SHA)만 기록하므로 보안 제약을 만족한다.

## 결과

- Builder는 PR 생성 전 mapping 조회로 중복 PR 생성을 방지할 수 있다.
- Finisher는 merge 후 mapping에 merge_commit을 기록해 PR-merge commit 연결을 유지한다.
- Recorder는 kg_files 필드로 KG 기록 완료 여부를 추적할 수 있다.
- stale branch cleanup 시 mapping의 `pr` 필드로 canonical PR 상태를 한 번에 확인할 수
  있다.

## 대안

1. **별도 manifest 파일(예: `kg/manifests/pr-manifest.md`)**: 추가 동기화 부담과 기존
   `kg/issues/` 구조와의 이중화가 발생한다. 선택하지 않음.
2. **Multica DB 스키마 변경**: 이슈 비범위로 명시됐다. 선택하지 않음.
3. **GitHub issue tracker 이전**: 이슈 비범위로 명시됐다. 선택하지 않음.
