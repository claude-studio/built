# usage telemetry optional 정책

작성일: 2026-04-26 KST

## 배경

usage/cost 정보(input_tokens, output_tokens, cost_usd)는 provider마다 제공 여부와 정밀도가 다르다.
Codex처럼 cost_usd를 null로 반환하는 provider도 있고, 미래에 추가될 provider는 usage 자체를 제공하지 않을 수 있다.
이 정보를 필수 계약으로 요구하면 새 provider 연결 비용이 높아지고 테스트가 허위 실패로 끝난다.

## 원칙

- **usage/cost는 optional telemetry다.** provider가 제공하지 않아도 pipeline이 정상 동작해야 한다.
- **실행 메타(provider, model, duration_ms)는 필수다.** phase 완료 후 반드시 기록해야 한다.
- **telemetry 부재 시 report/status가 깨지지 않는다.** null 값은 "-"로 표시하고 오류로 처리하지 않는다.

## 필수 실행 메타 (progress.json + do-result.md)

provider가 달라도 항상 기록해야 하는 필드:

| 필드 | 위치 | 설명 |
| --- | --- | --- |
| `provider` | progress.json | phase_start 이벤트에서 설정 |
| `model` | progress.json, do-result.md | phase_start 이벤트에서 설정 |
| `duration_ms` | progress.json, do-result.md | phase_end 이벤트에서 설정 |

## Optional telemetry (usage/cost)

provider가 usage 이벤트를 emit할 때만 기록되는 필드:

| 필드 | 기본값 | 설명 |
| --- | --- | --- |
| `cost_usd` | null | usage 이벤트 누적 또는 phase_end에서 설정 |
| `input_tokens` | null | usage 이벤트 누적 |
| `output_tokens` | null | usage 이벤트 누적 |

### null 표시 규칙

- `progress.json`에서 null 필드는 그대로 null로 저장한다. 0으로 변환하지 않는다.
- `/built:status` 출력에서 cost는 값이 있을 때만 표시한다. null/0이면 생략한다.
- `do-result.md` frontmatter에서 `cost_usd: null`은 유효한 값이다.
- `scripts/cost.js`에서 cost_usd가 없는 경우 0으로 처리해 테이블에 포함한다(집계 일관성).

## 상태 리포트 표시 규칙

`/built:status <feature>` 출력 예시:

usage 제공 provider (Claude):
```
feature: user-auth
  phase:       do
  status:      completed
  provider:    claude
  model:       claude-opus-4-5
  duration:    12000ms
  cost:        $0.0042
```

usage 미제공 provider (Codex cost_usd=null):
```
feature: user-auth
  phase:       do
  status:      completed
  provider:    codex
  model:       gpt-5.5
  duration:    12000ms
```

cost 줄은 cost_usd가 null 또는 0일 때 생략한다.

## 향후 확장 지점

usage/cost를 집계하거나 외부 리포트로 내보낼 때는 아래 확장 지점을 사용한다:

1. **`scripts/cost.js`**: `readFeatureCost(root, feature)` 함수가 progress.json에서 cost_usd를 읽는다. cost_usd가 없으면 0을 반환한다. 이 함수를 확장해 provider별 pricing table 적용, 예산 경보, 외부 API 전송을 구현할 수 있다.

2. **`usage` 이벤트**: `docs/contracts/provider-events.md`의 optional usage 이벤트 스키마를 확장해 추가 필드(cache_tokens, reasoning_tokens 등)를 붙일 수 있다.

3. **`progress.json` telemetry 섹션**: 향후 `telemetry: { cost_usd, input_tokens, output_tokens }` 형태로 분리해 optional 구조임을 명시할 수 있다. 현재는 최소 구조로 flat하게 유지한다.

## 관련 문서

- `docs/contracts/provider-events.md` — usage 이벤트를 optional로 정의
- `kg/goals/north-star.md` — "usage/cost 추적은 관측 기능으로 남기되, core file/event contract의 필수 조건이 되지 않는다"
- `src/providers/standard-writer.js` — optional telemetry 구현 참조
