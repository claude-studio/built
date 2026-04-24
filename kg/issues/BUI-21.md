---
id: BUI-21
title: "[Week 4] [Phase3] Sanitize + pre-commit hook 구현"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-21-sanitize-hooks
pr: https://github.com/claude-studio/built/pull/22
week: 4
tags: [phase3, sanitize, security, pre-commit]
---

## 목표

산출물(.built/runs/) 내 민감 정보를 자동 마스킹하는 sanitize 스크립트 구현 및 git pre-commit hook 안전망 설치.

## 구현 내용

- scripts/sanitize.js: 홈 경로(/Users/xxx → ~/), API 키(sk-ant-*, ghp_*), session_id, 환경변수(SAFE_KEYS 외) 마스킹. frontmatter와 본문 양쪽 적용. 외부 npm 패키지 없음(fs/path/os만 사용).
- scripts/install-hooks.js: git pre-commit hook 설치/제거 스크립트. staged .built/runs/ 파일만 필터링 후 re-stage 처리.
- skills/sanitize/SKILL.md: /built:sanitize 트리거 정의.
- test/sanitize.test.js: 단위 테스트 46개 전부 통과 (홈 경로 치환, API 키 마스킹, JSON 처리, 없는 경로 처리).

## 결정 사항

- 외부 deps 0 원칙 유지 — Node.js 내장 모듈(fs, path, os)만 사용.
- pre-commit hook은 .husky 대신 install-hooks.js 스크립트 방식 채택 — husky 의존성 없이 동작.
- SAFE_KEYS 패턴으로 마스킹 예외 환경변수 관리.

## 발생한 이슈

없음. 1회차 리뷰 통과.

## 완료 기준 충족 여부

1. scripts/sanitize.js 구현 — 충족
2. pre-commit hook 설치 스크립트 — 충족 (install-hooks.js)
3. skills/sanitize/SKILL.md 작성 — 충족
4. 단위 테스트 46개 통과 — 충족

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-21",
  "name": "[Week 4] [Phase3] Sanitize + pre-commit hook 구현",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/22"},
  "actionStatus": "CompletedActionStatus"
}
```
