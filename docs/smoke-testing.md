# Smoke 테스트 가이드

## 기본 원칙

- `npm test`는 외부 provider 없이 fake/offline 테스트만 실행된다.
- real provider smoke는 명시적 opt-in 환경 변수 또는 `npm run test:smoke:*` 명령으로만 실행된다.
- CI 파이프라인에는 `npm test` 또는 `npm run test:provider`만 포함하고, smoke는 별도 수동 또는 선택적 CI 잡으로 운영한다.

---

## 명령 계층 요약

| 명령 | 범위 | CI 포함 가능 |
|------|------|-------------|
| `npm test` | 전체 단위 + 전체 E2E (offline) | ✅ |
| `npm run test:provider` | provider 단위 + provider E2E (offline) | ✅ |
| `npm run test:provider:unit` | provider 그룹 단위 테스트만 | ✅ |
| `npm run test:provider:contracts` | file-contracts 단독 실행 | ✅ |
| `npm run test:provider:e2e` | fake provider E2E 시나리오 04, 05 | ✅ |
| `npm run test:provider:compare` | comparison mode 단독 실행 | ✅ |
| `npm run test:smoke:codex` | real Codex smoke (plan + do) | ❌ opt-in 전용 |
| `npm run test:smoke:codex:plan` | real Codex plan_synthesis smoke | ❌ opt-in 전용 |
| `npm run test:smoke:codex:do` | real Codex do phase smoke | ❌ opt-in 전용 |
| `npm run test:smoke:pipeline` | Claude 기본 profile 전체 lifecycle smoke | ❌ opt-in 전용 |
| `npm run test:smoke:pipeline:codex` | Codex opt-in profile 전체 lifecycle smoke | ❌ opt-in 전용 |
| `npm run test:smoke:pipeline:all` | Claude와 Codex 전체 lifecycle smoke 순차 실행 | ❌ opt-in 전용 |

---

## 기본 테스트 (fake/offline)

```bash
npm test
```

- 단위 테스트: `test/*.test.js` (모두 mock 기반, 외부 호출 없음)
- E2E 시나리오: `test/e2e/scenarios/` (fake provider 기반 파이프라인 검증, 시나리오 01~05 포함)
- 실행 시 `NO_NOTIFY=1`이 자동 설정된다.

---

## Provider 테스트 (offline, CI-ready)

provider 관련 회귀를 빠르게 좁히거나 provider 작업 후 targeted 검증이 필요할 때 사용한다.
모두 fake provider 기반이며 외부 호출 없이 오프라인 실행 가능하다.

### 전체 provider 테스트 (단위 + E2E)

```bash
npm run test:provider
```

포함 범위:
- `providers-*.test.js` — provider adapter 단위 테스트 (Claude, Codex, normalizer, failure 등)
- `provider-doctor.test.js` — provider doctor 단위 테스트
- `file-contracts.test.js` — 파일 계약 회귀 테스트
- `compare-providers.test.js` — comparison mode 단위 + fake E2E
- E2E 시나리오 `04-fake-provider-file-contracts`
- E2E 시나리오 `05-provider-equivalence-contracts`

### Provider 단위 테스트만

```bash
npm run test:provider:unit
```

위 단위 테스트 파일 그룹만 실행한다. E2E 시나리오는 포함하지 않는다.

### File contract 테스트만

```bash
npm run test:provider:contracts
```

`test/file-contracts.test.js` 단독 실행.
어떤 계약 필드가 깨졌는지 빠르게 확인할 때 사용한다.

### Fake provider E2E만

```bash
npm run test:provider:e2e
```

`test/e2e/scenarios/` 중 파일명에 `provider`가 포함된 시나리오(04, 05)만 실행한다.
- `04-fake-provider-file-contracts` — fake provider 이벤트 시퀀스 + file contract 검증
- `05-provider-equivalence-contracts` — provider 결과 동등성 golden fixture 검증

### Comparison mode 테스트만

```bash
npm run test:provider:compare
```

`test/compare-providers.test.js` 단독 실행.
`src/providers/comparison-config.js`와 `scripts/compare-providers.js` 회귀 검증.

---

## Real Provider Smoke 테스트

### Codex plan_synthesis smoke

Codex가 plan_synthesis phase를 실제로 실행하는지 검증한다.

**전제 조건**

