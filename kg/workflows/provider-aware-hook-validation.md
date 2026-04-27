---
id: WF-12
title: Provider-aware Hook Validation
type: workflow
date: 2026-04-26
validated_by: [BUI-233, BUI-347]
tags: [hooks, provider, security, contracts, validation]
---

## 패턴 설명

provider-aware hook 계약을 바꿀 때는 hook payload, 민감정보 제외, hook 실패 정책을 한 묶음으로 검증한다.
핵심은 hook이 provider 실행 맥락을 읽을 수 있게 하되 provider raw event, provider file contract, secret 후보를 hook 프로세스로 넘기지 않는 것이다.

## 언제 사용하나

- `src/hooks-runner.js`의 `runHooks()` 옵션, hook env 구성, hook point 목록을 바꿀 때
- `docs/contracts/provider-events.md`의 Hook Payload 정책이나 hook 실패 영향 테이블을 바꿀 때
- `scripts/hooks-inspect.js`의 hook point 목록이나 출력 힌트를 갱신할 때
- hook 실패가 check/result/report 산출물에 미치는 영향을 수정할 때
- provider context 필드나 model/status/failure summary 표현을 확장할 때
- Do/Check 전후 hook halt를 iter 복구 흐름으로 연결하거나 `check-result.md` synthetic artifact를 만들 때

## 단계

1. `docs/contracts/provider-events.md`의 Hook Payload 정책과 `kg/decisions/provider-aware-hook-context-policy.md`를 먼저 확인한다.
2. 새 provider context 필드는 `BUILT_*` 환경변수로만 노출하고 raw provider event 객체는 넘기지 않는다.
3. `providerContext`를 전달하지 않는 기존 호출자가 빈 문자열 기반으로 계속 동작하는지 확인한다.
4. hook condition 표현식 변경이 필요한지 별도 판단한다.
   기본 정책은 `feature.*`, `check.*`만 condition에서 지원하고 provider context는 환경변수로 읽는 것이다.
5. `buildHookEnv()`가 `_KEY`, `_SECRET`, `_TOKEN`, `_PASSWORD`, `_CREDENTIAL`, `_PRIVATE_KEY`, `_CLIENT_SECRET`, `_AUTH_TOKEN`, `_REFRESH_TOKEN`, `_ACCESS_TOKEN` 접미어 env를 제외하는지 fixture를 추가한다.
6. `BUILT_FAILURE_SUMMARY`에는 raw stderr, token, private environment value가 들어가지 않는 요약만 전달한다.
7. `halt_on_fail`과 hook point 조합별로 pipeline 중단, check result 강제 변경, report 진행 여부가 계약 문서와 맞는지 확인한다.
8. `before_do`, `after_do`, `before_check`의 `halt_on_fail: true`는 exit code 1만으로 끝내지 않고 `check-result.md` `status: needs_changes`와 `[hook-failure]` issue로 iter에 전달되는지 확인한다.
9. hook halt가 새 `check-result.md`를 만들면 `feature`, `status`, `checked_at`, `provider`, `model`, `duration_ms`, `issues` frontmatter가 있는지 확인한다.
   실제 Check provider가 실행되지 않은 synthetic artifact에서는 `provider`/`model`은 `null`, `duration_ms`는 `0`이어야 한다.
10. halt 주입 경로와 warning 주입 경로가 모두 존재하는 hook point에서는 같은 `[hook-failure]`가 중복 기록되지 않는지 확인한다.
11. `before_report`의 `halt_on_fail: true`는 iter 복구로 가장하지 않고 Report 전 hard halt로 유지되는지 확인한다.
12. `scripts/hooks-inspect.js`가 실제 `HOOK_POINTS`와 같은 hook point를 보여주는지 확인한다.
13. 테스트는 최소 `test/hooks-runner.test.js`와 `test/run.test.js`를 실행하고, provider event 계약 문서를 바꿨다면 관련 문서/KG 민감정보 점검도 함께 실행한다.
14. PR handoff에는 provider-aware context 필드, hook 실패 정책 변경, 민감정보 제외 범위, 기존 hook 호환 위험을 명시한다.

## 주의사항

- hook은 외부 webhook 서비스가 아니며 provider 파일 계약을 직접 쓰는 계층도 아니다.
- provider context를 hook env에 추가하는 것과 provider event/state/log writer 계약을 바꾸는 것은 별도 변경으로 취급한다.
- secret이 필요한 사용자 hook은 hook 전용 설정에서 명시적으로 읽게 한다.
  built 기본 env 전파로 provider token을 전달하지 않는다.
- `BUILT_PROVIDER_STATUS`는 hook 호출 시점의 provider run 상태 신호다.
  hook 실패 자체가 provider terminal event를 재작성한다는 의미로 쓰지 않는다.
- hook point 목록을 늘리면 runner, inspect, docs, tests를 함께 갱신한다.
- Do/Check 전후 hook halt는 `check-result.md` 단일 복구 채널을 사용한다.
  별도 hook feedback artifact나 provider terminal event로 우회하려면 iter 입력 계약을 먼저 갱신해야 한다.
- Report 직전 hook halt는 구현 피드백 복구가 아니므로 hard halt 정책을 유지한다.
