---
name: cost
description: feature별/전체 비용(cost_usd)을 집계해 출력한다
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# /built:cost

feature별 또는 전체 누적 비용을 조회합니다.
`.built/features/<feature>/progress.json`의 `cost_usd` 필드를 읽어 출력합니다.

## 사용법

```
/built:cost --feature <name>
/built:cost --all
/built:cost --all --format json
/built:cost --feature <name> --format json
```

## 옵션

- `--feature <name>`: 특정 feature의 비용, 토큰 수, phase 등 상세 출력
- `--all`: 모든 feature 비용을 테이블 형식으로 출력 (합산 포함)
- `--format json`: 결과를 JSON으로 출력 (스크립트 파이프라인 활용 시)

## 실행 방법

```bash
# 특정 feature
node "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/cost.js" --feature <name>

# 전체 합산
node "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/cost.js" --all

# JSON 출력
node "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/cost.js" --all --format json
```

로컬 개발(`--plugin-dir` 방식)에서는:

```bash
node scripts/cost.js --feature <name>
node scripts/cost.js --all
node scripts/cost.js --all --format json
```

## 출력 예시

### --feature <name>

```
feature:       user-auth
cost:          $0.2341
phase:         report
input_tokens:  45230
output_tokens: 8120
total_tokens:  53350
updated_at:    2026-04-25T10:00:00.000Z
```

### --all

```
feature          cost  phase   tokens
-----------------------------------
user-auth      $0.2341  report   53350
payment        $0.1820  check    38210
onboarding     $0.3105  do       62100
-----------------------------------
TOTAL          $0.7266           153660
```

### --all --format json

```json
{
  "features": [
    {
      "feature": "user-auth",
      "cost_usd": 0.2341,
      "phase": "report",
      "input_tokens": 45230,
      "output_tokens": 8120,
      "updated_at": "2026-04-25T10:00:00.000Z"
    }
  ],
  "total_cost_usd": 0.2341,
  "total_tokens": 53350
}
```

## 동작

1. `--feature <name>` 지정 시:
   - `.built/features/<name>/progress.json` 읽기
   - 파일 없으면 오류 메시지 출력 후 exit 1
2. `--all` 지정 시:
   - `.built/runtime/registry.json` 에서 feature 목록 시도
   - registry 없으면 `.built/features/` 디렉토리 직접 탐색
   - 각 feature의 `progress.json` 읽어 비용 합산
   - 테이블 출력 (feature, cost, phase, tokens 컬럼)
3. `--format json` 추가 시:
   - 동일 데이터를 JSON으로 직렬화해 출력

## 데이터 소스

- 비용 데이터: `.built/features/<feature>/progress.json` (`cost_usd` 필드)
- feature 목록: `.built/runtime/registry.json` → `.built/features/` 폴백

## 주의

- 외부 npm 패키지 없음. Node.js 20+ 필요.
- `cost_usd`는 해당 feature의 마지막 실행 phase 기준 누적 비용이다.
- 대상 프로젝트 루트에서 실행합니다.
