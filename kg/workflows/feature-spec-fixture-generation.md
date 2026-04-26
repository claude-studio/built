---
id: WF-11
title: Feature Spec Fixture Generation
type: workflow
date: 2026-04-26
validated_by: [BUI-232]
tags: [fixture, provider, frontmatter, contract, test]
---

## 패턴 설명

provider, check, iter, report 테스트에서 feature spec과 run-request fixture가 필요하면 `test/fixtures/feature-spec-generator.js`를 우선 사용한다.
fixture 생성과 계약 검증을 같은 helper에 모아 phase별 테스트가 입력 frontmatter drift가 아니라 실제 provider 동작 차이를 검증하게 한다.

## 언제 사용하나

- provider phase 테스트에서 `.built/features/<feature>.md`가 필요할 때
- `run-request.json`의 `providers` 변형을 테스트할 때
- do-result/check-result frontmatter 최소 계약을 테스트 fixture로 만들 때
- acceptance criteria, excludes, build_files를 바꾼 feature spec 입력이 필요할 때

## 단계

1. `makeFeatureSpecProject()`로 임시 project root와 feature spec 파일을 만든다.
2. feature id, acceptance criteria, excludes, build_files, status, created_at 같은 입력 차이는 `buildFeatureSpec()` 옵션으로 표현한다.
3. phase별 provider 변형은 `buildProviderConfig()` 또는 `buildCodexDoConfig()`로 만든 뒤 `writeRunRequest()`에 넘긴다.
4. fixture frontmatter를 직접 파싱해 검증하는 테스트는 `assertFeatureSpecFrontmatter()`, `assertDoResultFrontmatter()`, `assertCheckResultFrontmatter()`를 함께 호출한다.
5. 테스트 종료 시 `makeFeatureSpecProject()`가 반환한 `cleanup()`을 호출해 임시 디렉토리를 정리한다.

## 주의사항

- generator는 테스트 전용 helper이며 사용자-facing spec 생성 UX를 대체하지 않는다.
- `buildProviderConfig()`는 얕은 override를 수행한다.
  nested provider spec 일부를 바꾸는 테스트는 의도한 전체 nested object를 명시적으로 넘긴다.
- optional telemetry를 fixture 필수 계약으로 만들지 않는다.
  do-result/check-result의 최소 frontmatter 계약과 usage/cost optional 정책을 분리한다.
- 기존 테스트 fixture를 일괄 교체하기보다 provider/check/iter/report 테스트를 수정할 때 반복 fixture부터 점진적으로 흡수한다.
