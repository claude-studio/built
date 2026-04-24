---
name: validate
description: .built/config.json 및 .built/hooks.json의 스키마를 검증한다. 필수 필드 누락, 타입 오류, 잘못된 훅 구조를 사람이 읽기 쉬운 메시지로 출력한다.
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# /built:validate

`.built/config.json` 및 `.built/hooks.json`의 유효성을 검증합니다.

## 사용법

```
/built:validate [--config-only] [--hooks-only]
```

- `--config-only`: config.json만 검증
- `--hooks-only`: hooks.json만 검증
- 플래그 없음: 두 파일 모두 검증

## 실행 방법

```bash
node scripts/validate.js
node scripts/validate.js --config-only
node scripts/validate.js --hooks-only
```

## 검증 항목

### config.json

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `version` | integer ≥ 1 | 필수 | 설정 스키마 버전 |
| `max_parallel` | integer ≥ 1 | 필수 | 최대 병렬 실행 수 |
| `default_model` | string | 필수 | 기본 모델 식별자 |
| `max_iterations` | integer ≥ 1 | 필수 | 최대 반복 횟수 |
| `cost_warn_usd` | number > 0 | 필수 | 비용 경고 임계값 (USD) |

config.local.json 파일이 있으면 동일한 스키마로 추가 검증합니다.

### hooks.json

- `pipeline` 필드 필수 (object)
- 유효 이벤트: `before_do`, `after_do`, `after_check`, `after_report`
- 각 이벤트값은 훅 항목 배열

**command 훅** (`run` 필드 있음):

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `run` | string (비어있지 않음) | 필수 | 실행할 셸 명령 |
| `halt_on_fail` | boolean | 선택 | 실패 시 파이프라인 중단 |
| `condition` | string | 선택 | 실행 조건 표현식 |
| `timeout` | number > 0 | 선택 | 타임아웃 (밀리초) |
| `capture_output` | boolean | 선택 | 출력 캡처 여부 |
| `expect_exit_code` | integer | 선택 | 기대 종료 코드 |

**skill 훅** (`skill` 필드 있음):

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `skill` | string (비어있지 않음) | 필수 | 호출할 스킬 이름 |
| `halt_on_fail` | boolean | 선택 | 실패 시 파이프라인 중단 |
| `model` | `opus`\|`sonnet`\|`haiku` | 선택 | 사용할 모델 |
| `effort` | `low`\|`medium`\|`high` | 선택 | 추론 노력 |
| `condition` | string | 선택 | 실행 조건 표현식 |

hooks.local.json 파일이 있으면 동일한 스키마로 추가 검증합니다.

## 출력 예시

모든 파일 유효:

```
Validating hooks:
  [ ok ] .built/hooks.json
  [skip] .built/hooks.local.json — not found (optional)

Validating config:
  [ ok ] .built/config.json
  [skip] .built/config.local.json — not found (optional)

Validation passed.
```

오류 발생:

```
Validating config:
  [fail] .built/config.json
         • 'version' is required
         • 'default_model' unknown value: 'gpt-4' (known: ...)

Validation failed. Fix the errors above and re-run.
```

## Exit codes

| 코드 | 의미 |
|------|------|
| 0 | 모든 검증 통과 |
| 1 | 검증 오류 또는 파일 읽기 실패 |

## 주의

- 외부 npm 패키지 없음. Node.js 20+ 필요.
- 대상 프로젝트 루트에서 실행합니다.
- `config.local.json`, `hooks.local.json`은 optional — 없어도 통과합니다.
