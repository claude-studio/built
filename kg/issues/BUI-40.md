---
id: BUI-40
title: "[Marketplace] built 플러그인 마켓플레이스 배포 구조 준비"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-40
pr: https://github.com/claude-studio/built/pull/38
week: 4
tags: [marketplace, deployment, plugin, onboarding]
---

## 목표

BUILT-DESIGN.md §13에 설계된 marketplace 배포 구조를 준비. 로컬 --plugin-dir 개발 환경을 넘어 팀 배포를 위한 marketplace 구조 구축.

## 구현 내용

- `.claude-plugin/marketplace.json` 생성 — §13 스펙 준수, built/built-quality/built-notify 3개 플러그인 등록
- `plugins/built/` 디렉토리 — plugin.json + skills/scripts/src 심볼릭 링크 구조
- `plugins/built-quality/` 스텁 — lint-fix, type-check 훅 번들
- `plugins/built-notify/` 스텁 — notify 훅
- `.claude/settings.json` 팀 배포 예시 — extraKnownMarketplaces + enabledPlugins 설정
- `README.md` 온보딩 가이드 보강 — init/plan/run/status 플로우 + marketplace 구조 + 설치 가이드 (부록 A 반영)

## 결정 사항

현 레포 내 별도 디렉토리(`plugins/`) 구조를 선택. 별도 레포 분리는 팀 규모 확장 시 검토.

## 발생한 이슈

없음. 1회차 리뷰 통과.

## 완료 기준 충족 여부

1. marketplace.json 구조 생성 (§13 스펙 준수) — 충족
2. plugins/ 디렉토리 구조 정비 — 충족
3. .claude/settings.json 팀 배포 설정 예시 추가 — 충족
4. README.md 팀 온보딩 가이드 보강 — 충족

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-40",
  "name": "[Marketplace] built 플러그인 마켓플레이스 배포 구조 준비",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/38"},
  "actionStatus": "CompletedActionStatus"
}
```
