# built provider 설정 가이드

작성일: 2026-04-26 KST

이 문서는 새 사용자가 Claude 기본 실행과 Codex opt-in 실행을 설정하는 방법을 단계별로 안내합니다.

기술 계약(필드 정의, 이벤트 계약)은 `docs/contracts/provider-config.md`, phase별 선택 기준은 `docs/ops/provider-routing-matrix.md`를 참조하세요.

---

## 기본 개념

### Claude (기본)

설정 없이 `/built:run`을 실행하면 모든 phase가 Claude로 동작합니다. 추가 설정이 없어도 `do → check → iter → report` 파이프라인이 바로 실행됩니다.

### Codex (opt-in)

Codex는 명시적으로 설정해야 합니다. `run-request.json`의 `providers` 필드에 원하는 phase를 지정합니다. 설정하지 않은 phase는 Claude 기본값으로 실행됩니다.

**Codex 사용 전 필수 준비:**

1. `@openai/codex` CLI 설치: `npm install -g @openai/codex`
2. Codex 로그인: `codex login`
3. `do` 또는 `iter` phase에 Codex를 사용한다면 `sandbox: "workspace-write"` 설정 필수

---

## 설정 위치

provider 설정은 `.built/runtime/runs/<feature>/run-request.json`의 `providers` 필드에 지정합니다.

`/built:plan`이 이 파일을 자동으로 생성합니다. Codex를 사용하려면 plan 완료 후 해당 파일에 `providers` 필드를 추가하거나, 수동으로 파일을 만들어 실행합니다.

> `.built/config.json`에는 `providers` 필드를 두지 않습니다. config.json에 넣으면 `/built:validate`에서 `unknown key(s): 'providers'` 오류가 납니다.

---

## 단축형 설정

provider 이름만 지정합니다. model, sandbox, timeout은 provider 기본값을 사용합니다.

```json
{
  "featureId": "user-auth",
  "planPath": ".built/features/user-auth.md",
  "createdAt": "2026-04-26T00:00:00.000Z",
  "providers": {
    "do": "codex",
    "check": "claude"
  }
}
```

단, Codex를 `do`에 단축형으로 쓰면 sandbox가 지정되지 않습니다. Codex는 `do`/`iter`에서 파일 쓰기가 필요하므로 상세형으로 `sandbox: "workspace-write"`를 명시하는 것을 권장합니다.

---

## 상세형 설정

model, sandbox, timeout을 직접 지정합니다.

```json
{
  "featureId": "user-auth",
  "planPath": ".built/features/user-auth.md",
  "createdAt": "2026-04-26T00:00:00.000Z",
  "providers": {
    "do": {
      "name": "codex",
      "model": "gpt-5.5",
      "effort": "high",
      "sandbox": "workspace-write",
      "timeout_ms": 1800000
    },
    "check": {
      "name": "claude",
      "model": "claude-opus-4-5",
      "timeout_ms": 900000
    },
    "iter": {
      "name": "codex",
      "model": "gpt-5.5",
      "effort": "high",
      "sandbox": "workspace-write",
      "timeout_ms": 1800000
    }
  }
}
```

---

## 시나리오별 예시

### 시나리오 1: Claude로 기본 실행 (설정 불필요)

```bash
/built:run user-auth
```

별도 providers 설정 없이 실행합니다. 모든 phase가 Claude 기본값으로 동작합니다.

### 시나리오 2: Codex do + Claude check (교차 검증)

구현(`do`)은 Codex, 검증(`check`)은 Claude로 분리하면 provider 고유 blind spot을 줄일 수 있습니다.

```json
{
  "providers": {
    "do": {
      "name": "codex",
      "model": "gpt-5.5",
      "effort": "high",
      "sandbox": "workspace-write",
      "timeout_ms": 1800000
    },
    "check": {
      "name": "claude",
      "model": "claude-opus-4-5",
      "timeout_ms": 900000
    },
    "iter": {
      "name": "codex",
      "model": "gpt-5.5",
      "effort": "high",
      "sandbox": "workspace-write",
      "timeout_ms": 1800000
    }
  }
}
```

`iter`는 `do`와 동일한 provider/sandbox 설정을 사용합니다. `do`를 Codex로 설정했다면 `iter`도 같이 설정하는 것이 일관성을 유지합니다.

### 시나리오 3: plan_synthesis만 Codex opt-in

계획 단계 구조화만 Codex reasoning으로 강화하고 나머지는 Claude를 유지합니다.

```json
{
  "plan_synthesis": true,
  "providers": {
    "plan_synthesis": {
      "name": "codex",
      "model": "gpt-5.5",
      "effort": "high",
      "sandbox": "read-only",
      "timeout_ms": 900000
    }
  }
}
```

`providers.plan_synthesis`를 설정하면 plan_synthesis phase가 자동으로 활성화됩니다. `plan_synthesis: true`는 함께 써도 되지만 필수는 아닙니다.

---

## sandbox 정책

| phase | 기본 sandbox | Codex 사용 시 |
|-------|-------------|--------------|
| `plan_synthesis` | read-only | read-only 유지 가능 |
| `do` | N/A (Claude) | `workspace-write` 필수 |
| `check` | read-only | read-only 유지 가능 |
| `iter` | N/A (Claude) | `workspace-write` 필수 |
| `report` | read-only | read-only 유지 가능 |

