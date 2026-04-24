---
id: BUI-36
title: "[Week 4+] Iter 루프 수렴 감지 강화 (C4 위험 대응)"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-36
pr: https://github.com/claude-studio/built/pull/35
week: 4
tags: [iter, convergence, failure-handling, cost-control]
---

## 목표

iter.js의 Iter 루프 종료 조건을 강화한다. 기존에는 BUILT_MAX_ITER 초과 시만 failed 처리했으나, BUILT-DESIGN.md C4 위험 요소에서 정량 지표 기반 수렴 감지와 max_cost_usd 상한이 필요하다고 명시됨.

## 구현 내용

- `extractCheckIssues` + `issueSetEqual` 집합 비교 함수 추가 — check-result.md의 issues 배열 텍스트 기반 비교
- 연속 2회 동일 이슈 감지 시 `non_converging` 상태로 state.json 갱신 후 종료
- `BUILT_MAX_COST_USD` 환경변수 지원 — 각 iter 전 progress.json의 누적 cost_usd 확인, 초과 시 `budget_exceeded` 사유로 종료
- state.json에 `failure_kind` 필드 추가 (retryable | needs_iteration | non_converging | worker_crashed | needs_replan)
- 단위 테스트 섹션 추가: 7(이슈 집합 비교), 8(failure_kind), 9(비용 상한) — 38개 전 통과

## 결정 사항

- 이슈 유사도 비교를 임베딩 없이 집합 비교(Set equality)로 구현 — 외부 deps 0 원칙 준수
- `budget_exceeded` 종료 시 failure_kind는 `retryable`로 분류 — 비용 한도가 높아지면 재시도 가능하기 때문

## 발생한 이슈

없음. 1회차 리뷰 통과.

## 완료 기준 충족 여부

1. iter.js에 연속 실패 패턴 감지 로직 추가 — 충족
2. BUILT_MAX_COST_USD 환경변수 지원 — 충족
3. state.json에 failure_kind 필드 기록 — 충족
4. 외부 npm 패키지 없음 — 충족
5. 단위 테스트 업데이트 (convergence 케이스 포함) — 충족

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-36",
  "name": "[Week 4+] Iter 루프 수렴 감지 강화 (C4 위험 대응)",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/35"},
  "actionStatus": "CompletedActionStatus"
}
```
