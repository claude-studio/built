---
id: WF-16
title: Provider Offline Test Group Validation
type: workflow
date: 2026-04-26
validated_by: [BUI-170]
tags: [provider, tests, ci, offline, comparison, smoke]
---

## 패턴 설명

provider 관련 회귀는 기본 전체 테스트와 real smoke 사이에 offline provider group을 둬서 좁힌다.
`npm run test:provider*` 명령은 provider adapter, file contract, fake provider E2E, comparison mode 회귀를 외부 provider 없이 실행하는 CI-ready 경로다.

## 언제 사용하나

- provider adapter, provider diagnostics, file contract, comparison mode 테스트를 추가하거나 재배치할 때
- CI에서 provider 관련 offline 회귀만 빠르게 돌릴 명령을 고를 때
- real provider smoke와 fake/offline provider 검증의 책임 경계를 다시 문서화할 때
- `scripts/run-tests.js`, `test/e2e/e2e-runner.js`, `docs/smoke-testing.md`의 테스트 명령 계층을 수정할 때

## 단계

1. 기본 테스트 경로를 유지한다.
   `npm test`는 전체 단위 테스트와 전체 fake E2E를 실행하고 외부 provider, login, 네트워크, 비용에 의존하지 않아야 한다.
2. provider 단위 테스트 그룹을 `scripts/run-tests.js --provider`로 분리한다.
   포함 기준은 `providers-*.test.js`, `provider-doctor.test.js`, `file-contracts.test.js`, `compare-providers.test.js`다.
3. provider file contract만 확인해야 할 때는 `npm run test:provider:contracts`를 사용한다.
   산출물 계약 필드가 깨졌는지 빠르게 좁히는 명령으로 유지한다.
4. provider fake E2E만 확인해야 할 때는 `npm run test:provider:e2e`를 사용한다.
   현재 기준은 파일명에 `provider`가 포함된 시나리오 04, 05다.
5. comparison mode만 확인해야 할 때는 `npm run test:provider:compare`를 사용한다.
   이 명령은 `comparison` parser와 `scripts/compare-providers.js` 회귀를 다룬다.
6. CI-ready provider 전체 회귀는 `npm run test:provider`로 실행한다.
   단위 provider group과 provider fake E2E를 모두 포함해야 한다.
7. real smoke는 포함하지 않는다.
   `npm run test:smoke:codex*`는 인증, 네트워크, 비용, app-server 상태에 의존하는 opt-in 경로로 남긴다.
8. 문서와 출력 이름을 같이 갱신한다.
   `docs/smoke-testing.md`의 명령 계층 표와 각 npm script가 실제 실행 범위와 맞아야 한다.

## 주의사항

- provider group을 넓힐 때는 offline 실행 가능 여부를 먼저 확인한다.
  실제 Claude/Codex 호출, 환경 변수 opt-in, CLI login 의존성이 있으면 `test:provider*`에 넣지 않는다.
- comparison mode 테스트는 real provider 품질 판정이 아니라 contract와 runner 회귀 방어선이다.
  실제 provider 동등성 평가는 opt-in smoke와 human review로 분리한다.
- `--filter provider`는 파일명 기반 선택이므로 provider E2E 파일명 변경 시 명령 결과가 빈 목록이 되지 않는지 확인한다.
- CI job에는 `npm test`와 `npm run test:provider`를 넣을 수 있지만 `npm run test:smoke:codex*`를 기본값으로 넣지 않는다.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "identifier": "WF-16",
  "name": "Provider Offline Test Group Validation",
  "about": "provider offline CI-ready test group validation"
}
```
