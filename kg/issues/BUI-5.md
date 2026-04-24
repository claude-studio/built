---
id: BUI-5
title: "[Week 1] [PoC-4] worktree 재진입 + claude -p 경로 일치 검증"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: poc-4
pr: https://github.com/claude-studio/built/pull/4
week: 1
tags: [poc, week1, worktree, reentry]
keywords: [worktree, 재진입, claude, 경로, 일치, 검증, poc, 세션]
---

## 목표

feature worktree 재진입 시 .worktreeinclude 파일이 자동 복사되고, claude -p 서브세션의 실행 경로가 worktree 내부와 일치하는지 검증한다. Week 2 pipeline-runner.js 구현 방향을 결정하기 위한 PoC.

## 구현 내용

- poc/poc-4-worktree-reentry.md 파일에 검증 결과 기록
- git worktree add <path> <branch> 재진입 방식 실측
- claude -p --worktree <기존명> 재진입 방식 실측
- .worktreeinclude 복사 동작 BUILT-DESIGN.md §12 대조
- claude -p 서브세션 실행 경로 일치 여부 확인

## 결정 사항

1. worktree 재진입 방식: git worktree add <path> <branch> 및 claude -p --worktree 양방향 모두 성공. --worktree 플래그 방식 권장.
2. Week 2 구현 방향: claude -p --worktree <feature-name> 플래그 기반 구현. 재진입 시 .worktreeinclude 수동 복사 step 명시적으로 추가 필요.

## 발생한 이슈

특이사항 없음. 1회차 리뷰 통과.

## 완료 기준 충족 여부

1. worktree 재진입 (git worktree add <path> <branch>) 동작 확인 - 충족
2. .worktreeinclude 복사 여부 확인 - 충족 (신규 생성 시 자동, 재진입 시 미복사 확인)
3. claude -p 서브세션 경로 일치 - 충족 (완전 일치)
4. 재진입 + 서브세션 경로 결론 - 충족 (Week 2 방향 결론 도출)
5. poc/poc-4-worktree-reentry.md 기록 - 충족

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-5",
  "name": "[Week 1] [PoC-4] worktree 재진입 + claude -p 경로 일치 검증",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/4"},
  "actionStatus": "CompletedActionStatus"
}
```
