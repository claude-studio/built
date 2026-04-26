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

생성된 보고서는 YAML frontmatter(id, date, status, model) + Markdown 본문 형식으로 저장된다.

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

---

## 실행

아래 Bash 명령어를 실행한다 (포그라운드, 백그라운드 X):

### 로컬 개발 (`--plugin-dir` 방식):

```bash
node scripts/report.js <FEATURE>
```

### 플러그인으로 설치된 경우:

```bash
node "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/report.js" <FEATURE>
```

---

## 실행 중 동작

- 설정된 provider로 서브프로세스를 spawn (Claude 기본 모델: claude-haiku-4-5-20251001)
- run-request.json에 providers.report 또는 model 필드가 있으면 해당 설정 우선 적용
- do-result.md + check-result.md 내용을 프롬프트에 포함
- `.built/features/<FEATURE>/progress.json` 실시간 갱신
- `.built/features/<FEATURE>/logs/report.jsonl` 이벤트 원본 append
- 터미널에 `[built:report]` 접두어로 진행 상황 출력
- 완료 시 `.built/features/<FEATURE>/report.md` 저장 (frontmatter: id, date, status, model)
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
- model: <사용된 모델>
```

실패 시 오류 메시지를 출력하고, `.built/features/<FEATURE>/state.json`에서 상세 오류를 확인하도록 안내한다.

---

## 주의

- 이 명령은 대상 프로젝트 루트에서 실행한다.
- 포그라운드 실행이므로 완료까지 터미널이 점유된다.
- 외부 npm 패키지 없음. Node.js 20+ 필요.
- check-result.md가 없어도 실행 가능하나, 검토 결과가 보고서에 반영되지 않는다.
- Do 단계(do-result.md)는 필수 선행 조건이다.
