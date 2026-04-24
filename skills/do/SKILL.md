---
name: do
description: Do 단계 실행 - feature spec에 따라 코드를 포그라운드로 구현한다
user-invocable: true
allowed-tools:
  - Read
  - Bash
---

# /built:do — Do 단계 실행

feature spec을 읽어 Do 단계를 포그라운드로 실행한다.
`scripts/do.js`를 통해 `src/pipeline-runner.js`를 호출, `claude -p` 서브세션을 spawn해 구현을 진행한다.

stream-json stdout → progress-writer → `.built/features/<feature>/do-result.md` 파이프라인이 포그라운드로 실행된다.

## 인자

`$ARGUMENTS` = feature 이름 (예: `user-auth`, `payment-flow`)

feature 이름이 없으면 다음과 같이 안내하고 중단한다:
> "feature 이름을 입력해주세요. 예: `/built:do user-auth`"

---

## 사전 확인

1. **feature 이름 확정**: `$ARGUMENTS`를 `FEATURE` 변수로 저장한다. 공백이나 대문자가 있으면 kebab-case로 정규화한다 (예: `User Auth` → `user-auth`).

2. **`.built/features/<FEATURE>.md` 존재 여부**: Bash로 확인한다. 없으면 다음과 같이 안내하고 중단한다:
   > "`.built/features/<FEATURE>.md`가 없습니다. `/built:plan <FEATURE>`을 먼저 실행해주세요."

---

## 실행

아래 Bash 명령어를 실행한다 (포그라운드, 백그라운드 X):

### 로컬 개발 (`--plugin-dir` 방식):

```bash
node scripts/do.js <FEATURE>
```

### 플러그인으로 설치된 경우:

```bash
node "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/do.js" <FEATURE>
```

---

## 실행 중 동작

- `claude -p --output-format stream-json --verbose`를 서브세션으로 spawn
- stream-json 이벤트가 `progress-writer`를 통해 실시간 처리됨
- `.built/features/<FEATURE>/progress.json` 실시간 갱신
- `.built/features/<FEATURE>/logs/do.jsonl` 이벤트 원본 append
- 터미널에 `[built:do]` 접두어로 진행 상황 출력
- `MULTICA_AGENT_TIMEOUT` 환경변수로 타임아웃 제어 (기본값 30분)
  - 형식 예: `MULTICA_AGENT_TIMEOUT=60m`, `MULTICA_AGENT_TIMEOUT=3600s`, `MULTICA_AGENT_TIMEOUT=1800000`

---

## 완료 후 안내

성공 시:
```
Do 완료!

결과 파일:
- .built/features/<FEATURE>/do-result.md
- .built/features/<FEATURE>/progress.json
- .built/features/<FEATURE>/logs/do.jsonl

다음 단계: /built:check <FEATURE>
```

실패 시 오류 메시지를 출력하고, `.built/features/<FEATURE>/state.json`에서 상세 오류를 확인하도록 안내한다.

---

## 주의

- 이 명령은 대상 프로젝트 루트에서 실행한다.
- 포그라운드 실행이므로 완료까지 터미널이 점유된다.
- 외부 npm 패키지 없음. Node.js 20+ 필요.
- Do 중단이 필요하면 Ctrl+C 로 프로세스를 종료한다.
