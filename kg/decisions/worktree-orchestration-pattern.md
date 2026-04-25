---
id: ADR-2
title: execution worktree 생성 방식 — git worktree add vs claude -p --worktree
type: decision
date: 2026-04-25
status: accepted
context_issue: BUI-75
tags: [architecture, worktree, orchestration, run.js, pipeline]
---

## 컨텍스트

BUI-75 PoC에서 execution worktree 생성 방식을 두 가지 중 선택해야 했다:

1. `claude -p --worktree <feature-runner>`: Claude Code 공식 기능, 대화형 worktree 세션 생성
2. `git worktree add .claude/worktrees/<feature>-runner -b <branch>`: git 직접 제어

BUILT-DESIGN.md §8.2-b는 `claude --bare -p --worktree <feature-runner>`를 명시하지만,
실측에서 `--bare`가 OAuth 인증을 지원하지 않는 문제가 발견되었다.

## 결정

**오케스트레이터(run.js)에서는 `git -C <projectRoot> worktree add`를 직접 사용한다.**

`claude -p --worktree`는 사용자가 대화형으로 execution worktree를 여는 용도로 남긴다.

## 근거

| 항목 | `claude -p --worktree` | `git worktree add` |
|------|----------------------|-------------------|
| 브랜치 네이밍 | `worktree-<name>` prefix 강제 | 자유롭게 제어 가능 |
| 인증 의존 | OAuth 세션 필요 (--bare 불가) | 없음 |
| Multica 에이전트 환경 | OAuth 없이 실행되는 경우 실패 | 항상 동작 |
| 스크립트 제어 | 어렵 (claude 세션 내부 동작) | 단순 CLI, programmatic 제어 용이 |
| ADR-1 제약 | CWD가 git root여야 함 | -C 플래그로 어디서나 실행 가능 |

`--bare` 모드는 `ANTHROPIC_API_KEY`만 허용하며 OAuth/keychain을 읽지 않는다.
현재 built 환경(OAuth 인증)에서 `--bare`를 쓰면 "Not logged in" 오류가 발생한다.

## 결과

- `run.js`는 `childProcess.execSync('git -C <root> worktree add ...')` 방식 사용
- 브랜치 네이밍: `worktree-<feature>` (git worktree add -b worktree-<feature>)
- 환경변수 주입 패턴:
  - `BUILT_RUNTIME_ROOT`: 원본 레포의 `.built/runtime/` 절대경로 (canonical 상태 경로)
  - `BUILT_WORKTREE`: 생성된 worktree 절대경로 (결과 문서 저장 경로)
- 결과 문서 위치: `<worktree>/.built/runs/<feature>/*.md`
- state.json / run-request.json은 `BUILT_RUNTIME_ROOT` 하위 유지 (canonical 불변)

## 경로 분리 계약

```
원본 레포/.built/runtime/runs/<feature>/
  state.json          ← orchestrator SSOT (run.js, state.js 전담)
  run-request.json    ← handoff (plan → run)

.claude/worktrees/<feature>-runner/.built/runs/<feature>/
  do-result.md        ← Do phase 산출물 (git diff 대상)
  check-result.md     ← Check phase 산출물
  iter-result.md      ← Iter phase 산출물 (선택)
  report.md           ← Report phase 산출물
```

## 대안

- `claude -p --worktree` 유지: ANTHROPIC_API_KEY 환경 강제 필요 → Multica 에이전트 환경에서 불안정
- `--bare` 없이 `claude -p --worktree`: 브랜치 네이밍 비제어, 스크립트 통합 복잡도 증가

## MVP 영향

- `BUILT_WORKTREE` 미설정 시 기존 `.built/features/<feature>/` 경로로 폴백 → 기존 MVP 동작 유지
- 점진적 도입 가능 (opt-in 환경변수 방식)
