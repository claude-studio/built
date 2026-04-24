---
id: BUI-11
title: "[Week 2] [Phase1] /built:init 스킬 구현"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-11-init-skill
pr: https://github.com/claude-studio/built/pull/10
week: 2
tags: [phase1, init, skill, bootstrap]
keywords: [init, skill, 스킬, bootstrap, 구현, 초기화, config, hooks]
---

## 목표

.built/, .claude/ 기본 구조 준비. context.md, config.json, hooks.json 초기 생성. 최초 1회 bootstrap 구현 (/built:init 스킬).

## 구현 내용

- `skills/init/SKILL.md`: Claude Code 스킬 파일 (실행 진입점)
- `scripts/init.js`: Node.js 헬퍼 스크립트
  - .built/ 디렉토리 및 6개 서브디렉토리 생성
  - .built/context.md, config.json, hooks.json, features-index.md 초기 파일 생성
  - .gitignore에 .built/runtime/, .built/config.local.json 항목 추가
  - 멱등성: config.json 존재 시 skip + 안내 메시지
- `test/init.test.js`: 단위 테스트 23개

## 결정 사항

- 스킬 파일 경로: `skills/init/SKILL.md` (BUILT-DESIGN.md §5 준수)
- 스크립트 경로: `scripts/init.js` (기존 레포 구조 scripts/ 맞춤)
- SKILL.md에서 스크립트 참조: BASH_SOURCE[0] 기반 동적 상대 경로 (`../../scripts/init.js`) 사용
  - 이유: 특정 사용자 홈 경로 하드코딩 금지 (BUILT-DESIGN.md §4 원칙)

## 발생한 이슈

1회차 리뷰 반려:
- 스킬 파일 경로 오류: .claude/skills/init.md → skills/init/SKILL.md 수정
- 스크립트 경로 오류: src/init.js → scripts/init.js 수정
- SKILL.md 하드코딩 홈 경로 제거 → BASH_SOURCE[0] 기반 동적 상대 경로로 교체

2회차 리뷰 통과.

## 완료 기준 충족 여부

1. /built:init 실행 시 .built/ 디렉토리 구조 생성 ✓
2. .built/context.md, config.json, hooks.json 초기 파일 생성 ✓
3. 멱등성 보장 (config.json 존재 시 skip) ✓
4. 외부 npm 패키지 없음 ✓
5. 스킬 파일 + 헬퍼 스크립트 포함 ✓
6. 단위 테스트 23개 통과 ✓

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-11",
  "name": "[Week 2] [Phase1] /built:init 스킬 구현",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/10"},
  "actionStatus": "CompletedActionStatus"
}
```
