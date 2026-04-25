---
id: BUI-75
title: "[Next Step] claude -p --worktree 기반 execution worktree 재사용 PoC"
type: issue
date: 2026-04-25
status: completed
agent: 개발
branch: bui-75
pr: https://github.com/claude-studio/built/pull/57
week: 4
tags: [poc, worktree, execution, pipeline, next-step]
keywords: [worktree, claude -p --worktree, execution worktree, BUILT_RUNTIME_ROOT, BUILT_WORKTREE, git worktree, pipeline-runner, run.js]
---

## 목표

`claude -p --worktree` 기반 execution worktree 재사용 가능성 검증 및 통합 계획 수립.

## 검증 결과

- `claude -p --worktree <name>`: worktree 생성 확인됨, 브랜치는 `worktree-<name>` prefix 자동 부여
- `--bare` 모드: OAuth 인증 불가 (ANTHROPIC_API_KEY만 허용) → 현재 환경에서 사용 불가
- `.worktreeinclude` 파일 자동 복사 확인 (config.test.local, .env.test.local)
- 경로 분리 패턴 검증: BUILT_RUNTIME_ROOT (canonical) + BUILT_WORKTREE (결과 문서) 조합
- Do → Check → Iter → Report 동일 worktree 누적 저장 패턴 검증 완료

## 결정 사항

- 오케스트레이터(run.js)에서는 `git worktree add` 직접 사용 (ADR-2)
- `claude -p --worktree`는 대화형 사용자 세션용으로 구분
- `BUILT_RUNTIME_ROOT`, `BUILT_WORKTREE` 환경변수로 경로 주입
- MVP 폴백 유지: 환경변수 미설정 시 기존 경로 사용

## 산출물

- `docs/poc-worktree-reuse.md`: 검증 결과 문서
- `kg/decisions/worktree-orchestration-pattern.md`: ADR-2 결정 사항

## 완료 기준 충족 여부

- [x] claude --bare -p --worktree로 worktree 생성 가능 여부 검증 (가능, --bare 제약 발견)
- [x] 같은 worktree를 Do → Check → Iter → Report에 걸쳐 재사용 가능한지 검증
- [x] .built/runtime/runs/<feature>/ canonical 상태 경로 유지하면서 결과 문서를 worktree에 저장하는 패턴 확인
- [x] PoC 검증 결과 문서 작성 (docs/poc-worktree-reuse.md)
- [x] 통합 방향 결정 사항 kg/decisions/ 기록 (ADR-2)
- [x] 기존 MVP 경로 영향 없음 (환경변수 opt-in 방식)

## 재발 방지 포인트

- `claude --bare`는 OAuth를 사용하지 않는다. Multica 에이전트 환경에서 `--bare` 사용 시 인증 실패한다.
- `claude -p --worktree <name>`의 브랜치는 `worktree-<name>`으로 자동 생성된다 (prefix 강제).

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-75",
  "name": "[Next Step] claude -p --worktree 기반 execution worktree 재사용 PoC",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "actionStatus": "CompletedActionStatus"
}
```
