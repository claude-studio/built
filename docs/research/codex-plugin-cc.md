# codex-plugin-cc reference analysis

작성일: 2026-04-26 KST

## 목적

`built`를 Claude 전용 실행 구조에서 provider 구조로 전환하기 전에, Claude Code용 OpenAI Codex 플러그인(`@openai/codex-plugin-cc`)을 어느 수준까지 재사용할 수 있는지 확인한다.

이 문서는 PR 0a 산출물이다. 다음 PR 0b에서는 여기의 판단을 기준으로 `vendor copy`, `dependency`, `reimplement` 중 하나를 확정한다.

## 확인한 레퍼런스

로컬 설치본 기준:

- Marketplace root: `/Users/jb/.claude/plugins/marketplaces/openai-codex`
- Plugin root: `/Users/jb/.claude/plugins/marketplaces/openai-codex/plugins/codex`
- Package: `@openai/codex-plugin-cc` `1.0.2`
- License: Apache-2.0
- Runtime requirement: Node `>=18.18.0`
- 현재 로컬 Codex CLI: `codex-cli 0.125.0`
- `codex app-server`는 `~/.codex/config.toml` 기반 설정을 읽고, `-c key=value` override를 지원한다.

공식 문서 기준:

- OpenAI Developers: `https://developers.openai.com/codex/app-server`
- 문서 설명: Codex app-server는 제품 안에 Codex를 깊게 통합하기 위한 protocol이다.
- app-server는 JSON-RPC 기반이며, thread/turn lifecycle과 streamed agent events를 제공한다.
- 공식 문서는 단순 CI/자동화 작업에는 Codex SDK를 권장하지만, rich client 통합에는 app-server를 안내한다.

## 공식 app-server 문서와의 정합성

공식 문서 기준으로 `codex app-server`는 다음 성격을 가진다.

- JSON-RPC 2.0 메시지 기반 통신
- 기본 transport는 stdio JSONL
- `initialize` 후 `initialized` notification 필요
- `thread/start`, `thread/resume`, `turn/start`, `turn/interrupt` lifecycle 제공
- `item/started`, `item/completed`, `turn/completed` 등 실행 이벤트 streaming
- `turn/start`에서 model, cwd, sandbox policy 같은 실행 옵션 전달 가능

이 구조는 built의 provider 전환 목표와 맞다.

- built는 단순 최종 텍스트만 필요한 것이 아니라 progress/log/result를 유지해야 한다.
- built는 provider raw event를 표준 provider event로 normalize해야 한다.
- built는 phase 실행 중 tool call, file change, command execution 같은 진행 상태를 관찰해야 한다.
- built는 추후 interrupt/status/sandbox 제어가 필요할 수 있다.

따라서 이 프로젝트에서는 Codex SDK보다 app-server 접근을 우선한다.

단, 이 판단은 "Codex를 built provider로 통합하는 경우"에 한정한다. 별도 CI job에서 Codex를 한 번 실행하고 결과만 받는 단순 자동화라면 공식 문서의 권장처럼 Codex SDK가 더 적합할 수 있다.

## 핵심 구조

Codex 플러그인은 단순히 `codex` CLI를 batch 실행하는 구조가 아니다. 주요 실행 경로는 다음과 같다.

- `commands/review.md`, `commands/rescue.md`
  - Claude Code slash command 진입점.
  - 실제 Codex 실행은 `scripts/codex-companion.mjs`로 위임한다.
- `scripts/codex-companion.mjs`
  - review/task/status/result/cancel 같은 사용자 명령을 처리한다.
  - built provider가 그대로 가져오기에는 UI/command 정책이 많이 섞여 있다.
- `scripts/lib/app-server.mjs`
  - `CodexAppServerClient` 제공.
  - `codex app-server`를 직접 spawn하거나 broker에 연결한다.
  - JSON-RPC line protocol, initialize, notification handling을 담당한다.
- `scripts/app-server-broker.mjs`
  - 공유 broker 프로세스.
  - `turn/start`, `review/start`, `turn/interrupt` 등을 app-server로 프록시한다.
  - 동시에 여러 요청이 들어오면 busy error를 반환한다.
- `scripts/lib/broker-lifecycle.mjs`
  - broker session dir, unix socket endpoint, pid/log file, shutdown, stale cleanup을 관리한다.
- `scripts/lib/codex.mjs`
  - `runAppServerTurn`, `runAppServerReview`, `interruptAppServerTurn` 같은 고수준 wrapper 제공.
  - Codex app-server notification을 progress callback과 최종 결과로 정규화한다.

