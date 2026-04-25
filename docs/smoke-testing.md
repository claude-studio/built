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