`do`나 `iter`에서 Codex를 `read-only` sandbox로 설정하면 실행 즉시 오류가 납니다:

```
providers.do: "codex" provider가 "do" phase에서 "read-only" sandbox를 사용하면 파일 변경이 불가능합니다. "workspace-write"를 사용하세요.
```

---

## timeout 설정

`timeout_ms`가 없으면 Claude는 `MULTICA_AGENT_TIMEOUT` 환경변수 또는 30분, Codex는 30분이 기본값입니다.

복잡한 feature에서 timeout이 걱정된다면 phase별로 명시적으로 설정합니다:

```json
{
  "providers": {
    "do": {
      "name": "codex",
      "sandbox": "workspace-write",
      "timeout_ms": 1800000
    }
  }
}
```

`timeout_ms`는 양수 정수여야 합니다. 0이나 음수로 설정하면 오류가 납니다:

```
providers.do: timeout_ms는 양수 숫자여야 합니다.
```

---

## Smoke 테스트로 연결 확인

설정 후 실제로 provider에 연결되는지 확인하려면 smoke 테스트를 실행합니다. smoke 테스트는 실제 provider를 호출하므로 API 인증이 완료된 상태여야 합니다.

```bash
# Codex plan_synthesis 연결 확인
npm run test:smoke:codex:plan

# Codex do phase 연결 확인
npm run test:smoke:codex:do

# Codex plan + do 순서 전체 실행
npm run test:smoke:codex
```

smoke 테스트와 기본 테스트의 차이:

| | `npm test` | `npm run test:smoke:*` |
|--|------------|------------------------|
| 실행 조건 | 항상 실행 가능 | Codex CLI 설치 + 인증 필요 |
| provider 호출 | 없음 (fake) | 실제 호출 |
| CI 포함 여부 | 포함 | 별도 수동 실행 |

자세한 내용은 `docs/smoke-testing.md`를 참조하세요.

---

## 오류 메시지 참조

설정이 잘못됐을 때 나타나는 오류 메시지와 조치 방법입니다.

### provider 설정 오류 (run-request.json)

| 오류 메시지 | 원인 | 조치 |
|------------|------|------|
| `providers.do: "name" 필드가 필요합니다.` | 상세형 설정에 `name` 누락 | `"name": "codex"` 추가 |
| `providers.do: 알 수 없는 provider "openai". 유효한 provider: claude, codex.` | 지원하지 않는 provider 이름 | `claude` 또는 `codex`만 사용 |
| `providers.do: 유효하지 않은 sandbox 값 "full". 유효한 값: read-only, workspace-write.` | 잘못된 sandbox 값 | `read-only` 또는 `workspace-write` 사용 |
| `providers.do: "codex" provider가 "do" phase에서 "read-only" sandbox를 사용하면 파일 변경이 불가능합니다.` | do/iter에 Codex + read-only | `sandbox: "workspace-write"` 로 변경 |
| `providers.do: timeout_ms는 양수 숫자여야 합니다.` | timeout_ms가 0 이하 | 양수 정수로 설정 (예: `1800000`) |
| `providers.do: max_retries는 0 이상의 숫자여야 합니다.` | max_retries가 음수 | 0 이상의 정수로 설정 |
| `providers.do: 유효하지 않은 provider 설정 형식입니다. 문자열 또는 객체여야 합니다.` | providers 값이 배열 또는 null | 문자열(`"codex"`) 또는 객체(`{"name": "codex", ...}`) 사용 |

### config.json 오류 (/built:validate)

| 오류 메시지 | 원인 | 조치 |
|------------|------|------|
| `unknown key(s): 'providers'` | config.json에 providers 필드 추가 | config.json이 아닌 run-request.json에 providers 설정 |
| `.built/ 디렉토리가 없습니다. 먼저 /built:init 을 실행하세요.` | 초기화 미완료 | `/built:init` 실행 후 재시도 |
| `'default_model' unknown value: 'gpt-5.5'` | config.json default_model에 Codex 모델명 사용 | default_model은 Claude 모델명만 허용. Codex 모델은 run-request.json providers 필드 사용 |

### Codex 연결 오류 (smoke 테스트)

| 원인축 키워드 | 의미 | 조치 |
|-------------|------|------|
| `원인축: provider_unavailable` | Codex CLI 미설치 | `npm install -g @openai/codex` |
| `원인축: app-server` | CLI가 `app-server` 명령 미지원 | `npm update -g @openai/codex` |
| `원인축: 인증(auth)` | 로그인 미완료 | `codex login` |
| `원인축: sandbox` | do/iter에 read-only sandbox | `sandbox: "workspace-write"` 로 변경 |
| `원인축: timeout` | 실행 시간 초과 | `timeout_ms` 값 증가 또는 네트워크 확인 |
| `원인축: model_response` | 모델 출력 파싱 실패 | 출력 로그에서 구체적 오류 확인 |

---

## 참조

- 설정 계약 (필드 전체 정의): `docs/contracts/provider-config.md`
- phase별 선택 기준: `docs/ops/provider-routing-matrix.md`
- smoke 테스트 상세: `docs/smoke-testing.md`
- provider 이벤트 계약: `docs/contracts/provider-events.md`