## built 현재 구조와의 접점

현재 `built`는 `src/pipeline-runner.js`에서 `claude -p`를 직접 spawn한다.

- 일반 phase:
  - `claude -p --output-format stream-json --verbose`
  - stdout JSONL을 `src/progress-writer.js`로 전달
- structured phase:
  - `claude -p --output-format json --json-schema <schema>`
  - stdout 전체를 JSON으로 파싱

`src/progress-writer.js`는 Claude stream-json 이벤트에 직접 묶여 있다.

- 입력 이벤트: `system`, `assistant`, `user`, `tool_result`, `result`
- 출력 파일:
  - `.built/features/<feature>/progress.json`
  - `.built/features/<feature>/logs/<phase>.jsonl`
  - `do-result.md` 등 phase result markdown

따라서 provider 전환의 핵심은 `progress-writer`가 Claude raw event만 받는 구조를 없애고, provider 공통 이벤트 또는 runner-level result writer를 두는 것이다.

## PR 0a 체크리스트 답변

### 1. broker가 `~/.claude/plugins/...` 경로에 의존하는가?

부분적으로만 의존한다.

- core lib는 대부분 `import.meta.url` 기준 상대 경로를 사용한다.
- `app-server.mjs`는 `../../.claude-plugin/plugin.json`을 읽어 client version을 구성한다.
- command 문서는 `CLAUDE_PLUGIN_ROOT` 환경 변수에 의존하지만, built provider에서는 command 문서를 재사용하지 않는다.
- session lifecycle hook은 Claude Code plugin 환경 변수(`CLAUDE_ENV_FILE`, `CLAUDE_PLUGIN_DATA`)와 결합되어 있다.

결론:

- `~/.claude/plugins/...` 절대 경로에 직접 고정되어 있지는 않다.
- 다만 현재 파일 배치를 그대로 전제하는 부분이 있으므로, built에 벤더링한다면 manifest/version 주입 방식을 수정하거나 동일한 최소 파일 배치를 유지해야 한다.

### 2. 외부 dependency가 있는가?

런타임 외부 npm dependency는 없다.

- `package.json`의 dependency는 없고, devDependency는 `@types/node`, `typescript`뿐이다.
- runtime JS는 Node built-in module과 `codex` CLI에 의존한다.
- TypeScript protocol type은 `codex app-server generate-ts`로 생성되는 구조지만, built가 JS runtime만 사용할 경우 필수 런타임 의존성은 아니다.

결론:

- built의 현재 철학인 "외부 npm 패키지 최소화"와 잘 맞는다.
- 실제 필수 의존성은 `codex` CLI와 app-server protocol 호환성이다.

### 3. broker lifecycle은 어떻게 종료되는가?

broker는 별도 detached Node 프로세스로 뜬다.

- session dir: OS temp 아래 `cxc-*`
- endpoint: unix socket
- pid file: `broker.pid`
- log file: `broker.log`
- state file: workspace state dir의 `broker.json`
- shutdown:
  - `broker/shutdown` JSON-RPC 요청
  - `SIGTERM` / `SIGINT`
  - session end hook
  - stale session 발견 시 cleanup

결론:

- broker lifecycle 코드는 직접 다시 만들기보다 재사용하는 편이 안전하다.
- built에 도입할 때는 Claude Code SessionEnd hook에 기대지 말고, built runner 종료 경로에서 명시적으로 shutdown/cleanup을 호출해야 한다.

### 4. Codex 인증 경로는 표준적인가?

플러그인은 인증 파일을 직접 읽지 않고 Codex CLI에 위임한다.

- readiness check: `codex --version`, `codex app-server --help`
- login check: `codex login status`
- `codex app-server --help` 기준 설정 기본값은 `~/.codex/config.toml`이다.
- 설정 override는 `codex app-server -c key=value` 방식으로 가능하다.

결론:

- built provider는 인증을 직접 구현하지 말고 Codex CLI readiness/login check만 수행해야 한다.
- CI/smoke 환경은 `~/.codex/config.toml`이 없을 수 있으므로 real Codex smoke test는 일반 `npm test`에서 분리해야 한다.

### 5. 라이선스는 호환되는가?

레퍼런스 플러그인은 Apache-2.0이다.

- `LICENSE`, `NOTICE`가 포함되어 있다.
- 벤더링 시 LICENSE/NOTICE 보존이 필요하다.
- 수정 파일에는 변경 사실을 명확히 남기는 편이 안전하다.

결론:

