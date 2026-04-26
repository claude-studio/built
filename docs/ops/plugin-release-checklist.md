# Plugin release checklist

이 문서는 Claude Code plugin package를 release하기 전에 확인할 자동/수동 기준을 정리한다.

## Release 전 필수 명령

```bash
npm run check:plugin-release
node test/plugin-packaging.test.js
```

`npm run check:plugin-release`는 다음 누락을 실패로 처리한다.

- `.claude-plugin/plugin.json`의 `name`, `version`, `description`, `author.name`, `repository`, `license`
- `.claude-plugin/marketplace.json`의 `name`, `owner`, `metadata.description`, `plugins[].name`, `plugins[].source`, `plugins[].description`
- `plugins/built/.claude-plugin/plugin.json`의 `name`, `description`, `skills`
- `plugins/built` package 안에서 해석되는 `README.md`, provider setup guide, smoke guide
- `vendor/codex-plugin-cc/LICENSE`, `vendor/codex-plugin-cc/NOTICE`

`vendor/codex-plugin-cc/LICENSE`는 Apache License 2.0 전문을 포함해야 하고, `vendor/codex-plugin-cc/NOTICE`는 OpenAI copyright와 Apache License 2.0 고지를 포함해야 한다.

## Package 포함 기준

`marketplace.json`의 built plugin source는 `./plugins/built`이다. 따라서 사용자가 marketplace 또는 `--plugin-dir` 방식으로 설치했을 때 필요한 파일은 `plugins/built` 아래에서 해석되어야 한다.

필수 포함 파일:

- `plugins/built/README.md`
- `plugins/built/docs/ops/provider-setup-guide.md`
- `plugins/built/docs/smoke-testing.md`
- `plugins/built/vendor/codex-plugin-cc/LICENSE`
- `plugins/built/vendor/codex-plugin-cc/NOTICE`
- `plugins/built/scripts/provider-doctor.js`
- `plugins/built/scripts/smoke-codex-do.js`
- `plugins/built/scripts/smoke-codex-plan-synthesis.js`
- `plugins/built/skills/doctor/SKILL.md`
- `plugins/built/skills/run-codex/SKILL.md`

현재 repository-root와 package source 사이 drift를 줄이기 위해 `plugins/built`는 root의 `scripts`, `skills`, `src`, `README.md`, `docs`, `vendor`를 symlink로 참조한다.

## 수동 확인

- 실제 marketplace publish 자동화는 이 checklist 범위가 아니다.
- release note에는 provider setup 문서(`docs/ops/provider-setup-guide.md`)와 smoke guide(`docs/smoke-testing.md`) 위치를 포함한다.
- real provider smoke는 기본 테스트와 분리되어 있으며, 필요할 때만 `npm run test:smoke:codex` 또는 개별 smoke 명령으로 실행한다.
- vendor NOTICE를 바꾸는 경우 upstream 출처와 license 문구를 함께 확인한다.
