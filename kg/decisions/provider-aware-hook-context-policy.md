---
id: ADR-13
title: provider-aware hook context와 민감정보 제외 정책
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-233
tags: [hooks, provider, security, contracts, automation]
---

## 컨텍스트

built hook은 사용자 프로젝트 자동화를 실행하는 임의 프로세스다.
provider 전환 이후 hook이 어느 provider, phase, model, 완료 상태, 실패 요약에서 호출되었는지 알아야 사용자 프로젝트의 알림, 감사, 후처리 자동화를 정확히 붙일 수 있다.

반면 hook 프로세스는 provider runtime보다 신뢰 경계가 넓다.
`process.env`를 그대로 넘기면 provider API key, GitHub token, 외부 서비스 secret이 사용자 hook으로 암묵 전달될 수 있다.
또한 hook이 provider file contract를 직접 쓰기 시작하면 standard writer와 runner의 책임 경계가 흐려진다.

## 결정

provider-aware hook context는 `runHooks()`의 `providerContext` 옵션으로 받고, hook 프로세스에는 built 전용 환경변수로만 주입한다.

주입 필드는 다음으로 제한한다.

- `BUILT_PROVIDER`
- `BUILT_PHASE`
- `BUILT_PROVIDER_STATUS`
- `BUILT_FAILURE_SUMMARY`
- `BUILT_MODEL`

호출자가 `providerContext`를 전달하지 않으면 위 필드는 빈 문자열로 유지한다.
hook condition 표현식은 기존 `feature.*`, `check.*`만 지원하고 provider context 경로는 추가하지 않는다.

hook env는 민감 접미어를 제거한 `process.env`를 기반으로 만든다.
제외 접미어는 `_KEY`, `_SECRET`, `_TOKEN`, `_PASSWORD`, `_CREDENTIAL`, `_PRIVATE_KEY`, `_CLIENT_SECRET`, `_AUTH_TOKEN`, `_REFRESH_TOKEN`, `_ACCESS_TOKEN`이다.

hook 실패는 provider run의 terminal event나 provider file contract를 직접 재작성하지 않는다.
`halt_on_fail`과 hook point 조합별 pipeline 영향은 계약 문서의 Hook 실패 영향 테이블을 따른다.

## 근거

- hook은 provider event writer가 아니라 사용자 자동화 확장 지점이다.
  provider 상태를 알아야 하지만 provider raw event나 file contract를 직접 쓸 필요는 없다.
- built 전용 환경변수는 기존 command hook 구조와 호환되고, 외부 webhook 서비스나 별도 payload transport를 만들지 않아도 된다.
- `providerContext` 미전달 시 빈 문자열을 주입하면 기존 hook 설정과 테스트가 provider 전환과 무관하게 동작한다.
- condition 언어에 provider context를 넣으면 evaluator와 문서 계약이 늘어나므로, 이번 단계에서는 shell/script가 환경변수를 읽는 단순 경로가 더 작다.
- hook 프로세스는 사용자 임의 명령이므로 기본 env에서 secret 후보를 제거하는 것이 안전한 기본값이다.
  외부 서비스 secret이 필요한 hook은 hook 전용 설정으로 명시 주입해야 감사 가능하다.
- hook 실패가 provider terminal event를 뒤집으면 provider event log와 pipeline 산출물의 SSOT가 충돌한다.
  hook 실패 영향은 pipeline 단계별 정책으로 분리하는 편이 회귀를 줄인다.

## 결과

- hook은 provider, phase, status, failure summary, model을 환경변수로 읽을 수 있다.
- providerContext를 모르는 기존 호출자는 빈 문자열 필드를 받으므로 하위 호환을 유지한다.
- provider 인증 정보와 일반 token 접미어 환경변수는 hook payload에서 제외된다.
- `docs/contracts/provider-events.md`가 hook payload와 hook 실패 영향 정책의 기준 문서가 되었다.
- `scripts/hooks-inspect.js`는 provider-aware hook context가 있다는 힌트와 민감정보 미전달 기준을 보여준다.

## 대안

- provider event 전체를 hook payload로 넘긴다: raw provider event와 debug detail이 secret 후보를 포함할 수 있고 hook API가 provider별로 갈라질 위험이 있어 선택하지 않았다.
- hook이 provider file contract를 직접 쓰게 한다: standard writer 책임과 사용자 hook 책임이 섞여 progress/state/log 계약 drift가 생기므로 선택하지 않았다.
- condition 표현식에 `provider.*` 경로를 추가한다: 편의성은 있지만 evaluator 계약과 보안 표면이 커져 이번 범위에서는 선택하지 않았다.
- `process.env`를 그대로 전달하고 문서로만 주의시킨다: hook이 임의 프로세스인 이상 보안 기본값으로 부족해 선택하지 않았다.

## 되돌릴 조건

hook condition에서 provider-aware 분기가 반복적으로 필요해지면 별도 이슈에서 expression evaluator에 `provider.*` 경로를 추가할 수 있다.
그 경우 지원 필드, escaping, 민감정보 제외, 문서와 테스트를 함께 갱신해야 한다.

특정 hook 생태계가 기존 env token 암묵 전파에 강하게 의존한다면 opt-in allowlist를 별도 정책으로 검토할 수 있다.
기본값은 계속 secret 후보 제외로 유지한다.
