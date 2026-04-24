---
id: ADR-1
title: EnterWorktree는 git 레포 루트 CWD에서만 동작
type: decision
date: 2026-04-24
status: accepted
context_issue: BUI-2
tags: [architecture, enterworktree, worktree, constraint]
---

## 컨텍스트

PoC-1(BUI-2)에서 EnterWorktree 도구를 Multica 에이전트 workdir에서 호출했을 때
worktree 컨텍스트 전환이 이루어지지 않음을 발견했다.

## 결정

/built:plan 스킬은 반드시 git 레포 루트 (~/Desktop/jb/built)에서 실행된 Claude 세션에서만
EnterWorktree를 호출한다. SKILL.md에 이 전제조건을 명시한다.

## 근거

EnterWorktree는 Claude Code의 공식 기능으로, 현재 세션의 CWD를 기준으로 git worktree를
탐색하고 전환한다. CWD가 git 레포 루트가 아니면 도구가 정상 동작하지 않는다.

## 결과

- /built:plan, /built:run 스킬은 레포 루트에서 실행되어야 한다는 제약이 생김
- 사용자 가이드에 이 전제조건 명시 필요
- Multica 에이전트 자체는 worktree 작업 시 git CLI를 직접 사용해야 함

## 대안

- multica daemon의 workdir를 레포 루트로 설정하는 방안 (설정 복잡도 증가로 기각)
- git worktree를 EnterWorktree 없이 직접 관리하는 방안 (현재 에이전트 팀은 이 방식 사용 중)
