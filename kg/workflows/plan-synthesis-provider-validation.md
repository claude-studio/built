---
id: WF-6
title: Plan Synthesis Provider Validation
type: workflow
date: 2026-04-26
validated_by: [BUI-118]
tags: [provider, plan_synthesis, validation, smoke, regression]
---

## 패턴 설명

`plan_synthesis` phase를 수정할 때는 입력 payload, canonical output, runner activation, downstream `do` 주입, 실제 provider smoke 분리를 함께 검증한다.
기본 회귀 테스트는 fake provider와 파일 계약으로 고정하고, 실제 Codex smoke는 명시적 opt-in으로만 실행한다.

## 언제 사용하나

- `src/plan-synthesis.js`의 payload, output schema, markdown render, read/write path를 바꿀 때
- `scripts/plan-synthesis.js` 또는 `scripts/run.js`의 `plan_synthesis` 실행 조건을 바꿀 때
- `scripts/do.js`가 plan output을 읽어 prompt에 주입하는 방식을 바꿀 때
- `src/providers/codex.js`의 `phase_end`, final text, result event 처리를 바꿀 때
- 실제 Codex `plan_synthesis` smoke 경로를 갱신할 때

## 단계

1. 기준 문서를 확인한다:
   `docs/contracts/plan-synthesis-input.md`, `docs/contracts/provider-config.md`, `docs/contracts/provider-events.md`, `docs/roadmaps/provider-transition.md`.
2. payload가 `feature_spec`, `questions`, `answers`, `repo_context`, `acceptance_criteria`, `constraints`를 포함하는지 검증한다.
   구현 추적 필드인 `feature_id`, `feature_spec_path`, `prior_art`도 누락되지 않게 확인한다.
3. output normalization이 `summary`, `steps`, `acceptance_criteria`, `risks`, `out_of_scope`를 항상 반환하는지 테스트한다.
4. canonical 산출물이 `.built/features/<feature>/plan-synthesis.json`과 `.built/features/<feature>/plan-synthesis.md`에 기록되는지 확인한다.
5. provider가 산출물 파일을 직접 쓰지 않고 runner/helper를 통해서만 기록하는지 확인한다.
6. `scripts/run.js` activation 조건이 `runRequest.plan_synthesis === true` 또는 `providers.plan_synthesis` 설정으로 제한되는지 확인한다.
7. legacy 요청에서 `plan_synthesis`가 실행되지 않는지 확인한다.
8. `scripts/do.js`가 canonical JSON의 `output`만 읽어 prompt에 주입하는지 확인한다.
9. fake Codex 표준 이벤트가 `phase: plan_synthesis`, `phase_end.result`, progress/result 파일 계약을 만족하는지 확인한다.
10. 기본 검증은 `npm test`, `npm test -- --unit`, `node scripts/smoke-codex-plan-synthesis.js`의 skip 동작 확인으로 마무리한다.
11. 실제 provider 확인이 필요할 때만 `BUILT_CODEX_PLAN_SYNTHESIS_SMOKE=1 node scripts/smoke-codex-plan-synthesis.js`를 실행한다.

## 주의사항

- 실제 Codex smoke는 인증과 로컬 app-server 상태에 의존하므로 기본 CI나 기본 테스트에 포함하지 않는다.
- `plan_synthesis`는 read-only phase다.
  파일 수정이나 implementation side effect는 `do` phase 범위로 남겨야 한다.
- activation 조건을 느슨하게 만들면 기존 `run` 사용자에게 새 provider 실패 모드가 생긴다.
- `phase_end.result`가 비어 있으면 `standard-writer`가 최종 provider text를 결과 파일에 남기지 못할 수 있다.
- `do` phase는 `plan-synthesis.json`의 실행 메타가 아니라 `output`만 implementation plan으로 사용해야 한다.
