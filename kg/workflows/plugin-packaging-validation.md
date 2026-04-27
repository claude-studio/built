---
id: WF-20
title: Claude Code plugin packaging smoke 검증 워크플로우
type: workflow
date: 2026-04-26
validated_by: [BUI-177, BUI-217, BUI-344]
tags: [plugin, packaging, smoke, skills, provider, validation]
---

## 패턴 설명

Claude Code plugin package는 repository-root와 `--plugin-dir` 설치 경로에서 같은 scripts, skills, src를 참조해야 한다.
skill 실행 시 target project cwd와 plugin install path는 분리되므로, skill 문서와 packaging smoke는 `BUILT_PLUGIN_DIR` 기반 helper 호출이 설치 package에서도 동작하는지 확인한다.
plugin metadata, symlink, skill 문서의 script 참조, provider 관련 helper와 문서를 함께 확인해 사용자 설치 후 경로 오류를 release 전에 발견한다.

## 언제 사용하나

- `.claude-plugin/plugin.json` 또는 `plugins/built/.claude-plugin/plugin.json`을 바꿀 때
- `plugins/built`의 symlink 구조를 바꿀 때
- `skills/*/SKILL.md`에서 `scripts/` 또는 `src/` helper 호출 방법을 추가하거나 수정할 때
- provider doctor, preset, compare, smoke 관련 script나 문서를 추가하거나 이름을 바꿀 때
- README의 사용자 설치 또는 `npm run` 명령을 수정할 때
- marketplace publish 전 package 누락 여부를 확인할 때

## 단계

1. 루트 `.claude-plugin/plugin.json`에 `name`, `version`, `description`이 있는지 확인한다.
2. `plugins/built/.claude-plugin/plugin.json`에 plugin 이름과 skills 경로가 있고, 해당 경로가 실제 `skills/` 디렉토리로 해석되는지 확인한다.
3. `plugins/built/scripts`, `plugins/built/skills`, `plugins/built/src`가 루트 `scripts/`, `skills/`, `src/`를 가리키는 심볼릭 링크인지 확인한다.
4. Plan, Run, Do, Check, Init, Status, Doctor 및 provider preset skill 문서가 target project cwd 상대 `scripts/`/`src/` 호출 대신 `BUILT_PLUGIN_DIR` 기반 `SCRIPT_DIR`/`SRC_DIR` 또는 `process.env.BUILT_PLUGIN_DIR` 호출을 사용하는지 확인한다.
5. provider 관련 필수 skill인 `doctor`, `run`, `run-opus`, `run-sonnet`, `run-codex`가 package에 포함되어 있는지 확인한다.
6. provider 관련 필수 script인 `provider-doctor.js`, `provider-preset.js`, `compare-providers.js`, `smoke-compare-providers.js`, `smoke-codex-do.js`, `smoke-codex-plan-synthesis.js`가 존재하는지 확인한다.
7. provider 기준 문서인 `docs/contracts/provider-config.md`, `docs/contracts/provider-events.md`, `docs/contracts/file-contracts.md`, `docs/ops/provider-setup-guide.md`, `docs/smoke-testing.md`가 존재하는지 확인한다.
8. `plugins/built/scripts`와 루트 `scripts`, `plugins/built/skills`와 루트 `skills`의 파일 또는 디렉토리 목록이 동등한지 확인한다.
9. README에서 참조한 `npm run`/`npm test` 명령이 `package.json` scripts에 존재하는지 확인한다.
10. marketplace release 전 `npm run check:plugin-release`를 실행해 root metadata, marketplace metadata, package-visible provider docs, vendor LICENSE/NOTICE를 확인한다.
11. `plugins/built` package source를 임시 디렉토리로 `dereference` 복사한 격리 package snapshot에서도 `README.md`, provider setup guide, smoke guide, provider scripts/skills, `vendor/codex-plugin-cc/LICENSE`, `vendor/codex-plugin-cc/NOTICE`가 존재하고 내용 기준을 만족하는지 확인한다.
12. target project에 `.built`/`.claude`만 있고 `scripts/`, `src/`가 없는 dogfooding fixture에서 `BUILT_PLUGIN_DIR` 기반 Plan/Run helper 호출이 target project `.built`에 산출물을 남기는지 확인한다.
13. 변경 후 `node test/plugin-packaging.test.js` 또는 전체 `npm test`를 실행한다.

## 주의사항

- plugin packaging smoke는 실제 marketplace publish 자동화를 대체하지 않는다.
- 새 provider helper를 추가하면서 packaging smoke의 필수 provider script 목록을 갱신하지 않으면 사용자 설치 package 누락을 놓칠 수 있다.
- repository root에 파일이 있어서만 통과하는 검증은 release guard로 충분하지 않다. 사용자가 설치할 `plugins/built` package source와 격리 package snapshot을 기준으로 확인한다.
- symlink를 dereference하지 않는 외부 packaging 방식은 현재 release checklist의 전제와 맞지 않으므로 release 전에 차단하거나 별도 packaging 결정을 남긴다.
- vendor LICENSE/NOTICE는 파일 존재뿐 아니라 Apache License 2.0, OpenAI copyright, notice 문구를 함께 검증한다.
- skill 문서에 raw absolute path나 개인 worktree 경로를 남기지 않는다.
- skill 문서에 `<BUILT_PLUGIN_DIR>` placeholder를 남기지 않는다. 실제 실행 가능한 `BUILT_PLUGIN_DIR` shell guard와 경로 산출 절차를 기록한다.
- interactive shell, Claude Bash tool, zsh/bash 호환이 필요한 skill 문서는 `BASH_SOURCE[0]`로 plugin dir를 추정하지 않는다.
- `BUILT_PLUGIN_DIR` unset 상태에서 target cwd 상대 fallback을 두면 target project의 없는 `scripts/`/`src/`를 찾거나 plugin package에 runtime 산출물을 만들 수 있으므로 회귀로 본다.
- secret, token, private environment value, raw execution dump는 skill 문서와 KG 기록에 포함하지 않는다.
- `plugins/built` symlink를 일반 디렉토리 복사본으로 바꾸면 repository-root와 plugin-dir 사이의 drift가 커질 수 있으므로 별도 packaging 결정이 필요하다.