- `@openai/codex` CLI 설치 (`codex --version` 응답)
- `codex login` 인증 완료
- `codex app-server` 명령 지원 (최신 버전 필요)

**실행**

```bash
# 방법 1: 환경 변수 직접 설정
BUILT_CODEX_PLAN_SYNTHESIS_SMOKE=1 node scripts/smoke-codex-plan-synthesis.js

# 방법 2: npm script
npm run test:smoke:codex:plan
```

---

### Codex do phase smoke

Codex가 do phase(구현)를 실제로 실행하는지 검증한다.

**전제 조건**

- `@openai/codex` CLI 설치 및 `codex login` 인증 완료
- sandbox=workspace-write 지원

**실행**

```bash
# 방법 1: 환경 변수 직접 설정
BUILT_CODEX_DO_SMOKE=1 node scripts/smoke-codex-do.js

# 방법 2: npm script
npm run test:smoke:codex:do
```

---

### Codex 전체 smoke (plan + do 순서 실행)

```bash
npm run test:smoke:codex
```

---

## Real Provider 전체 Lifecycle Smoke

`scripts/smoke-full-pipeline.js`는 실제 `scripts/init.js`로 disposable git target을 만든 뒤
`plan_synthesis -> Do -> Check -> Iter -> Report`를 `scripts/run.js` 한 번으로 실행한다.
Claude와 Codex profile은 같은 feature spec, acceptance criteria, `npm test` 명령을 사용한다.

### Profile과 실행 명령

| profile | provider routing | sandbox | 실행 명령 |
|---|---|---|---|
| Claude 기본 | 별도 `providers` override 없이 built default 사용, `plan_synthesis: true` | Claude CLI 권한 계약 사용 | `npm run test:smoke:pipeline` 또는 `npm run test:smoke:pipeline:claude` |
| Codex opt-in | `plan_synthesis`, `do`, `check`, `iter`, `report` 모두 Codex | Do/Iter=`workspace-write`, Plan/Check/Report=`read-only` | `npm run test:smoke:pipeline:codex` |

두 profile을 순서대로 재검증하려면 다음을 실행한다.

```bash
npm run test:smoke:pipeline:all
```

npm script 자체가 비용과 인증 의존 실행에 대한 명시적 opt-in이다. 스크립트를 직접 실행하면서
`BUILT_FULL_PIPELINE_SMOKE=1`을 지정하지 않으면 provider를 호출하지 않고 skip summary를 저장한 뒤
exit 0으로 종료한다.

```bash
node scripts/smoke-full-pipeline.js
BUILT_FULL_PIPELINE_SMOKE=1 BUILT_FULL_PIPELINE_PROFILE=claude node scripts/smoke-full-pipeline.js
BUILT_FULL_PIPELINE_SMOKE=1 BUILT_FULL_PIPELINE_PROFILE=codex node scripts/smoke-full-pipeline.js
```

### 사전 조건과 선택 환경 변수

- Claude profile: `claude --version`이 성공하고 실제 headless 호출 인증이 가능해야 한다.
- Codex profile: `codex --version`, `codex app-server`, `codex login status`가 성공해야 한다.
- `BUILT_FULL_PIPELINE_MODEL`: profile 전 phase에 사용할 model override. Codex 기본값은 `gpt-5.5`다.
- `BUILT_FULL_PIPELINE_PHASE_TIMEOUT_MS`: phase별 provider timeout. 기본 15분이다.
- `BUILT_FULL_PIPELINE_TIMEOUT_MS`: 전체 subprocess timeout. 기본 60분이다.
- `BUILT_KEEP_SMOKE_DIR=1`: 실패 분석용 disposable target을 유지한다. 기본은 항상 정리한다.

### 성공 판정

다음 조건을 모두 만족해야 성공이다.

- `run-request.json`이 존재하고 선택 profile의 phase routing/sandbox가 일치한다.
- lifecycle SSOT인 `state.json`이 `phase=report`, `status=completed`다.
- `progress.json`은 `status=completed`인 관찰 snapshot으로 존재한다.
- run/result root-context, plan synthesis JSON/Markdown, Do/Check/Report 결과와 phase log가 존재한다.
- `check-result.md`가 `approved`이고 `report.md`가 `completed`다.
- provider가 `src/greeting.js`를 실제로 변경했고 disposable worktree에서 `npm test`가 통과한다.
- provider/model/전체 duration이 aggregate summary에 기록된다. usage/cost는 없어도 실패하지 않는다.

