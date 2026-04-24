---
id: BUI-55
title: "[Config] config.local.json worktree_location override 지원 (§11 에디터 성능)"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-55
pr: https://github.com/claude-studio/built/pull/45
week: 1
tags: [config, editor-performance, worktree]
keywords: [config, worktree, location, sibling, vscode, validate, editor, 성능]
---

## 목표

BUILT-DESIGN.md §11 에디터 성능 대응 기능 구현.
`.built/runtime/worktrees/`가 git 레포 내부에 있으면 VSCode/JetBrains가 버벅이는 문제를 해결하기 위해 `config.local.json`의 `worktree_location: sibling` 설정으로 레포 바깥 sibling 디렉토리에 worktree를 생성할 수 있도록 지원.

## 구현 내용

- `scripts/init.js`: `config.local.json.example` 생성 시 `worktree_location` 필드 예시 추가
- `src/registry.js`: `getWorktreePath()` 헬퍼 함수 추가
  - `default`: `.claude/worktrees/<feature>` (기존 동작 유지)
  - `sibling`: `../<project-name>-worktrees/<feature>` (레포 상위 디렉토리)
- `scripts/run.js`: worktree 경로 등록 시 `getWorktreePath()` 사용
- `scripts/validate.js`: `worktree_location` 값 검증 추가 (`'default' | 'sibling'`), `KNOWN_KEYS`에 등록
- `.vscode/settings.json`: 신규 파일 추가 (§11 권장 설정: `files.watcherExclude`, `search.exclude`, `files.exclude`, tsserver 메모리, `git.scanRepositories`)
- 단위 테스트: `validate.test.js` 5개, `init.test.js` 2개, `registry.test.js` 6개 — 전체 13개 통과

## 결정 사항

- `getWorktreePath()`를 `registry.js`에 위치시킴: worktree 경로 계산 로직이 registry의 책임 범위에 속하며, run.js가 이를 소비하는 구조가 자연스러움
- sibling 경로 패턴을 `../<project-name>-worktrees/<feature>`로 결정: 프로젝트명을 접두사로 붙여 다른 레포의 worktree와 충돌 방지

## 발생한 이슈

없음. 1회차 리뷰에서 바로 통과.

## 완료 기준 충족 여부

- [x] config.local.json worktree_location 필드 지원 (default | sibling)
- [x] validate.js에서 값 검증
- [x] .vscode/settings.json 기본 파일 추가
- [x] 외부 npm 패키지 없음
- [x] 단위 테스트 포함 (13개 전 통과)

## 재발 방지 포인트

- `KNOWN_KEYS`에 신규 config 키를 등록하지 않으면 validate.js가 unknown key 경고를 발생시킴 — 신규 config 필드 추가 시 반드시 KNOWN_KEYS 업데이트 필요
- sibling 모드에서 레포 루트 외부 경로를 사용하므로 git worktree add 시 경로 생성 순서 주의

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-55",
  "name": "[Config] config.local.json worktree_location override 지원 (§11 에디터 성능)",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/45"},
  "actionStatus": "CompletedActionStatus"
}
```
