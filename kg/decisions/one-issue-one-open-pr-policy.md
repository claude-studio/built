---
id: ADR-15
title: 한 이슈 하나의 canonical open PR 운영 원칙
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-186
tags: [ops, pr, duplicate-pr, canonical-pr, merge-gate]
---

## 컨텍스트

Builder가 같은 이슈에서 새 PR을 반복 생성하거나, Reviewer와 Finisher가 서로 다른 PR을 기준으로
판단하면 리뷰 결과, KG 기록, merge 대상이 분리된다. built 운영에서는 Multica issue comment가
handoff SSOT이고 `kg/issues/BUI-<N>.md` frontmatter가 branch/PR mapping SSOT이므로, 이 두
근거가 같은 canonical PR을 가리켜야 한다.

## 결정

built 개발 플로우는 기본적으로 이슈 하나당 open PR 하나만 유지한다.

- Builder는 PR 생성 전에 같은 BUI 번호가 제목에 포함된 open PR과 현재 head branch의 open PR을
  조회한다.
- 기존 open PR이 있으면 새 PR을 만들지 않고 해당 PR head branch에 추가 commit한다.
- canonical PR은 `kg/issues/BUI-<N>.md`의 `pr` 필드와 최신 handoff comment의 PR URL을 기준으로
  확인한다.
- Reviewer는 같은 BUI 번호의 open PR이 여러 개이면 PASS하지 않는다.
- Finisher는 같은 BUI 번호의 open PR이 여러 개이거나 canonical이 불명확하면 merge하지 않는다.
- PR 제목은 `[BUI-<N>] <한글 요약>`을 사용하고, branch는 가능한 한
  `agent/builder/BUI-<N>-<slug>` 형식을 사용한다.

## 근거

- PR이 여러 개이면 어떤 PR이 최신 구현인지, 어느 branch에 Recorder KG commit을 추가해야 하는지,
  Finisher가 어떤 head commit을 merge해야 하는지 분기된다.
- BUI 번호를 PR 제목과 branch에 포함하면 GitHub 검색, issue handoff, KG mapping, stale branch
  cleanup이 같은 키로 연결된다.
- `kg/issues/` mapping을 활용하면 별도 manifest나 GitHub 보호 규칙 변경 없이 현재 운영 모델 안에서
  canonical PR을 추적할 수 있다.
- 정상 상태인 open PR 1개 흐름은 추가 확인만 통과하면 되므로 개발 흐름을 불필요하게 막지 않는다.

## 대안

1. **중복 PR을 허용하고 Finisher가 최종 선택**: 리뷰와 KG 기록이 잘못된 PR에 붙을 수 있어 선택하지
   않았다.
2. **GitHub 보호 규칙으로 강제**: 이슈 범위 밖이며 Multica issue와 KG mapping의 문맥을 직접 알 수
   없어 선택하지 않았다.
3. **별도 PR manifest 파일 추가**: `kg/issues/` frontmatter SSOT와 중복되어 동기화 부담이 커진다.
   선택하지 않았다.

## 되돌릴 조건

- provider comparison처럼 의도적으로 여러 PR을 비교하는 별도 워크플로우가 canonical 개발 PR과
  분리된 식별자와 merge policy를 갖추면, 해당 워크플로우에는 이 원칙을 적용하지 않을 수 있다.
- GitHub 또는 Multica가 issue-to-PR canonical mapping을 native contract로 제공하면
  `kg/issues/` frontmatter 의존을 재검토한다.

## 결과

- Builder는 중복 PR을 만들기 전에 기존 canonical PR을 재사용한다.
- Reviewer와 Finisher는 중복 open PR을 merge 전 blocker로 처리한다.
- Recorder는 Reviewer PASS가 남긴 canonical PR head branch에만 KG commit을 추가한다.
