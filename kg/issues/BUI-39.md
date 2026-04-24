---
id: BUI-39
title: "[Week 4+] E2E 통합 테스트 시나리오 구현 (/built:plan → /built:run 전체 플로우)"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-39
pr: https://github.com/claude-studio/built/pull/37
week: 4
tags: [e2e, testing, integration, week3-criteria]
---

## 목표

개별 스크립트 단위 테스트는 충분히 구현됐으나, 전체 파이프라인의 실제 동작을 검증하는 E2E 시나리오가 없었음. Week 3 안정화 성공 기준('20개 feature + 실패 복구 시나리오')을 충족하기 위해 실제 claude 호출 없이 mock 기반으로 전체 흐름을 시뮬레이션하는 E2E 테스트 구현.

## 구현 내용

- test/e2e/ 디렉토리 신설
- 3개 시나리오 파일, 14개 테스트 케이스 구현:
  - 01-happy-path.js: init→plan→run 전체 플로우 + 산출물 파일 존재 확인 (3케이스)
  - 02-iter-path.js: approved 즉시 종료 / needs_changes→iter→approved / BUILT_MAX_ITER=1 초과 (3케이스)
  - 03-abort-resume.js: abort→aborted / resume→planned / 복구 플로우 / max_iter failed (8케이스)
- package.json test 스크립트 업데이트
- scripts/run-tests.js 추가 (기존 단위 테스트 + E2E 통합 실행)
- fake 스크립트 주입 방식으로 실제 claude 호출 없이 mock 기반 시뮬레이션

## 결정 사항

- fake scripts 주입 방식 채택: 실제 pipeline-runner를 대체하는 mock 스크립트를 환경변수로 주입하여 외부 의존성 없이 전체 흐름 검증
- NO_NOTIFY=1 환경변수로 CI 환경(비대화형) 지원
- Node.js 내장 모듈만 사용 (fs, os, path, child_process, assert) — 외부 deps 0 원칙 유지

## 발생한 이슈

없음. 1회차 리뷰 통과.

## 완료 기준 충족 여부

1. test/e2e/ 디렉토리 신설, 최소 3개 시나리오 구현 → 충족 (14개 케이스)
2. npm test로 기존 단위 테스트와 함께 실행 가능 → 충족
3. CI 환경(NO_NOTIFY=1, 비대화형)에서도 통과 → 충족
4. 실제 claude 호출 없이 mock 기반 → 충족
5. 외부 npm 패키지 없음 → 충족

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-39",
  "name": "[Week 4+] E2E 통합 테스트 시나리오 구현 (/built:plan → /built:run 전체 플로우)",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/37"},
  "actionStatus": "CompletedActionStatus"
}
```
