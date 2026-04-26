---
id: WF-20
title: Claude Code plugin packaging smoke 검증 워크플로우
type: workflow
date: 2026-04-26
validated_by: [BUI-177]
tags: [plugin, packaging, smoke, skills, provider, validation]
---

## 패턴 설명

Claude Code plugin package는 repository-root와 `--plugin-dir` 설치 경로에서 같은 scripts, skills, src를 참조해야 한다.
plugin metadata, symlink, skill 문서의 script 참조, provider 관련 helper와 문서를 함께 확인해 사용자 설치 후 경로 오류를 release 전에 발견한다.

## 언제 사용하나

- `.claude-plugin/plugin.json` 또는 `plugins/built/.claude-plugin/plugin.json`을 바꿀 때
- `plugins/built`의 symlink 구조를 바꿀 때
- `skills/*/SKILL.md`에서 `scripts/` helper 호출 방법을 추가하거나 수정할 때
- provider doctor, preset, compare, smoke 관련 script나 문서를 추가하거나 이름을 바꿀 때
- README의 사용자 설치 또는 `npm run` 명령을 수정할 때
- marketplace publish 전 package 누락 여부를 확인할 때

## 단계

1. 루트 `.claude-plugin/plugin.json`에 `name`, `version`, `description`이 있는지 확인한다.
2. `plugins/built/.claude-plugin/plugin.json`에 plugin 이름과 skills 경로가 있고, 해당 경로가 실제 `skills/` 디렉토리로 해석되는지 확인한다.
3. `plugins/built/scripts`, `plugins/built/skills`, `plugins/built/src`가 루트 `scripts/`, `skills/`, `src/`를 가리키는 심볼릭 링크인지 확인한다.
4. 모든 `skills/*/SKILL.md`에서 `../../scripts/<name>.js` 또는 `node scripts/<name>.js`로 참조한 script가 실제 `scripts/` 아래에 존재하는지 확인한다.
5. provider 관련 필수 skill인 `doctor`, `run`, `run-opus`, `run-sonnet`, `run-codex-do`가 package에 포함되어 있는지 확인한다.
6. provider 관련 필수 script인 `provider-doctor.js`, `provider-preset.js`, `compare-providers.js`, `smoke-compare-providers.js`, `smoke-codex-do.js`, `smoke-codex-plan-synthesis.js`가 존재하는지 확인한다.
7. provider 기준 문서인 `docs/contracts/provider-config.md`, `docs/contracts/provider-events.md`, `docs/contracts/file-contracts.md`, `docs/ops/provider-setup-guide.md`, `docs/smoke-testing.md`가 존재하는지 확인한다.
8. `plugins/built/scripts`와 루트 `scripts`, `plugins/built/skills`와 루트 `skills`의 파일 또는 디렉토리 목록이 동등한지 확인한다.
9. README에서 참조한 `npm run`/`npm test` 명령이 `package.json` scripts에 존재하는지 확인한다.
10. 변경 후 `node test/plugin-packaging.test.js` 또는 전체 `npm test`를 실행한다.

## 주의사항

- plugin packaging smoke는 실제 marketplace publish 자동화를 대체하지 않는다.
- 새 provider helper를 추가하면서 packaging smoke의 필수 provider script 목록을 갱신하지 않으면 사용자 설치 package 누락을 놓칠 수 있다.
- skill 문서에 raw absolute path나 개인 worktree 경로를 남기지 않는다.
- secret, token, private environment value, raw execution dump는 skill 문서와 KG 기록에 포함하지 않는다.
- `plugins/built` symlink를 일반 디렉토리 복사본으로 바꾸면 repository-root와 plugin-dir 사이의 drift가 커질 수 있으므로 별도 packaging 결정이 필요하다.
