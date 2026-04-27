---
name: report
description: Report 단계 실행 - do-result.md + check-result.md 기반으로 최종 보고서를 생성한다
user-invocable: true
allowed-tools:
  - Read
  - Bash
---

# /built:report — Report 단계 실행

do-result.md와 check-result.md를 읽어 최종 보고서를 생성한다.
`scripts/report.js`를 통해 `src/pipeline-runner.js`를 호출, 설정된 provider로 보고서를 작성한다.
`run-request.json`에 `providers.report`가 지정되어 있으면 해당 provider를 사용한다.

Claude provider 기본 모델은 claude-haiku-4-5-20251001이며, run-request.json에 모델이 명시된 경우 해당 모델을 우선 적용한다.

생성된 보고서는 YAML frontmatter(id, date, status, provider, model, check_status) + Markdown 본문 형식으로 저장된다.
Report 완료 후 KG 초안은 target repo가 아니라 Codex PDCA agent folder의 `~/Desktop/agents/codex-pdca-agent/projects/<project-slug>/kg/` 아래에만 생성된다.
`check-result.md`의 frontmatter `status`가 `approved`가 아니면 기본적으로 중단한다.
검증 미완료 상태에서 예외적으로 보고서를 만들어야 할 때만 `--allow-unchecked`를 명시하며, 이 경우 `report.md` frontmatter에 `unchecked: true`와 `unchecked_reason`이 남는다.

## 인자

`$ARGUMENTS` = feature 이름 (예: `user-auth`, `payment-flow`)

feature 이름이 없으면 다음과 같이 안내하고 중단한다:
> "feature 이름을 입력해주세요. 예: `/built:report user-auth`"

---

## 사전 확인

1. **feature 이름 확정**: `$ARGUMENTS`를 `FEATURE` 변수로 저장한다. 공백이나 대문자가 있으면 kebab-case로 정규화한다 (예: `User Auth` → `user-auth`).

2. **`.built/features/<FEATURE>.md` 존재 여부**: Bash로 확인한다. 없으면 다음과 같이 안내하고 중단한다:
   > "`.built/features/<FEATURE>.md`가 없습니다. `/built:plan <FEATURE>`을 먼저 실행해주세요."

3. **`.built/features/<FEATURE>/do-result.md` 존재 여부**: Bash로 확인한다. 없으면 다음과 같이 안내하고 중단한다:
   > "`.built/features/<FEATURE>/do-result.md`가 없습니다. `/built:do <FEATURE>`을 먼저 실행해주세요."

4. **`.built/features/<FEATURE>/check-result.md` 승인 여부**: Bash로 확인한다. 없거나 frontmatter `status`가 `approved`가 아니면 중단한다:
   > "`.built/features/<FEATURE>/check-result.md`가 approved 상태가 아닙니다. `/built:check <FEATURE>` 또는 `/built:iter <FEATURE>`를 먼저 실행해주세요."

   검증 미완료 상태의 보고서가 반드시 필요하면 사용자가 명시적으로 `--allow-unchecked`를 붙여 실행한다. 이 예외는 `report.md` frontmatter에 기록된다.

---

## 실행

대상 프로젝트 루트 cwd를 유지한 상태에서 built plugin/repo의 script를 절대 경로로 호출한다.
`BUILT_PLUGIN_DIR`는 설치된 built plugin/repo의 절대 경로이며, target project root와 분리된다.
Claude Bash tool, zsh, bash, interactive shell 모두에서 `BASH_SOURCE[0]`로 skill 파일 위치를 추정하지 않는다.

```bash
: "${BUILT_PLUGIN_DIR:?BUILT_PLUGIN_DIR must point to the installed built plugin/repo path}"
SCRIPT_DIR="$(cd "$BUILT_PLUGIN_DIR/scripts" && pwd -P)"
node "$SCRIPT_DIR/report.js" <FEATURE>
```

검증 미완료 예외 실행:

```bash
: "${BUILT_PLUGIN_DIR:?BUILT_PLUGIN_DIR must point to the installed built plugin/repo path}"
SCRIPT_DIR="$(cd "$BUILT_PLUGIN_DIR/scripts" && pwd -P)"
node "$SCRIPT_DIR/report.js" <FEATURE> --allow-unchecked
```

---

## 실행 중 동작

- 설정된 provider로 서브프로세스를 spawn (Claude 기본 모델: claude-haiku-4-5-20251001)
- run-request.json에 providers.report 또는 model 필드가 있으면 해당 설정 우선 적용
- do-result.md + check-result.md 내용을 프롬프트에 포함
- check-result.md frontmatter `status: approved`인 경우에만 기본 실행
- `.built/features/<FEATURE>/progress.json` 실시간 갱신
- `.built/features/<FEATURE>/logs/report.jsonl` 이벤트 원본 append
- 터미널에 `[built:report]` 접두어로 진행 상황 출력
- 완료 시 `.built/features/<FEATURE>/report.md` 저장 (frontmatter: id, date, status, provider, model, check_status)
- 완료 시 agent-local KG 생성:
  - `kg/_index.md`: wikilink/frontmatter 규칙과 다음 Plan 재사용 경로
  - `kg/issues/<FEATURE>.md`: run 결과, 목표, 완료/blocked 근거, 검증 요약
  - `kg/decisions|patterns|entities|workflows/*.md`: Report의 KG 후보 섹션에서 분리 가능한 초안
- `--allow-unchecked` 실행 시 frontmatter에 `unchecked: true`, `unchecked_reason` 추가
- `MULTICA_AGENT_TIMEOUT` 환경변수로 타임아웃 제어 (기본값 30분)

---

## 완료 후 안내

성공 시:
```
Report 완료!

결과 파일:
- .built/features/<FEATURE>/report.md

frontmatter:
- id: <FEATURE>
- date: <ISO8601>
- status: completed
- provider: <사용된 provider>
- model: <사용된 모델>
- check_status: approved
- agent_kg_root: ~/Desktop/agents/codex-pdca-agent/projects/<project-slug>/kg
- agent_kg_issue: ~/Desktop/agents/codex-pdca-agent/projects/<project-slug>/kg/issues/<FEATURE>.md
```

실패 시 오류 메시지를 출력하고, `.built/features/<FEATURE>/state.json`에서 상세 오류를 확인하도록 안내한다.

---

## 주의

- 이 명령은 대상 프로젝트 루트에서 실행한다.
- 포그라운드 실행이므로 완료까지 터미널이 점유된다.
- 외부 npm 패키지 없음. Node.js 20+ 필요.
- check-result.md가 없거나 approved가 아니면 기본 실행은 실패한다.
- `--allow-unchecked`는 명시 opt-in이며, 검증 미완료 보고서임을 artifact에 남기는 용도다.
- Do 단계(do-result.md)는 필수 선행 조건이다.
- KG 산출물은 agent-local folder에만 쓰며 target repo의 `kg/` 또는 built plugin repo의 `kg/`를 생성/수정하지 않는다.
