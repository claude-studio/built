---
id: DEC-usage-telemetry-optional
title: usage/cost를 optional telemetry로 처리하는 정책
type: decision
date: 2026-04-26
status: accepted
tags: [telemetry, usage, cost, provider, contract]
issue: BUI-135
---

# usage/cost를 optional telemetry로 처리하는 정책

## 결정

usage/cost(input_tokens, output_tokens, cost_usd)는 provider event contract의 필수 조건에서 제외한다.
provider/model/duration_ms는 실행 메타로 유지하며 phase_start/phase_end에서 반드시 기록한다.

## 배경

Codex provider는 usage 이벤트에서 cost_usd를 null로 반환한다.
미래 provider는 usage 이벤트 자체를 emit하지 않을 수 있다.
기존 코드에서 costUsd, inputTokens, outputTokens의 초기값이 0이어서 usage 없는 provider도 "$0.0000"으로 오해할 여지가 있었다.

## 선택한 구현 방식

1. `standard-writer.js`: costUsd, inputTokens, outputTokens 초기값을 `null`로 변경. usage 이벤트가 오면 그때 누적 시작.
2. `standard-writer.js`: buildProgress()에 provider, model, duration_ms 필드 추가. phase_start/phase_end에서 각각 설정.
3. `scripts/status.js` formatStatus(): progress.json의 provider/model/duration_ms를 항상 표시. cost는 값이 있을 때만 표시.
4. `docs/contracts/usage-telemetry-optional-policy.md`: 정책 문서 신규 작성.

## 검토한 대안

- cost_usd를 0으로 유지하고 0일 때 "-" 표시: 코드가 단순하지만 "0원 청구"와 "데이터 없음"을 구분할 수 없다.
- telemetry 섹션을 별도 중첩 객체로 분리: 구조가 명확하지만 기존 테스트 계약 변경 범위가 크다. 이번 이슈 범위 초과.

## 영향 범위

- `src/providers/standard-writer.js`: costUsd/inputTokens/outputTokens 초기값 null, buildProgress에 provider/model/duration_ms 추가.
- `scripts/status.js`: formatStatus에 provider/model/duration/cost 표시 로직 추가.
- `docs/contracts/usage-telemetry-optional-policy.md`: 신규 정책 문서.
- 기존 테스트: progress.json의 cost_usd 타입 계약이 number에서 number|null로 변화. 관련 테스트 업데이트 필요.

## 비가역 원칙과의 정합

north-star.md: "usage/cost 추적은 관측 기능으로 남기되, core file/event contract의 필수 조건이 되지 않는다" — 이 결정은 해당 원칙을 코드 레벨에서 명시적으로 구현한다.