- 벤더링 자체는 가능해 보인다.
- PR 0b에서 정확히 어떤 파일을 가져올지 확정한 뒤, `NOTICE` 보존 위치를 같이 정해야 한다.

## built에 필요한 부분과 불필요한 부분

필요한 부분:

- `CodexAppServerClient`
- broker endpoint/lifecycle
- `runAppServerTurn`의 thread/turn/progress capture 패턴
- `turn/interrupt`
- sandbox/model/effort/outputSchema 전달
- readiness/login check 패턴

불필요하거나 후순위인 부분:

- Claude Code slash command 문서
- review gate stop hook
- background job registry
- `/codex:status`, `/codex:result`, `/codex:cancel` 사용자 UI
- `runTrackedJob` 기반 job store
- native review command

특히 background job store는 built의 `.built/runtime/runs/<feature>/state.json`과 책임이 겹친다. built phase는 동기적으로 완료되어야 다음 phase로 넘어가므로, Codex 플러그인의 background job 모델을 그대로 들이면 상태가 이중화된다.

## provider 구현 방향

권장 방향:

1. built의 phase lifecycle은 계속 `state.json`이 소유한다.
2. Codex provider는 app-server thread/turn 실행만 담당한다.
3. Codex provider는 파일 계약을 직접 쓰지 않는다.
4. provider는 `{ success, exitCode, text, structuredOutput, providerMeta }`와 표준 progress event만 반환한다.
5. `pipeline-runner` 또는 별도 result writer가 provider output을 `progress.json`, `logs/<phase>.jsonl`, `do-result.md`로 정규화한다.

Codex provider 기본 옵션 초안:

```json
{
  "name": "codex",
  "model": null,
  "effort": null,
  "sandbox": "read-only",
  "approvalPolicy": "never",
  "timeoutMs": 1800000
}
```

`do`처럼 파일 수정이 필요한 phase는 `sandbox: "workspace-write"`가 필요하다. 이 옵션이 누락되면 Codex가 성공처럼 보이더라도 실제 파일 변경이 반영되지 않는 실패가 발생할 수 있다.

## provider 간 실제 결과물 갭 축소 원칙

provider 전환의 목표는 Claude와 Codex가 항상 동일한 코드를 생성하게 만드는 것이 아니다. 모델이 다르면 구현 diff는 달라질 수밖에 있다.

대신 목표는 다음과 같다.

- 같은 요구사항을 받는다.
- 같은 작업 범위에서 실행한다.
- 같은 완료 기준을 통과한다.
- 같은 built 결과 파일 계약을 만족한다.
- 다른 provider가 만든 결과를 교차 검증할 수 있다.

이를 위해 이후 PR의 contracts와 tests에 다음 원칙을 포함해야 한다.

### 1. 입력 계약 고정

모든 provider는 같은 입력 묶음을 받아야 한다.

- feature spec
- plan 또는 plan_synthesis 결과
- acceptance criteria
- repo context
- prior result
- KG excerpts 또는 관련 decision 문서
- phase별 허용 작업 범위

Codex provider는 Claude Code 대화 기억을 볼 수 없다고 가정한다. 따라서 provider가 알아야 하는 정보는 세션 암묵지에 의존하지 않고 파일 또는 prompt payload에 명시해야 한다.

### 2. plan_synthesis 선행

`do` 전에 plan_synthesis 단계를 둘 수 있어야 한다.

- interactive discovery는 host가 담당한다.
- plan_synthesis는 provider가 수행할 수 있다.
- do phase는 확정된 plan_synthesis 결과를 입력으로 받는다.

이렇게 해야 Claude와 Codex가 같은 구현 계획을 보고 작업할 수 있다.

### 3. provider별 worktree 격리

provider 실행 결과가 같은 작업공간에서 섞이면 diff 비교와 rollback이 어려워진다.

- 기본 Do 실행은 선택된 provider 하나만 수행한다. 같은 Do를 Claude와 Codex가 동시에 실행하는 구조가 아니다.
- 기본 실행에서도 run별 worktree 격리를 우선한다.
- 같은 feature에 대해 Claude/Codex 결과를 비교하는 병렬 실행은 명시적 실험 모드에서만 허용한다.
- 실험 모드를 허용할 경우 provider별 output directory와 worktree를 분리한다.
- 최종 merge 대상은 검증을 통과한 하나의 결과만 선택한다.

### 4. 검증 기준 통일

완료 판정은 provider의 자연어 응답이 아니라 동일한 검증 명령과 acceptance criteria로 한다.

- 같은 test command
- 같은 lint/typecheck/build command
- 같은 check phase schema
- 같은 acceptance criteria

