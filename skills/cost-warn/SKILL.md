# cost-warn

비용 경고 및 dry-run 모드 스킬.

## 비용 경고 동작

`/built:run <feature>` 실행 전 `.built/runtime/runs/<feature>/progress.json`에서 누적 비용을 확인한다.

- **임계값**: $1.00
- **초과 시**: 터미널에 경고 메시지를 출력하고 사용자에게 `y/N` 확인 요청
- **사용자 거부(N 또는 Enter)**: 파이프라인 중단 (exit 1)
- **사용자 승인(y)**: 파이프라인 정상 진행
- **비대화형 환경(stdin 닫힘)**: 기본값 N으로 처리하여 중단

```
[built:run] 비용 경고: 이 feature의 누적 비용이 $1.2345 입니다.
[built:run]    임계값($1.00)을 초과했습니다.
[built:run] 계속 진행하시겠습니까? (y/N): y
```

## dry-run 모드

실제 claude 호출 없이 실행 계획만 출력한다. 비용 경고 없이 통과한다.

### 활성화 방법

**방법 1: 플래그**
```
/built:run <feature> --dry-run
```

**방법 2: run-request.json 설정**
```json
{
  "dry_run": true,
  "model": "claude-opus-4-5"
}
```
`run-request.json`은 `.built/runtime/runs/<feature>/run-request.json`에 위치한다.

### dry-run 출력 예시

```
[built:run] feature: my-feature
[built:run] [dry-run] 실행 계획 출력 (실제 claude 호출 없음)

Feature: my-feature
Spec: /path/to/.built/features/my-feature.md
Run dir: /path/to/.built/runtime/runs/my-feature

파이프라인 단계:
  1. Do    — feature 구현 (scripts/do.js)
  2. Check — 품질 검증 (scripts/check.js)
  3. Iter  — 반복 개선 (scripts/iter.js)
  4. Report — 결과 요약 (scripts/report.js)

Spec 미리보기:
---
# Feature: my-feature
...
---

[built:run] [dry-run] 완료. 실제 실행하려면 --dry-run 없이 다시 실행하세요.
```

## 구현 위치

- `scripts/run.js`: `readAccumulatedCost()`, `checkCostAndConfirm()`, `printDryRunPlan()`
- 비용 데이터 소스: `.built/runtime/runs/<feature>/progress.json` (`cost_usd` 필드)
