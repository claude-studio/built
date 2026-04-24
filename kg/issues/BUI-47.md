---
id: BUI-47
title: "[Hooks] 전체 파이프라인 before/after 훅 결과의 다음 단계 전달 계약"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-47
pr: https://github.com/claude-studio/built/pull/29
week: 4
tags: [hooks, pipeline, before_check, before_report]
---

## 목표

scripts/run.js에 before_check/before_report 훅 포인트를 추가하여 전체 파이프라인 6개 훅 포인트(before_do/after_do/before_check/after_check/before_report/after_report)를 완성한다. BUI-34에서 구현된 hooks-runner.js를 활용하며 신규 코드만 최소한으로 추가.

## 구현 내용

- scripts/run.js에 before_check 훅 포인트 추가 (Check 실행 직전)
  - halt_on_fail: true → Check 단계 건너뜀, check-result.md를 needs_changes로 강제 생성 후 iter 진입
  - halt_on_fail: false → [hook-warning] 기록 후 Check 진행
- scripts/run.js에 before_report 훅 포인트 추가 (Report 실행 직전)
  - halt_on_fail: true → Report 단계 건너뜀, state failed 처리
  - halt_on_fail: false → 경고 기록 후 Report 진행
- 환경변수 주입 패턴을 기존 before_do/after_check와 동일하게 적용 (hookBase spread)
- 외부 npm 패키지 없음
- 기존 25개 테스트 전부 통과 + before_check/before_report 케이스 6개 추가 (총 31개 통과)

## 결정 사항

- before_check/before_report의 환경변수 주입 패턴을 기존 before_do/after_check와 동일하게 통일 (hookBase spread)하여 일관성 유지
- HOOK_POINTS 배열 업데이트로 훅 포인트 목록 관리 일원화

## 발생한 이슈

없음. 1회차 리뷰 통과.

## 완료 기준 충족 여부

1. before_check 훅 포인트 추가 (Check 실행 직전) - 충족
2. before_report 훅 포인트 추가 (Report 실행 직전) - 충족
3. 환경변수 주입 패턴 기존과 동일 - 충족
4. 외부 npm 패키지 없음 - 충족
5. 기존 테스트 25개 전부 통과 + 신규 6개 추가 (총 31개) - 충족

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-47",
  "name": "[Hooks] 전체 파이프라인 before/after 훅 결과의 다음 단계 전달 계약",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/29"},
  "actionStatus": "CompletedActionStatus"
}
```
