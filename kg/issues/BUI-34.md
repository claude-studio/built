---
id: BUI-34
title: "[Week 4+] Pipeline hooks 실행 엔진 구현 (before_do/after_do/after_check/after_report)"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-34
pr: https://github.com/claude-studio/built/pull/28
week: 4
tags: [hooks, pipeline, execution-engine, iter-integration]
keywords: [hooks, pipeline, execution, engine, before, after, 실행, 엔진, 구현]
---

## 목표

BUILT-DESIGN.md §9에 설계된 pipeline hooks 시스템을 실제 실행 가능하도록 구현.
hooks.json + hooks.local.json을 읽어 파이프라인 단계별로 command hook을 실행한다.

## 구현 내용

- src/hooks-runner.js 신규 생성
  - hooks.json + hooks.local.json 병합 (team 먼저 concat, local 뒤 concat, source 메타데이터 추가)
  - command 타입 hook 실행 (child_process.execSync)
  - timeout 적용, halt_on_fail 처리, capture_output 지원
  - condition 평가: feature.touches_auth, check.status 등 == 패턴 파싱
  - 환경변수 5개 주입: BUILT_HOOK_POINT, BUILT_FEATURE, BUILT_PREVIOUS_RESULT, BUILT_WORKTREE, BUILT_PROJECT_ROOT
- scripts/run.js 연동: before_do/after_do/after_check/after_report 4개 훅 포인트
- test/hooks-runner.test.js 신규 (25개 단위 테스트 전체 통과)

## 결정 사항

- iter 연동 방식: check-result.md를 단일 채널로 삼는 방식
  - before_do 실패 (halt_on_fail: true): Do 실행 건너뜀 + check-result.md 새로 생성(status: needs_changes) + issues[]에 [hook-failure] 주입 + 본문에 Hook 실패 내역 섹션 추가 → iter가 자연스럽게 루프 진입
  - after_check 실패 (halt_on_fail: true): check-result.md status를 approved여도 needs_changes로 강제 덮어씀 + issues[] 주입 → 파이프라인 중단 없이 iter 단계로 이어짐
  - halt_on_fail: false 실패: check-result.md issues[]에 [hook-warning] 접두어로만 기록 (status 유지)
  - 이유: iter는 check-result.md만 읽으므로 이를 단일 채널로 활용하면 별도 훅 결과 파일 불필요
- after_check 훅에 conditionContext로 check.status 전달해 condition 평가 가능

## 발생한 이슈

없음. 1회차 리뷰 통과.

## 완료 기준 충족 여부

1. src/hooks-runner.js 구현 — 완료
2. hooks.json + hooks.local.json 병합 (concat, source 메타데이터) — 완료
3. command hook 실행 (timeout, halt_on_fail, capture_output) — 완료
4. condition 평가 로직 — 완료 (== 패턴 지원)
5. 환경변수 5개 주입 — 완료
6. run.js에 before_do/after_do/after_check/after_report 4개 포인트 연동 — 완료
7. 외부 npm 패키지 없음 (child_process, fs, path, os만 사용) — 완료
8. 단위 테스트 25개 전체 통과 — 완료

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-34",
  "name": "[Week 4+] Pipeline hooks 실행 엔진 구현 (before_do/after_do/after_check/after_report)",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/28"},
  "actionStatus": "CompletedActionStatus"
}
```