provider가 "완료"라고 말해도 검증 기준을 통과하지 못하면 built는 완료로 보지 않는다.

### 5. cross-review

가능하면 구현 provider와 review provider를 분리한다.

- Codex가 구현한 결과는 Claude가 review한다.
- Claude가 구현한 결과는 Codex가 review할 수 있다.
- 같은 모델 계열이 만든 결과를 같은 모델 계열이 단독 승인하지 않는 방향을 기본값으로 둔다.

이 원칙은 provider 품질 차이를 줄이는 보조 장치이며, PR 1의 provider config와 operating model에 명시해야 한다.

## 이벤트 매핑 초안

Codex app-server notification은 built 표준 이벤트로 변환해야 한다.

| built event | Codex source |
| --- | --- |
| `phase_start` | provider run 시작, thread 준비 전 |
| `text_delta` | `agentMessage` completed 또는 delta 계열 notification |
| `tool_call` | `item/started` 중 `commandExecution`, `mcpToolCall`, `dynamicToolCall`, `fileChange` |
| `tool_result` | `item/completed` 중 위 item type |
| `phase_end` | `turn/completed` |
| `error` | `error` notification 또는 app-server request 실패 |

`usage`/`cost`는 PR 0a 기준 필수 이벤트로 두지 않는다. provider마다 의미가 달라 계약을 먼저 부풀릴 가능성이 크다. 대신 `provider`, `model`, `duration_ms`, `threadId`, `turnId` 같은 실행 메타데이터는 필수로 남긴다.

## 재사용 전략 후보

### 1. dependency

현재는 추천하지 않는다.

- `@openai/codex-plugin-cc`는 현재 설치본 기준 `private: true`이다.
- plugin marketplace 구조이지, built가 안정적으로 import할 npm runtime package가 아니다.
- 사용자의 Claude plugin 설치 경로에 직접 의존하면 built 재현성이 떨어진다.

### 2. vendor copy

PR 0b의 1순위 후보.

가져올 후보 파일:

- `scripts/lib/app-server.mjs`
- `scripts/app-server-broker.mjs`
- `scripts/lib/broker-lifecycle.mjs`
- `scripts/lib/broker-endpoint.mjs`
- `scripts/lib/process.mjs`
- `scripts/lib/fs.mjs`
- 필요한 경우 `scripts/lib/codex.mjs`에서 `runAppServerTurn` 관련 부분만 축소 이식

조건:

- LICENSE/NOTICE 보존
- built 내부 경로와 CommonJS/ESM 경계 결정
- `.claude-plugin/plugin.json` 상대 참조 제거 또는 built manifest로 대체
- background job/store 코드는 제외
- fake app-server/broker contract test 먼저 추가

### 3. reimplement

현재는 후순위다.

- app-server JSON-RPC client, broker busy handling, lifecycle cleanup, interrupt까지 직접 다시 만들면 PR 5 위험이 커진다.
- 레퍼런스 코드가 이미 Node built-in만으로 잘 분리되어 있어 재구현 이득이 작다.

## PR 0b 결정 트리

1. `codex-plugin-cc` lib가 독립 npm package로 제공되거나 제공할 수 있다면 dependency를 우선 검토한다.
2. 그렇지 않으면 runtime lib 최소 세트를 vendor copy한다.
3. vendor copy가 라이선스, 업데이트 추적, ESM/CJS 경계 때문에 과도하게 커지면 필요한 protocol만 reimplement한다.

현재 관찰 기준 추천은 `2. 최소 vendor copy`이다.

## 다음 작업 제안

PR 0b:

- 벤더링 대상 파일 목록 확정
- `src/providers/codex/` 또는 `vendor/codex-plugin-cc/` 위치 결정
- Apache-2.0 NOTICE 보존 방식 결정
- fake app-server fixture 설계
- `CodexAppServerClient`를 built에서 import 가능한 최소 형태로 분리

PR 1:

- `docs/contracts/file-contracts.md`
- `docs/contracts/provider-events.md`
- `docs/contracts/provider-config.md`
- `docs/contracts/plan-synthesis-input.md`
- sandbox 정책, review gate 비결합, usage optional 정책 문서화

PR 2:

- 현재 Claude runner contract test 추가
- Claude 호출부를 provider interface 뒤로 이동
- 외부 동작 변화 없이 `claude` provider 추출

PR 3 이후:

- fake Codex provider E2E
- real Codex `plan_synthesis` smoke
- real Codex `do` phase는 sandbox/write/result 계약이 검증된 뒤 도입
