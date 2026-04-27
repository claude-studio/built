---
id: WF-4
title: Provider Config Parser Validation
type: workflow
date: 2026-04-26
validated_by: [BUI-115, BUI-317, BUI-349, BUI-378]
tags: [provider, config, validation, regression]
---

## 패턴 설명

provider 설정 parser를 바꿀 때는 실행 provider를 실제로 호출하기 전에 설정 정규화, 기본값, fallback, sandbox 정책을 순수 함수 테스트로 고정한다.
provider 실행과 파일 산출물 검증은 후속 runner/E2E 단계에서 다루고, parser 단계에서는 설정 계약만 빠르게 실패하도록 만든다.

## 언제 사용하나

- `run-request.json` 또는 요청 설정 경로의 `providers` 필드를 바꿀 때
- provider 이름, model, timeout, sandbox 같은 provider 설정 키를 추가할 때
- `.built/config.json`의 `default_run_profile.providers` 같은 기본 실행 profile 계약을 바꿀 때
- phase별 default provider 또는 fallback 규칙을 바꿀 때
- `do`, `iter`, `check`, `report`, `plan_synthesis`의 sandbox 정책을 바꿀 때
- `providers.<phase>` key나 ProviderSpec field allowlist를 바꿀 때
- `/built:run`의 `run-request.json` 또는 provider config parse error 처리 방식을 바꿀 때
- standalone `do`, `check`, `iter`, `report`, `plan-synthesis`의 run-request 읽기 또는 provider fallback을 바꿀 때

## 단계

1. 관련 계약 문서 확인: `docs/contracts/provider-config.md`, `docs/contracts/provider-events.md`, `docs/roadmaps/provider-transition.md`.
2. 단축형 provider 문자열과 상세형 객체를 모두 테스트 fixture에 포함한다.
3. `providers` 필드가 없는 legacy 요청 파일을 fixture로 두고 Claude fallback을 검증한다.
4. phase 미설정 fallback이 `{ name: "claude" }`인지 확인한다.
5. 알 수 없는 provider 이름, 알 수 없는 필드, 잘못된 sandbox 값이 즉시 실패하는지 확인한다.
6. `plan_synthsis`처럼 알 수 없는 phase key가 `providers.<phase>` 경로를 포함해 실패하는지 확인한다.
7. ProviderSpec 객체에 알 수 없는 field가 있으면 해당 phase 경로와 허용 field 목록을 포함해 실패하는지 확인한다.
8. `do`, `iter`에서 `claude` 외 provider와 `read-only` sandbox 조합이 실패하는지 확인한다.
9. `check`, `report`, `plan_synthesis`에서 `read-only` sandbox가 허용되는지 확인한다.
10. parser 테스트는 외부 provider 실행, spawn mock, app-server 연결 없이 순수 함수로 유지한다.
11. config default profile을 바꿀 때는 `default_run_profile.providers`가 provider name 문자열만 허용하는지 확인한다.
12. `{ "name": "codex" }` 같은 ProviderSpec 객체가 config default profile에서 실패하는지 확인한다.
13. 문자열 Codex default profile을 run-request ProviderSpec으로 정규화할 때 `do`/`iter`는 `workspace-write`, `check`/`report`는 `read-only`가 되는지 확인한다.
14. `/built:run` 통합 테스트에서 malformed `run-request.json`과 provider config parse error가 phase script 실행 전에 실패하는지 확인한다.
15. 오류 출력에는 사용자가 고칠 수 있는 config path와 parser 원인이 포함되어야 한다.
16. standalone phase 테스트에서 malformed `run-request.json`이 `do`, `check`, `iter`, `report`, `plan-synthesis` 모두에서 exit code 1로 실패하는지 확인한다.
17. standalone phase 테스트에서 missing `run-request.json`이 기존 허용 fallback과 구분되는지 확인한다.
18. provider fallback 우선순위가 `/built:run`과 standalone phase 모두 `run-request.providers` → `.built/config.json.default_run_profile` → built default 순서인지 확인한다.

## 주의사항

- `providers` 부재는 오류가 아니라 기존 Claude 동작 유지로 처리한다.
- 새 provider를 추가할 때 기본값을 암묵적으로 바꾸지 않는다.
- 새 phase 또는 ProviderSpec field를 추가할 때 allowlist만 늘리고 문서와 테스트를 빼먹으면 오타 hard-fail 계약이 불완전해진다.
- 쓰기 phase sandbox 정책을 느슨하게 만들면 Codex adapter 연결 시 실패 원인이 늦게 드러난다.
- parser가 실제 파일 산출물을 쓰거나 provider subprocess를 호출하게 만들지 않는다.
- runtime에서 `provider`, `model`, `duration_ms` 메타를 기록하는 작업은 parser 검증과 분리해 후속 runner 계약으로 다룬다.
- `.built/config.json`의 `default_run_profile.providers`는 config 기본값이고, `run-request.json`의 `providers`는 실행 snapshot이다. 두 schema를 같은 fixture로 뭉개지 않는다.
- `run-request.json` parse error를 null request fallback으로 바꾸면 오타와 malformed snapshot이 legacy 동작처럼 보일 수 있다.
- standalone phase는 legacy 편의를 위해 missing `run-request.json` fallback을 유지할 수 있지만, malformed JSON을 같은 경로로 복구하면 `/built:run`과 phase 직접 실행의 provider 선택 계약이 다시 갈라진다.
