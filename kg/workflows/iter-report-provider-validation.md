---
id: WF-11
title: Iter/Report Provider Validation
type: workflow
date: 2026-04-26
validated_by: [BUI-166]
tags: [provider, iter, report, validation, regression]
---

## 패턴 설명

`iter`와 `report` phase에 provider opt-in을 연결할 때는 phase별 기본 provider를 바꾸지 않고, fallback 우선순위와 산출물 frontmatter 메타가 실제 실행 provider와 일치하는지 같이 검증한다.
`iter`는 do 산출물을 다시 쓰는 수정 루프이고, `report`는 최종 요약 산출물이므로 sandbox와 기본 모델 정책을 서로 다르게 고정해야 한다.

## 언제 사용하나

- `providers.iter` 또는 `providers.report` 설정 경로를 추가하거나 바꿀 때
- `do -> check -> iter -> report` 루프에서 provider 설정 전달 방식을 바꿀 때
- `report.md` frontmatter의 `provider`, `model`, `duration_ms`, optional usage/cost 메타를 바꿀 때
- provider routing matrix에서 `iter` 또는 `report` 기본값과 opt-in 정책을 재검토할 때

## 단계

1. `docs/contracts/provider-config.md`와 `docs/ops/provider-routing-matrix.md`에서 phase별 기본값과 sandbox 정책을 확인한다.
2. `providers.iter` 단축형과 상세형이 `runPipeline({ phase: "iter", providerSpec })`으로 전달되는지 검증한다.
3. `providers.iter`가 없고 `providers.do`가 있으면 do providerSpec을 fallback으로 쓰는지 검증한다.
4. `providers.iter`와 `providers.do`가 모두 없는 legacy run-request가 Claude 기본값을 유지하는지 검증한다.
5. Codex `iter`에 `sandbox: "read-only"`를 지정하면 parser 단계에서 명확히 실패하는지 검증한다.
6. iter 루프 안의 check 재실행이 `scripts/check.js` subprocess와 동일 run-request를 통해 `providers.check`를 유지하는지 검증한다.
7. `providers.report` 단축형과 상세형이 report 실행 providerSpec과 model에 반영되는지 검증한다.
8. `providers.report`가 없으면 Claude + 저비용 기본 모델 흐름이 유지되는지 검증한다.
9. `report.md` frontmatter의 `provider`와 `model`이 실제 report 실행 providerSpec과 모순되지 않는지 검증한다.
10. usage/cost가 없는 provider에서도 status/report 산출물 계약이 깨지지 않는지 확인한다.

## 주의사항

- `iter`는 `check`와 달리 결과 파일을 다시 쓰는 phase다.
  Codex read-only sandbox 허용을 `iter`까지 넓히지 않는다.
- `iter` fallback에서 `providers.do`를 건너뛰면 Codex do 이후 수정 루프가 Claude로 되돌아가 cross-provider 의도가 바뀔 수 있다.
- `providers.check` 설정을 iter가 별도 상태로 복사하지 않는다.
  check subprocess가 같은 `run-request.json`을 읽는 구조를 SSOT로 유지한다.
- `report`의 provider/model frontmatter는 실행 메타다.
  optional usage/cost 부재를 실패로 해석하거나 필수 산출물 계약으로 승격하지 않는다.
- provider subprocess가 `report.md` 또는 `do-result.md`를 직접 쓰게 하지 않는다.
  최종 산출물 기록은 phase script와 runner/writer 경계에 남긴다.
