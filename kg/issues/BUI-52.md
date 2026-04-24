---
id: BUI-52
title: "[Ops] /built:cleanup 스킬 구현 — 완료된 feature worktree 정리"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-52
pr: https://github.com/claude-studio/built/pull/40
week: 1
tags: [ops, cleanup, worktree, skill]
keywords: [cleanup, worktree, registry, archive, skill, feature, 정리, 자동화]
---

## 목표

완료(done)된 feature의 git worktree와 .built/features/<feature>/ 산출물을 자동으로 정리하는 /built:cleanup 스킬 구현.
수동으로만 가능하던 고아 worktree 정리를 자동화.

## 구현 내용

- scripts/cleanup.js 신규 구현
  - git worktree remove .claude/worktrees/<feature> --force 실행
  - registry.json에서 해당 feature unregister
  - --archive 플래그: .built/features/<feature>/ → .built/archive/<feature>/ 이동
  - --all 플래그: done/aborted 상태 feature 전체 일괄 정리 (registry + runs/ 디렉토리 이중 탐지)
  - running 상태 feature 정리 거부 안전 장치
- skills/cleanup/SKILL.md 작성
- test/cleanup.test.js: 17개 단위 테스트 전체 통과
- 외부 npm 패키지 없음

## 결정 사항

- archive 방식을 config 선택 가능하게 설계 (--archive 플래그)
  - 삭제보다 아카이빙이 안전하므로 기본값은 삭제, 명시적 플래그로 아카이빙 선택
- running 상태 체크는 state.json status 필드 기준
  - BUILT-DESIGN.md §5 스키마 준수

## 발생한 이슈

없음 (1회차 리뷰 통과)

## 완료 기준 충족 여부

- [x] scripts/cleanup.js 구현 (worktree 제거 + registry 정리 + optional 아카이빙)
- [x] /built:cleanup <feature> 단일 정리, --all 일괄 정리 지원
- [x] running 상태 feature 정리 거부
- [x] skills/cleanup/SKILL.md 작성
- [x] 단위 테스트 17개 전체 통과
- [x] 외부 npm 패키지 없음

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-52",
  "name": "[Ops] /built:cleanup 스킬 구현 — 완료된 feature worktree 정리",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/40"},
  "actionStatus": "CompletedActionStatus"
}
```
