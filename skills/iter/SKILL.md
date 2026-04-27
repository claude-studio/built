---
name: iter
description: Iter 단계 실행 - check-result.md가 needs_changes일 때 이전 산출물을 재주입해 Do를 최대 3회 반복한다
user-invocable: true
allowed-tools:
  - Read
  - Bash
---

# /built:iter — Iter 단계 실행

check-result.md가 `needs_changes`인 경우 이전 산출물(do-result.md, check-result.md, feature-spec.md)을
컨텍스트로 재주입해 Do 단계를 재실행한다. `approved`가 될 때까지 최대 `BUILT_MAX_ITER`회 반복한다.

`scripts/iter.js`를 통해 `src/pipeline-runner.js runPipeline()`을 호출(Do 재실행)하고,
`scripts/check.js`를 서브프로세스로 재실행해 새 check-result.md를 생성한다.

## 인자

`$ARGUMENTS` = feature 이름 (예: `user-auth`, `payment-flow`)

feature 이름이 없으면 다음과 같이 안내하고 중단한다:
> "feature 이름을 입력해주세요. 예: `/built:iter user-auth`"

---

## 사전 확인

1. **feature 이름 확정**: `$ARGUMENTS`를 `FEATURE` 변수로 저장한다. 공백이나 대문자가 있으면 kebab-case로 정규화한다 (예: `User Auth` → `user-auth`).

2. **`.built/features/<FEATURE>.md` 존재 여부**: 없으면 다음과 같이 안내하고 중단한다:
   > "`.built/features/<FEATURE>.md`가 없습니다. `/built:plan <FEATURE>`을 먼저 실행해주세요."

3. **`.built/features/<FEATURE>/check-result.md` 존재 여부**: 없으면 다음과 같이 안내하고 중단한다:
   > "`.built/features/<FEATURE>/check-result.md`가 없습니다. `/built:check <FEATURE>`을 먼저 실행해주세요."

---

## 실행

대상 프로젝트 루트 cwd를 유지한 상태에서 built plugin/repo의 script를 절대 경로로 호출한다.
`BUILT_PLUGIN_DIR`는 설치된 built plugin/repo의 절대 경로이며, target project root와 분리된다.
Claude Bash tool, zsh, bash, interactive shell 모두에서 `BASH_SOURCE[0]`로 skill 파일 위치를 추정하지 않는다.

```bash
: "${BUILT_PLUGIN_DIR:?BUILT_PLUGIN_DIR must point to the installed built plugin/repo path}"
SCRIPT_DIR="$(cd "$BUILT_PLUGIN_DIR/scripts" && pwd -P)"
node "$SCRIPT_DIR/iter.js" <FEATURE>
```

---

## 실행 중 동작

- `.built/features/<FEATURE>/check-result.md` frontmatter의 `status` 확인
- `status == approved` 이면 루프 없이 즉시 종료 → 다음 단계 안내
- `status == needs_changes` 이면 Iter 루프 진입:
  - feature-spec.md + do-result.md + check-result.md를 컨텍스트로 재주입
  - 설정된 provider(기본: Claude)로 Do 재실행 → 새 do-result.md 생성
  - `scripts/check.js <FEATURE>` 서브프로세스로 Check 재실행 → 새 check-result.md 생성
  - 새 status가 `approved`면 종료, `needs_changes`면 다음 반복
  - 최대 반복 횟수: `BUILT_MAX_ITER` 환경변수 (기본값 3)
  - 초과 시 state.json에 `status: failed` 기록 후 에스컬레이션 메시지 출력
- `MULTICA_AGENT_TIMEOUT` 환경변수로 각 Do 단계 타임아웃 제어 (기본값 30분)
  - 형식 예: `MULTICA_AGENT_TIMEOUT=60m`, `MULTICA_AGENT_TIMEOUT=3600s`
- `.built/runtime/runs/<FEATURE>/state.json`이 있으면 `attempt` 카운터 자동 갱신

---

## 완료 후 안내

**approved 달성** 시:
```
Iter 완료! (approved, 반복 N/M)

결과 파일:
- .built/features/<FEATURE>/do-result.md    (최신 구현)
- .built/features/<FEATURE>/check-result.md (status: approved)

다음 단계: /built:report <FEATURE>
```

**이미 approved** 시:
```
status: approved → 이미 승인됨. 반복 불필요.

다음 단계: /built:report <FEATURE>
```

**최대 반복 초과** 시:
```
최대 반복 횟수 (N)를 초과했습니다. 수렴 불가.

check-result.md를 확인하고 수동으로 개입이 필요합니다.
- .built/features/<FEATURE>/check-result.md  (수정 필요 항목 확인)
- .built/runtime/runs/<FEATURE>/state.json   (status: failed)
```

실패 시 오류 메시지를 출력하고, 원인을 확인하도록 안내한다.

---

## 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `BUILT_MAX_ITER` | `3` | 최대 반복 횟수 (양의 정수) |
| `MULTICA_AGENT_TIMEOUT` | `30m` | 각 Do 단계 타임아웃. `30m`, `1h`, `3600s`, `180000` 형식 지원 |

---

## 주의

- 이 명령은 대상 프로젝트 루트에서 실행한다.
- `/built:check <FEATURE>` 완료 후 실행한다.
- 외부 npm 패키지 없음. Node.js 20+ 필요.
- 반복마다 do-result.md를 덮어쓴다. 이전 결과는 check-result.md에 기록되어 있다.
