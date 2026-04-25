---
id: ADR-12
title: 명시적 provider 비교 모드 경계
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-137
tags: [architecture, provider, comparison, worktree, report]
---

# 명시적 provider 비교 모드 경계

## 컨텍스트

기본 실행은 한 phase에 provider 하나만 사용한다. 다만 품질 최적화나 고위험 변경에서는 같은 입력을 Claude와 Codex에 각각 실행해 결과를 비교하고 싶은 요구가 있다.

이 요구를 기존 `providers.<phase>` 설정에 섞으면 기본 provider routing이 "단일 provider 선택"인지 "여러 provider 비교"인지 불명확해진다. 또한 같은 worktree와 같은 output directory를 공유하면 provider별 결과와 diff가 서로 덮어써질 수 있다.

## 결정

provider 비교는 기본 실행 경로와 분리된 명시적 실험 모드로 둔다.

- `/built:run`과 `node scripts/run.js <feature>`는 계속 phase마다 provider 하나만 실행한다.
- 비교 모드는 `comparison.enabled: true`와 비교 전용 명령이 모두 있을 때만 실행한다.
- 비교 설정은 top-level `comparison` 필드에 둔다. 기존 `providers` 필드는 phase별 단일 provider 선택 계약으로 유지한다.
- candidate마다 별도 branch, 별도 worktree, 별도 output root를 사용한다.
- 모든 candidate는 같은 `base_ref`, 같은 input snapshot, 같은 acceptance criteria, 같은 verification plan으로 실행한다.
- 결과는 `report.md`, `diff.patch`, `verification.json` 중심으로 남기고 자동 winner 선택이나 자동 merge는 하지 않는다.

상세 설계와 최소 CLI/API 스펙은 `docs/ops/provider-comparison-mode.md`를 따른다.

## 선택안

### 선택: 비교 전용 명령과 top-level `comparison` 필드

기본 provider config를 보존하면서 실험 모드를 명확히 분리할 수 있다.
provider별 worktree/output directory를 강제하기 쉽고, report를 사람이 검토하는 evidence로 남기기 좋다.

### 기각: `providers.do`를 배열로 확장

기존 `providers.<phase>`가 단일 ProviderSpec이라는 계약을 흐린다.
기본 runner와 비교 runner의 activation 조건이 같은 필드에 섞여 하위 호환성 리스크가 커진다.

### 기각: 같은 worktree에서 provider를 순차 실행

두 번째 provider가 첫 번째 provider의 diff와 산출물을 입력으로 볼 수 있다.
rollback과 결과 attribution이 불가능해져 비교 evidence로 신뢰하기 어렵다.

### 기각: 자동 winner 선택

검증 명령 통과 여부만으로 품질, 유지보수성, acceptance criteria 해석 차이를 판단하기 어렵다.
현재 단계에서는 사람이 report와 diff를 검토하는 방식이 north-star의 관측 가능성과 복구 가능성 원칙에 맞다.

## 리스크

- 비교 전용 output root를 구현하지 않으면 canonical phase result가 덮어써질 수 있다.
- real provider 비교를 기본 테스트에 넣으면 인증, 네트워크, 비용 상태가 기본 회귀 신호를 오염시킨다.
- 병렬 실행은 provider broker, local git worktree, quota 충돌을 만들 수 있다.
- `comparison` 필드를 기본 validator가 unknown key로 처리할지, 비교 명령 전용 schema에서만 허용할지 구현 시 명확히 해야 한다.

## 필요한 검증

- provider config parser 테스트: 기존 `providers.<phase>` 단일 provider 계약이 유지되는지 확인한다.
- comparison parser 테스트: `comparison.enabled`, candidate id, phase, provider spec, verification command를 검증한다.
- fake provider E2E: candidate별 worktree/output/log/result/diff가 분리되는지 확인한다.
- file contract 회귀 테스트: 기본 `.built/runtime/runs/<feature>/state.json`과 `.built/features/<feature>/` 결과가 비교 실행으로 덮어써지지 않는지 확인한다.
- real provider smoke: Claude/Codex 실제 비교는 명시적 환경 변수와 별도 스크립트로만 실행한다.

## 되돌릴 조건

비교 모드가 기본 provider routing보다 더 자주 쓰이고 provider별 결과가 안정적으로 동등한 파일 계약을 만족한다는 운영 근거가 쌓이면, 별도 ADR로 기본 runner 통합 여부를 재검토한다.

그 경우에도 단일 phase 기본 실행, provider별 output 격리, 자동 winner 미선정 원칙은 별도 승인 전까지 유지한다.
