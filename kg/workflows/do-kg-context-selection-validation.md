---
id: WF-31
title: Do KG Context Selection Validation
type: workflow
date: 2026-04-27
validated_by: [BUI-350]
tags: [kg, do, prompt-budget, provider, regression]
---

## 패턴 설명

Do phase prompt 구성을 바꿀 때는 관련 KG context가 유지되는지와 전체 KG history가 prompt에 선형으로 붙지 않는지를 함께 검증한다.
KG selection은 provider adapter가 아니라 `scripts/do.js` control plane 경계에서 확인한다.

## 언제 사용하나

- `scripts/do.js`의 prompt 구성이나 KG append 경로를 바꿀 때
- `scripts/do-kg-context.js`의 scoring, frontmatter signal, include/index limit, budget 기준을 바꿀 때
- `kg/issues`, `kg/decisions`, `kg/workflows` 문서 구조나 frontmatter 필드를 바꿀 때
- provider context overflow failure 분류를 바꿀 때

## 단계

1. north-star와 provider 관련 workflow처럼 항상 포함해야 하는 KG 문서가 유지되는지 확인한다.
2. feature spec, `plan-synthesis.json`, run request, provider config에서 BUI 번호, 파일 경로, provider/phase 키워드가 추출되는지 확인한다.
3. frontmatter `tags`, `keywords`, `context_issue`, `kg_files`가 관련 문서 scoring에 반영되는지 테스트한다.
4. 관련 BUI와 ADR은 full body 후보로 포함되는지 확인한다.
5. 비관련 `kg/issues`, `kg/decisions`, `kg/workflows`는 전체 본문이 아니라 bounded index로 축약되는지 확인한다.
6. 대량 KG fixture에서도 full body 문서 수와 index 문서 수가 상수 제한을 넘지 않는지 확인한다.
7. `BUILT_DO_PROMPT_WARN_CHARS`와 `BUILT_DO_PROMPT_MAX_CHARS`가 warning과 hard failure를 각각 유발하는지 확인한다.
8. budget 초과 실패가 provider adapter 실행 전에 발생하는지 확인한다.
9. provider가 context limit 계열 오류를 반환하는 fixture는 `provider_context_limit_exceeded`로 분류되는지 확인한다.
10. 기본 검증은 `node test/do-kg-context.test.js`, `node test/providers-failure.test.js`, `node scripts/run-tests.js`로 마무리한다.

## 주의사항

- `kg/issues`, `kg/decisions`, `kg/workflows` glob 결과 전체를 prompt에 직접 append하는 경로를 만들지 않는다.
- provider별 token table을 먼저 추가하지 않는다. 문자 budget과 selector signal로 1차 방어선을 둔다.
- selector 통계는 디버그와 회귀 판단에 유용하지만 secret, token, private environment value를 포함하면 안 된다.
- context overflow raw provider message는 사용자-facing action에 그대로 노출하지 않는다.
