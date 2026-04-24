---
name: run
description: Do→Check→Iter→Report 전체 파이프라인을 자동 실행한다 (백그라운드 지원)
user-invocable: true
allowed-tools:
  - Read
  - Bash
---

# /built:run — 전체 파이프라인 자동 실행

feature spec을 읽어 Do→Check→Iter→Report 파이프라인을 순서대로 실행한다.
`scripts/run.js`가 각 단계 스크립트를 서브프로세스로 오케스트레이션하며, 진행 상황을 `state.json`에 실시간으로 기록한다.

## 변형

| 명령어 | 동작 |
|---|---|
| `/built:run <feature>` | 기본 모델로 포그라운드 실행 |
| `/built:run-opus <feature>` | claude-opus-4-5 모델로 실행 |
| `/built:run-sonnet <feature>` | claude-sonnet-4-5 모델로 실행 |

## 인자

`$ARGUMENTS` = feature 이름 (예: `user-auth`, `payment-flow`)

feature 이름이 없으면 다음과 같이 안내하고 중단한다:
> "feature 이름을 입력해주세요. 예: `/built:run user-auth`"

---

## 사전 확인

1. **feature 이름 확정**: `$ARGUMENTS`를 `FEATURE` 변수로 저장한다. 공백이나 대문자가 있으면 kebab-case로 정규화한다 (예: `User Auth` → `user-auth`).

2. **`.built/features/<FEATURE>.md` 존재 여부**: Bash로 확인한다. 없으면:
   > "`.built/features/<FEATURE>.md`가 없습니다. `/built:plan <FEATURE>`을 먼저 실행해주세요."

---

## /built:run 실행 (기본 모델)

```bash
node scripts/run.js <FEATURE>
```

백그라운드로 실행하려면:

```bash
node scripts/run.js <FEATURE> --background
```

---

## /built:run-opus 실행

`ANTHROPIC_MODEL` 환경변수 또는 run-request.json을 통해 모델을 설정하거나,
다음과 같이 run-request.json을 직접 생성한 뒤 실행한다:

```bash
mkdir -p .built/runtime/runs/<FEATURE>
echo '{"featureId":"<FEATURE>","planPath":".built/features/<FEATURE>.md","model":"claude-opus-4-5","createdAt":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' \
  > .built/runtime/runs/<FEATURE>/run-request.json
node scripts/run.js <FEATURE>
```

---

## /built:run-sonnet 실행

```bash
mkdir -p .built/runtime/runs/<FEATURE>
echo '{"featureId":"<FEATURE>","planPath":".built/features/<FEATURE>.md","model":"claude-sonnet-4-5","createdAt":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' \
  > .built/runtime/runs/<FEATURE>/run-request.json
node scripts/run.js <FEATURE>
```

---

## 실행 중 동작

파이프라인은 4단계를 순서대로 실행한다:

1. **Do** — feature spec에 따라 코드 구현 (`scripts/do.js`)
2. **Check** — 구현 결과 검토, `needs_changes` 또는 `approved` 판정 (`scripts/check.js`)
3. **Iter** — `needs_changes` 시 Do+Check 반복 (최대 `BUILT_MAX_ITER`회, 기본 3) (`scripts/iter.js`)
4. **Report** — 최종 보고서 생성 (`scripts/report.js`)

각 단계 간 `.built/runtime/runs/<FEATURE>/state.json`이 갱신된다:
- `phase`: 현재 단계 (`do` / `check` / `iter` / `report`)
- `status`: `running` / `completed` / `failed`
- `pid`: 실행 중인 프로세스 ID
- `heartbeat`: 마지막 갱신 시각

환경변수:
- `MULTICA_AGENT_TIMEOUT` — 각 단계 타임아웃 (기본 30분, 예: `60m`, `3600s`)
- `BUILT_MAX_ITER` — Iter 최대 반복 횟수 (기본 3)

---

## 완료 후 안내

성공 시:
```
파이프라인 완료!

결과 파일:
- .built/features/<FEATURE>/do-result.md
- .built/features/<FEATURE>/check-result.md
- .built/features/<FEATURE>/report.md
- .built/runtime/runs/<FEATURE>/state.json  (status: completed)
```

실패 시 오류 메시지를 출력하고, `state.json`의 `last_error` 필드를 확인하도록 안내한다:
```bash
cat .built/runtime/runs/<FEATURE>/state.json
```

---

## 상태 폴링 (백그라운드 실행 시)

백그라운드 실행 후 상태를 확인하려면:

```bash
# 현재 상태
cat .built/runtime/runs/<FEATURE>/state.json

# 실시간 모니터링
watch -n 2 cat .built/runtime/runs/<FEATURE>/state.json
```

`status: completed` 또는 `status: failed`가 될 때까지 폴링한다.

---

## 주의

- 이 명령은 대상 프로젝트 루트에서 실행한다.
- 포그라운드 실행 시 전체 파이프라인 완료까지 터미널이 점유된다.
- 외부 npm 패키지 없음. Node.js 20+ 필요.
- `/built:plan <FEATURE>`이 먼저 실행되어 `.built/features/<FEATURE>.md`가 있어야 한다.
