---
id: WF-6
title: Plan Synthesis Provider Validation
type: workflow
date: 2026-04-26
validated_by: [BUI-118, BUI-349]
tags: [provider, plan_synthesis, validation, smoke, regression]
---

## 패턴 설명

`plan_synthesis` phase를 수정할 때는 입력 payload, canonical output, runner activation, downstream `do` 주입, 실제 provider smoke 분리를 함께 검증한다.
기본 회귀 테스트는 fake provider와 파일 계약으로 고정하고, 실제 Codex smoke는 명시적 opt-in으로만 실행한다.

## 언제 사용하나

- `src/plan-synthesis.js`의 payload, output schema, markdown render, read/write path를 바꿀 때
- `scripts/plan-synthesis.js` 또는 `scripts/run.js`의 `plan_synthesis` 실행 조건을 바꿀 때
- `providers.plan_synthesis` 설정 또는 request parse error가 activation 판정에 영향을 줄 때
- `scripts/do.js`가 plan output을 읽어 prompt에 주입하는 방식을 바꿀 때
- `src/pipeline-runner.js`에서 Codex `outputSchema` 전달 또는 `structuredOutput` 반환 계약을 바꿀 때
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
8. `providers.plan_synthesis` 오타나 malformed `run-request.json`이 activation false로 숨겨지지 않고 `/built:run` 진입에서 실패하는지 확인한다.
9. stdout에 `plan_synthesis: enabled|disabled`가 남고 `state.json`에 `plan_synthesis_enabled`가 기록되는지 확인한다.
10. `scripts/do.js`가 canonical JSON의 `output`만 읽어 prompt에 주입하는지 확인한다.
11. fake Codex 표준 이벤트가 `phase: plan_synthesis`, `phase_end.result`, progress/result 파일 계약을 만족하는지 확인한다.
12. Codex structured output 경로에서는 app-server에 전달되는 `outputSchema`가 JSON Schema object 자체인지 확인한다.
    `{ schema: ... }` wrapper를 전달하지 않고, 최상위 `type`이 `"object"`인지 테스트로 고정한다.
13. plan synthesis schema가 Codex strict schema 조건인 `additionalProperties: false`와 모든 properties의 `required` 포함을 만족하는지 확인한다.
14. Codex provider가 최종 JSON text를 `structuredOutput`으로 반환하고, plan synthesis normalization이 provider-neutral 결과를 소비하는지 확인한다.
15. 기본 검증은 `npm test`, `npm test -- --unit`, `node scripts/smoke-codex-plan-synthesis.js`의 skip 동작 확인으로 마무리한다.
16. 실제 provider 확인이 필요할 때만 `BUILT_CODEX_PLAN_SYNTHESIS_SMOKE=1 node scripts/smoke-codex-plan-synthesis.js` 또는 `npm run test:smoke:codex:plan`을 실행한다.

## 주의사항

- 실제 Codex smoke는 인증과 로컬 app-server 상태에 의존하므로 기본 CI나 기본 테스트에 포함하지 않는다.
- `plan_synthesis`는 read-only phase다.
  파일 수정이나 implementation side effect는 `do` phase 범위로 남겨야 한다.
- activation 조건을 느슨하게 만들면 기존 `run` 사용자에게 새 provider 실패 모드가 생긴다.
- activation 오류를 false로 fallback하면 dogfooding 결과에서 `plan_synthesis`가 실제로 빠졌는지 알기 어렵다.
- `plan_synthesis_enabled`는 provider output schema가 아니라 runner state 관측 필드로 유지한다.
- `phase_end.result`가 비어 있으면 `standard-writer`가 최종 provider text를 결과 파일에 남기지 못할 수 있다.
- `do` phase는 `plan-synthesis.json`의 실행 메타가 아니라 `output`만 implementation plan으로 사용해야 한다.
- Codex `outputSchema` wrapper 회귀는 fake provider만으로는 놓칠 수 있다.
  provider unit test에서 app-server request payload를 직접 확인하고, release-blocking 변경에서는 opt-in real smoke evidence를 남긴다.
