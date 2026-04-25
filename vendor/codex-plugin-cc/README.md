# codex-plugin-cc vendor subset

작성일: 2026-04-26 KST

이 디렉터리는 `built`의 Codex provider 구현을 준비하기 위해 OpenAI Claude Code Codex 플러그인의 runtime 일부를 벤더링한 것이다.

## 출처

- Package: `@openai/codex-plugin-cc`
- Version: `1.0.2`
- Local source: `/Users/jb/.claude/plugins/marketplaces/openai-codex/plugins/codex`
- License: Apache-2.0

`LICENSE`와 `NOTICE`는 원본을 그대로 보존한다.

## 포함 범위

포함한 파일은 Codex app-server 실행과 broker lifecycle에 필요한 최소 runtime이다.

- `.claude-plugin/plugin.json`
- `scripts/app-server-broker.mjs`
- `scripts/lib/app-server.mjs`
- `scripts/lib/args.mjs`
- `scripts/lib/broker-endpoint.mjs`
- `scripts/lib/broker-lifecycle.mjs`
- `scripts/lib/codex.mjs`
- `scripts/lib/fs.mjs`
- `scripts/lib/git.mjs`
- `scripts/lib/process.mjs`
- `scripts/lib/state.mjs`
- `scripts/lib/workspace.mjs`

## 제외 범위

다음은 의도적으로 가져오지 않는다.

- Claude Code slash command 문서
- review gate hook
- session lifecycle hook
- background job UI
- `/codex:status`, `/codex:result`, `/codex:cancel` UX
- native review prompt/schema

`built`의 phase lifecycle은 계속 `.built/runtime/runs/<feature>/state.json`이 소유한다. 이 vendor 코드는 provider adapter가 Codex app-server thread/turn 실행을 호출할 때만 사용한다.

## 수정 정책

- 원본 파일은 가능하면 직접 수정하지 않는다.
- built 전용 adapter는 `src/providers/codex/`에 둔다.
- 원본 수정이 필요하면 이 README와 해당 파일에 변경 이유를 남긴다.
- upstream 갱신 시 버전, 포함 파일, license/notice 보존 여부를 다시 확인한다.
