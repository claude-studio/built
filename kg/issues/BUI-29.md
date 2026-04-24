---
id: BUI-29
title: "[Hotfix][Phase1] .claude-plugin/plugin.json 생성 및 플러그인 루트 구조 확립"
type: issue
date: 2026-04-24
status: completed
agent: CTO
branch: bui-29-plugin-json
pr: https://github.com/claude-studio/built/pull/11
week: 2
tags: [hotfix, phase1, plugin, plugin-json]
keywords: [plugin, json, 플러그인, 구조, 확립, hotfix, 생성]
---

## 목표

built 레포에 .claude-plugin/plugin.json이 없어 Claude Code 플러그인으로 로드 불가한 문제 수정.
BUILT-DESIGN.md §5 기준 플러그인 루트 구조 확립.

## 구현 내용

- `.claude-plugin/plugin.json` 생성 (name, description, author, version, repository, license 포함)
- `README.md` 로컬 개발 섹션 추가 (`--plugin-dir` 사용법 안내)

## 결정 사항

- plugin.json 위치: 레포 루트의 `.claude-plugin/plugin.json` (BUILT-DESIGN.md §5 기준)
- claude plugins validate 통과로 플러그인 인식 확인
- 기존 스크립트 수정 없이 파일 추가만으로 완료 (영향 최소화)

## 발생한 이슈

없음. 1회차 리뷰 통과.

## 완료 기준 충족 여부

1. .claude-plugin/plugin.json 존재 ✓
2. claude --plugin-dir <built-path> 로 /built:init 명령 인식 (claude plugins validate 통과) ✓
3. 기존 스크립트 동작 영향 없음 ✓

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-29",
  "name": "[Hotfix][Phase1] .claude-plugin/plugin.json 생성 및 플러그인 루트 구조 확립",
  "agent": {"@type": "SoftwareAgent", "name": "CTO"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/11"},
  "actionStatus": "CompletedActionStatus"
}
```
