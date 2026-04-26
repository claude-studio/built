# Smoke 테스트 가이드

## 기본 원칙

- `npm test`는 외부 provider 없이 fake/offline 테스트만 실행된다.
- real provider smoke는 명시적 opt-in 환경 변수 또는 `npm run test:smoke:*` 명령으로만 실행된다.
- CI 파이프라인에는 basic test(`npm test`)만 포함하고, smoke는 별도 수동 또는 선택적 CI 잡으로 운영한다.

---

## 기본 테스트 (fake/offline)

```bash
npm test
```

- 단위 테스트: `test/*.test.js` (모두 mock 기반, 외부 호출 없음)
- E2E 시나리오: `test/e2e/scenarios/` (fake provider 기반 파이프라인 검증)
- 실행 시 `NO_NOTIFY=1`이 자동 설정된다.

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
