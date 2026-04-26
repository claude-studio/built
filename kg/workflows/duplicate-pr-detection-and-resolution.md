---
id: WF-23
title: 중복 PR 감지와 canonical PR 정리 워크플로우
type: workflow
date: 2026-04-26
validated_by: [BUI-186]
tags: [ops, pr, duplicate-pr, canonical-pr, merge-gate]
---

## 패턴 설명

같은 Multica 이슈에서 open PR이 둘 이상 생기지 않도록 PR 생성, 리뷰, merge 직전에 같은 BUI 번호의
open PR을 확인하고 canonical PR이 불명확하면 정리 요청을 남기는 운영 절차.

## 언제 사용하나

- Builder가 새 PR을 만들기 전
- Reviewer가 PR diff를 PASS하기 전
- Recorder가 PR head branch에 KG commit을 추가하기 전
- Finisher가 merge gate를 통과시키기 전
- stale branch cleanup에서 PR/branch 소유 이슈를 확인할 때

## 절차

1. 이슈 identifier를 확인한다. 예: `BUI-186`.
2. `kg/issues/BUI-<N>.md`가 있으면 frontmatter의 `pr`와 `branch`를 canonical 후보로 읽는다.
3. GitHub에서 같은 BUI 번호의 open PR을 확인한다.

```bash
gh pr list --state open --search "BUI-<N> in:title" --json number,title,headRefName,url
```

4. 현재 작업 branch가 있으면 head branch 기준 open PR도 확인한다.

```bash
gh pr list --state open --head <branch> --json number,title,headRefName,url
```

5. open PR이 0개이면 Builder는 새 PR을 만들고 `kg/issues/BUI-<N>.md` mapping을 기록한다.
6. open PR이 1개이면 그 PR을 canonical으로 사용한다. Builder는 같은 branch에 추가 commit하고,
   Reviewer/Recorder/Finisher는 handoff comment와 mapping이 같은 PR을 가리키는지 확인한다.
7. open PR이 2개 이상이면 merge 또는 PASS를 중단한다. 한국어/KST 코멘트로 canonical 후보,
   중복 PR 목록, 각 head branch, 필요한 정리 조치를 남기고 Coordinator 판단을 요청한다.

## Builder 처리 기준

- 기존 open PR이 있으면 새 PR을 만들지 않는다.
- 기존 PR branch를 checkout/fetch할 수 없으면 새 PR 생성으로 우회하지 않고 blocker 코멘트를 남긴다.
- PR 제목은 `[BUI-<N>] <한글 요약>` 형식을 우선한다.
- branch는 가능한 한 `agent/builder/BUI-<N>-<slug>` 형식을 사용한다.

## Reviewer 처리 기준

- `kg/issues/BUI-<N>.md`의 `pr`와 실제 PR URL이 다르면 FAIL한다.
- 같은 BUI 번호의 open PR이 여러 개이면 PASS하지 않는다.
- FAIL 코멘트에는 canonical 후보와 중복 PR 번호/branch를 포함한다.

## Recorder 처리 기준

- Reviewer PASS가 남긴 canonical PR URL, head branch, head commit을 확인한다.
- canonical PR이 불명확하거나 open PR이 여러 개이면 KG 기록을 진행하지 않고 Coordinator 판단 요청
  코멘트를 남긴다.
- KG 기록은 별도 PR을 만들지 않고 canonical PR head branch에 추가 commit한다.

## Finisher 처리 기준

- merge 전 `scripts/check-pr-merge-ready.js --issue BUI-<N> --pr <PR_NUMBER>` 또는 동등한 수동
  확인으로 같은 BUI 번호의 open PR이 1개인지 확인한다.
- 중복 PR 또는 canonical 불명확 상태에서는 merge하지 않는다.
- 정리 요청 코멘트는 다음 역할이 raw execution log를 보지 않아도 판단할 수 있게 자급자족해야 한다.

## 실패 시 복구

- canonical PR이 명확하면 non-canonical PR에 superseded 코멘트를 남기고 닫는다.
- canonical PR이 명확하지 않으면 Coordinator가 최신 handoff, `kg/issues/` mapping, PR head commit을
  비교해 하나를 선택하거나 Builder에게 통합을 요청한다.
- PR 제목에 BUI 번호가 없어서 검색되지 않는 경우에는 제목 또는 mapping 정정을 먼저 요청한다.

## 완료 기준

- 같은 BUI 번호의 open PR이 정확히 1개다.
- `kg/issues/BUI-<N>.md`의 `pr`와 `branch`가 실제 canonical PR과 일치한다.
- handoff comment에 PR URL, branch, head commit, 테스트, 남은 blocker가 포함된다.
