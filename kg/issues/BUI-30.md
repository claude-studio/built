---
id: BUI-30
title: "[Hotfix][Phase1] .claude/skills/plan.md → skills/plan/SKILL.md 플러그인 구조로 이전"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-30
pr: https://github.com/claude-studio/built/pull/12
week: 2
tags: [hotfix, phase1, skill, plugin, plan]
---

## 목표

plan 스킬이 프로젝트 레벨(.claude/skills/plan.md)에 위치해 Claude Code 플러그인 구조와 불일치.
skills/<name>/SKILL.md 구조로 이전하여 --plugin-dir로 인식 가능하도록 수정.

## 구현 내용

- `skills/plan/SKILL.md` 생성 (기존 .claude/skills/plan.md 내용 + 올바른 frontmatter)
- `skills/init/SKILL.md` frontmatter 형식 통일 (name, description, user-invocable, allowed-tools)
- `.claude/skills/plan.md` 삭제

## 결정 사항

- skills/<name>/SKILL.md 구조가 Claude Code 플러그인 표준 (BUILT-DESIGN.md §5)
- 두 스킬 모두 동일한 frontmatter 형식 적용으로 일관성 확보

## 발생한 이슈

리뷰 에이전트 오인 반려: 리뷰 에이전트가 main 워킹 디렉토리의 uncommitted 상태를 보고 반려했으나,
실제로는 bui-30 worktree에서 정상 커밋/PR/머지가 완료된 상태였음.
CTO가 PR #12 머지 확인 후 done으로 복구.

## 완료 기준 충족 여부

1. skills/plan/SKILL.md 존재 및 올바른 frontmatter ✓
2. .claude/skills/plan.md 삭제됨 ✓
3. /built:plan 명령 플러그인 로드 시 정상 동작 ✓

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-30",
  "name": "[Hotfix][Phase1] .claude/skills/plan.md → skills/plan/SKILL.md 플러그인 구조로 이전",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/12"},
  "actionStatus": "CompletedActionStatus"
}
```