Iter는 최초 Check가 `approved`면 기존 lifecycle 계약에 따라 provider를 다시 호출하지 않는 성공 no-op이다.
Check가 `needs_changes`면 최대 2회까지 실제 Iter provider가 실행되며 최종 `approved`가 필요하다.

### Evidence 수집

실행마다 기존 계약 경로에 redacted aggregate가 저장된다.

```text
.built/runtime/smoke/<timestamp>/summary.json
```

`phase`는 `full_lifecycle`이고 `verification`에는 terminal state, root-context, phase result/log,
실제 구현 변경, approved Check, 최종 검증 명령 결과가 boolean/상태 값으로 기록된다. disposable target의
절대경로, workspace UUID, session id, token, raw provider 출력은 aggregate에 저장하지 않는다.

실패 시 기존 `provider_unavailable`, `app_server`, `auth`, `sandbox`, `timeout`,
`model_response`, `unknown` taxonomy를 사용한다. provider가 exit 0을 반환했더라도 실제 파일 변경,
approved Check, Report 또는 최종 `npm test` 중 하나가 없으면 `model_response` 실패다.

---

## 실패 원인 축

smoke 실패 시 출력되는 `원인축:` 메시지로 원인을 분류한다.

| 축 | 출력 키워드 | 의미 및 조치 |
|---|---|---|
| `provider_unavailable` | `원인축: provider_unavailable` | Codex CLI 미설치 또는 PATH 문제. `npm install -g @openai/codex` 후 재시도. |
| `app-server` | `원인축: app-server` | 설치된 Codex CLI가 `app-server` 명령을 지원하지 않음. CLI를 최신 버전으로 업데이트. |
| `인증(auth)` | `원인축: 인증(auth)` | Codex 로그인 상태 미인증. `codex login` 실행 후 재시도. |
| `sandbox` | `원인축: sandbox` | do/iter phase에서 read-only sandbox 사용 시 파일 쓰기 불가. run-request의 sandbox를 `workspace-write`로 변경. |
| `timeout` | `원인축: timeout` | 실행 시간이 20분 제한 초과. 네트워크 상태 확인 또는 `timeout_ms` 조정 후 재시도. |
| `model_response` | `원인축: model_response` | 모델 출력 파싱 실패 또는 산출물 구조 불일치. 위 출력 로그에서 구체적 오류 확인. |

---

## Smoke Artifact

smoke 실행(성공, 실패, skip)마다 결과를 구조화된 JSON artifact로 저장한다.

**저장 경로**

```text
.built/runtime/smoke/<timestamp>/summary.json
```

- `<timestamp>`는 `YYYYMMDDTHHmmss` 형식 (로컬 시간 기준)
- `.built/runtime/smoke/`는 `.gitignore`에 포함되어 버전 관리하지 않는다.
- `npm test`에서는 artifact가 생성되지 않는다 (opt-in smoke 전용).

**artifact 구조**

```json
{
  "schema_version": "1.0.0",
  "id": "20260426T093045",
  "created_at": "2026-04-26T00:30:45.000Z",
  "provider": "codex",
  "phase": "plan_synthesis",
  "model": null,
  "duration_ms": 5000,
  "skipped": false,
  "success": true,
  "failure": null,
  "verification": { "plan_steps": 5 }
}
```

실패 시:

```json
{
  "success": false,
  "failure": {
    "kind": "auth",
    "message": "[smoke:plan] Codex 인증 실패 (codex login 필요) — ..."
  }
}
```

**failure taxonomy**

| kind | 의미 |
|------|------|
| `provider_unavailable` | Codex CLI 미설치 또는 PATH 문제 |
| `app_server` | Codex CLI가 app-server 명령 미지원 |
| `auth` | Codex 인증 실패 |
| `sandbox` | sandbox 설정 불일치 |
| `timeout` | 실행 시간 초과 |
| `model_response` | 모델 출력 파싱 실패 또는 산출물 구조 불일치 |
| `unknown` | 미분류 |

**secret redaction**

artifact 저장 전 `scripts/sanitize.js`의 redaction 규칙이 적용된다.
API 키, 홈 경로, session_id, 환경변수 값은 자동으로 마스킹된다.
secret, token, raw debug dump는 artifact에 저장되지 않는다.

