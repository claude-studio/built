---
name: check
description: Check 단계 실행 - do-result.md를 검토해 needs_changes 또는 passed 판정을 내린다
user-invocable: true
allowed-tools:
  - Read
  - Bash
---

# /built:check — Check 단계 실행

feature spec과 do-result.md를 검토해 Check 단계를 실행한다.
`scripts/check.js`를 통해 `src/pipeline-runner.js`를 `--json-schema` 모드로 호출,
구조화 응답(status / issues / summary)을 파싱해 `.built/features/<feature>/check-result.md`를 생성한다.

## 인자

`$ARGUMENTS` = feature 이름 (예: `user-auth`, `payment-flow`)

feature 이름이 없으면 다음과 같이 안내하고 중단한다:
> "feature 이름을 입력해주세요. 예: `/built:check user-auth`"

---

## 사전 확인

1. **feature 이름 확정**: `$ARGUMENTS`를 `FEATURE` 변수로 저장한다. 공백이나 대문자가 있으면 kebab-case로 정규화한다 (예: `User Auth` → `user-auth`).

2. **`.built/features/<FEATURE>.md` 존재 여부**: 없으면 다음과 같이 안내하고 중단한다:
   > "`.built/features/<FEATURE>.md`가 없습니다. `/built:plan <FEATURE>`을 먼저 실행해주세요."

3. **`.built/features/<FEATURE>/do-result.md` 존재 여부**: 없으면 다음과 같이 안내하고 중단한다:
   > "`.built/features/<FEATURE>/do-result.md`가 없습니다. `/built:do <FEATURE>`을 먼저 실행해주세요."

---

## 실행

아래 Bash 명령어를 실행한다:

### 로컬 개발 (`--plugin-dir` 방식):

```bash
node scripts/check.js <FEATURE>
```

### 플러그인으로 설치된 경우:

```bash
node "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/check.js" <FEATURE>
```

---

## 실행 중 동작

- `claude --bare -p --output-format json --json-schema '<schema>'`를 서브세션으로 spawn
- JSON schema: `{ status: "needs_changes" | "passed", issues: string[], summary: string }`
- 응답의 `structured_output`을 파싱해 check-result.md 생성
- `MULTICA_AGENT_TIMEOUT` 환경변수로 타임아웃 제어 (기본값 30분)
  - 형식 예: `MULTICA_AGENT_TIMEOUT=60m`, `MULTICA_AGENT_TIMEOUT=3600s`

---

## 완료 후 안내

**passed** 시:
```
Check 완료! (passed)

결과 파일:
- .built/features/<FEATURE>/check-result.md  (status: passed)

다음 단계: /built:report <FEATURE>
```

**needs_changes** 시:
```
Check 완료! (needs_changes)

결과 파일:
- .built/features/<FEATURE>/check-result.md  (status: needs_changes)

수정 필요 항목:
1. <항목 1>
2. <항목 2>
...

다음 단계: /built:iter <FEATURE>
```

실패 시 오류 메시지를 출력하고, 원인을 확인하도록 안내한다.

---

## check-result.md 형식

```markdown
---
feature: <FEATURE>
status: needs_changes | passed
checked_at: <ISO8601>
---

## 검토 결과

<summary>

## 수정 필요 항목

- <issue 1>
- <issue 2>
```

---

## 주의

- 이 명령은 대상 프로젝트 루트에서 실행한다.
- `/built:do <FEATURE>` 완료 후 실행한다.
- 외부 npm 패키지 없음. Node.js 20+ 필요.
