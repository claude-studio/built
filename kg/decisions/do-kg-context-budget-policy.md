---
id: ADR-38
title: Do phase KG context budget policy
type: decision
date: 2026-04-27
status: accepted
context_issue: BUI-350
tags: [architecture, kg, do, prompt-budget, provider, failure-taxonomy]
---

## 컨텍스트

Do phase는 구현에 필요한 project memory를 얻기 위해 KG를 prompt에 포함한다.
초기에는 KG 규모가 작아 `kg/issues`와 `kg/decisions` 전체 본문 포함을 허용했지만, dogfooding 이력이 쌓이면서 issue/decision 문서 수가 계속 증가했다.
그 결과 Run 시점 prompt가 repo history에 비례해 커지고 provider context limit, 비용, latency 위험이 커졌다.

## 결정

Do phase KG context는 provider adapter가 아니라 `scripts/do.js` control plane의 bounded selector와 문자 budget으로 제한한다.

항상 포함할 기준 문서는 north-star와 Do/Run/provider 검증에 필요한 핵심 workflow로 제한한다.
나머지 KG는 feature spec, plan synthesis output, run request, provider 설정에서 추출한 BUI 번호, 파일 경로, provider/phase 키워드, frontmatter `tags`, `keywords`, `context_issue`, `kg_files`에 따라 관련성을 계산한다.

관련성이 높은 소수 문서만 full body로 포함하고, 비관련 issue/decision/workflow는 bounded index로 축약한다.
prompt budget은 `BUILT_DO_PROMPT_WARN_CHARS`와 `BUILT_DO_PROMPT_MAX_CHARS` 문자 기준으로 둔다.
budget 초과는 provider 실행 후 opaque context overflow로 맡기지 않고 Do 진입 전 경고 또는 명확한 실패로 처리한다.

provider가 실제 context 초과 메시지를 반환하면 공통 failure taxonomy에서 `kind=model_response`, `code=provider_context_limit_exceeded`, `retryable=false`, `blocked=true`로 분류한다.

## 근거

- KG 선별은 provider CLI 실행 세부가 아니라 built control plane의 prompt 구성 책임이다.
- provider별 context limit과 tokenization은 자주 변하고 모델별 차이가 크므로 hardcoded max token table은 유지보수 비용과 회귀 위험이 크다.
- 관련 문서 full body와 bounded index를 병행하면 durable memory의 발견 가능성을 유지하면서 prompt 크기 증가를 제한할 수 있다.
- context overflow를 공통 failure code로 수렴하면 Claude, Codex, future provider에서 사용자 조치가 같은 형태로 노출된다.

## 결과

- `scripts/do-kg-context.js`가 Do phase KG selector와 budget metadata 생성을 담당한다.
- `scripts/do.js`는 KG 전체 본문 append 대신 selector 결과를 prompt에 포함한다.
- budget warning/error와 selector 통계가 Do 실행 전에 관측 가능해졌다.
- `src/providers/failure.js`는 provider context limit 계열 메시지를 `provider_context_limit_exceeded`로 분류한다.

## 대안

- KG 전체 본문 포함 유지: repo history 증가에 따라 prompt가 계속 선형으로 커져 선택하지 않았다.
- provider adapter별 KG pruning: provider별 prompt 구성 차이가 생기고 provider-agnostic control plane 목표와 맞지 않아 선택하지 않았다.
- provider별 max token table hardcode: 모델 변경과 provider 정책 변화에 취약해 선택하지 않았다.
- KG를 runtime state로 복사해 별도 SSOT로 사용: 문서층 KG와 runtime artifact 계층을 섞으므로 선택하지 않았다.

## 되돌릴 조건

KG가 별도 검색 index나 embedding 기반 retriever를 갖추고, 검색 결과와 budget metadata가 파일 계약으로 검증되면 selector 구현은 교체할 수 있다.
그 경우에도 Do phase KG context 제한 책임은 provider adapter가 아니라 control plane에 남긴다.

provider가 안정적인 공식 context-limit error code를 제공하면 문자열 classifier는 provider code 기반 mapping으로 바꿀 수 있다.
외부 failure taxonomy의 `provider_context_limit_exceeded` code와 사용자-facing action은 유지한다.
