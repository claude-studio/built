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
