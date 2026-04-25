---
id: BUI-72
title: "[Bugfix] run.test.js 모듈 경로 패칭 오류 수정 — 15개 테스트 실패"
type: issue
date: 2026-04-25
status: completed
agent: 개발
branch: bui-72
pr: https://github.com/claude-studio/built/pull/47
week: 3
tags: [bugfix, test, module-path]
keywords: [run test 모듈 경로 패칭 임시디렉토리 setupFakeScripts 절대경로 regex]
---

## 목표

npm test 실행 시 run.test.js 전체 실패 해결. 임시 디렉토리에서 run-patched.js 실행 시 src/ 모듈 require가 실패하는 문제.

## 구현 내용

- `setupFakeScripts`에서 단일 regex(`/path\.join\(__dirname, '\.\.', 'src', '([^']+)'\)/g`)로 src/ 모듈 경로 전체를 절대경로로 교체
- 기존에는 `src/state`만 절대경로 교체하고 `src/hooks-runner`, `src/registry`, `src/frontmatter`는 그대로 두어 임시 디렉토리에서 MODULE_NOT_FOUND 발생
- `/g` 플래그로 파일 내 모든 매칭을 한 번에 교체

## 결정 사항

- 환경변수 인젝션 방식 대신 regex 기반 경로 교체 방식 유지. 기존 패칭 패턴과 일관성 유지, 최소 변경으로 수정 가능.

## 발생한 이슈

없음 (1회 리뷰 통과)

## 완료 기준 충족 여부

- run.test.js 22개 테스트 전부 통과 ✓
- 기존 단위 테스트 56개 영향 없음 ✓
- E2E 3개 시나리오 통과 ✓

## 재발 방지 포인트

- setupFakeScripts에서 경로를 교체할 때 모든 src/ 모듈을 빠짐없이 교체해야 함. 모듈 추가 시 패턴이 자동으로 커버되는지 확인 필요.
- 임시 디렉토리에 복사된 스크립트는 `__dirname`이 달라지므로 모든 상대 경로 require는 절대경로로 변환해야 함.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-72",
  "name": "[Bugfix] run.test.js 모듈 경로 패칭 오류 수정 — 15개 테스트 실패",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/47"},
  "actionStatus": "CompletedActionStatus"
}
```