**한글 실패 요약**

smoke 실패 시 사용자가 이슈/코멘트에 붙일 수 있는 한글 요약이 콘솔에 출력된다.
형식: `[smoke:<phase>] <한글 원인 설명> — <추가 상세>`

상세 artifact schema는 `docs/contracts/smoke-artifact.md`를 참조한다.

---

## 디버그 옵션

smoke 실행 후 임시 디렉토리를 삭제하지 않으려면:

```bash
BUILT_KEEP_SMOKE_DIR=1 BUILT_CODEX_DO_SMOKE=1 node scripts/smoke-codex-do.js
```

출력에서 임시 디렉토리 경로를 확인한 뒤 직접 탐색할 수 있다.

---

## Real Provider Comparison Smoke

Claude와 Codex를 같은 feature spec으로 동시 실행하고, 결과 차이를 비교 report로 남긴다.
자동 winner 선택과 자동 merge는 수행하지 않는다.

### 전제 조건

- **Claude CLI** 설치 (`claude --version` 응답)
- **Codex CLI** 설치 및 인증 완료 (`codex --version` 응답, `codex login` 완료)
- `codex app-server` 명령 지원 (최신 버전 필요)

### 실행

```bash
# 방법 1: 환경 변수 직접 설정
BUILT_COMPARE_REAL_SMOKE=1 node scripts/smoke-compare-providers.js

# 방법 2: npm script
npm run test:smoke:compare
```

환경 변수 미설정 시 skip 후 exit 0으로 종료해 기본 테스트를 오염시키지 않는다.

### 산출물

실행 완료 후 임시 디렉토리에 다음 경로가 생성된다.

```
.built/runtime/runs/compare-smoke/comparisons/<comparison-id>/
  manifest.json              — 비교 메타데이터 (base commit, 시작/종료 시각, status)
  report.md                  — 사람이 읽는 비교 리포트 (자동 winner 미선정)
  input-snapshot.json        — 비교 입력 고정값
  acceptance-criteria.md     — feature spec 스냅샷
  verification-plan.json     — 검증 명령 목록
  providers/
    claude/
      run-request.json       — claude 전용 실행 설정
      state.json             — phase 완료 상태
      diff.patch             — base 대비 변경 diff
      git-status.txt         — 변경 파일 목록
      verification.json      — 검증 명령 결과
      result/do-result.md    — claude do phase 결과
    codex/
      (동일 구조)
```

`BUILT_KEEP_SMOKE_DIR=1`을 함께 설정하면 임시 디렉토리를 삭제하지 않는다.

```bash
BUILT_KEEP_SMOKE_DIR=1 BUILT_COMPARE_REAL_SMOKE=1 node scripts/smoke-compare-providers.js
```

### 실패 원인 축

| 축 | 출력 키워드 | 의미 및 조치 |
|---|---|---|
| `provider_unavailable` | `원인축: provider_unavailable` | Claude 또는 Codex CLI 미설치. CLI 설치 후 재시도. |
| `인증(auth)` | `원인축: 인증(auth)` | Codex 로그인 미완료. `codex login` 실행 후 재시도. |
| `comparison_setup` | `원인축: comparison_setup` | git init 또는 run-request.json 작성 오류. 출력 메시지 확인. |
| `candidate_failed` | `원인축: candidate_failed` | 하나 이상의 candidate do phase가 실패. 위 출력 확인. |
| `artifact_missing` | `원인축: artifact_missing` | 기대 산출물이 생성되지 않음. 격리 위반 또는 provider 오류. |
| `timeout` | `원인축: timeout` | 실행 시간이 40분 제한 초과. 네트워크 상태 확인 후 재시도. |

### 정리 절차

임시 디렉토리는 smoke 종료 시 자동 삭제된다.
`BUILT_KEEP_SMOKE_DIR=1`로 유지한 경우 다음 절차로 정리한다.

1. `report.md`와 `diff.patch`에서 필요한 evidence를 복사한다.
2. candidate worktree(`<tmpDir>/.claude/worktrees/`)를 확인하고 삭제한다.
3. 임시 디렉토리 전체를 삭제한다: `rm -rf <tmpDir>`

### 비범위

- 병렬 provider 실행은 포함하지 않는다.
- 자동 winner 선택은 포함하지 않는다.
- CI 기본 실행(`npm test`)에 포함하지 않는다.
