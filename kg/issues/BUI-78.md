---
id: BUI-78
title: "[도그푸딩] built:init 실패: token-generation-api"
type: issue
date: 2026-04-25
status: completed
agent: 개발
branch: bui-78
pr: https://github.com/claude-studio/built/pull/52
week: 4
tags: [dogfooding, init, feature-spec, bug-fix]
keywords: [init, feature, feature-spec, 디렉토리, 생성, token, generation, api]
---

## 목표

`built:init <feature>` 실행 시 `.built/features/<feature>/feature-spec.md`가 자동 생성되지 않는 버그 수정.

## 구현 내용

- `scripts/init.js`: `process.argv[3]`으로 featureName 수신, `featureSpecMd()` 템플릿 함수 추가, `.built/features/<feature>/feature-spec.md` 생성 로직 추가
- `skills/init/SKILL.md`: feature 인자 추출 및 스크립트 호출 예시 문서화
- 멱등성 유지: 이미 초기화된 프로젝트에서도 feature-spec.md만 추가 생성 가능 (`writeIfAbsent` 내부 `ensureDir` 활용)

## 결정 사항

- `writeIfAbsent` 패턴 유지 (덮어쓰기 방지)
- feature-spec.md 템플릿은 BUILT-DESIGN.md §7 frontmatter 전체 필드 포함: feature, version, created_at, confirmed_by_user, status, tags, primary_user_action, persona, success_criteria, includes, excludes, anti_goals, architecture_decision, build_files, constraints

## 발생한 이슈

- `multica issue assign --to '개발'` 실행 시 '개발'(d5861ee8)과 '도그푸딩 개발'(bac78219) 두 에이전트가 동시 매칭되어 ambiguous 오류 발생 → 사용자가 '도그푸딩 개발' → '도그봇'으로 이름 변경 후 해결

## 완료 기준 충족 여부

- built:init token-generation-api 실행 시 .built/features/token-generation-api/feature-spec.md 생성: 충족
- .built/features/ 디렉토리 생성: 충족
- feature-spec.md 내용 BUILT-DESIGN.md §7 기준 기본 템플릿 포함: 충족
- 외부 deps 0 (Node.js fs/path 표준 라이브러리만 사용): 충족

## 재발 방지 포인트

- 에이전트 이름에 다른 에이전트 이름의 substring이 포함되면 `--to` 매칭 시 ambiguous 오류 발생 → 에이전트 이름은 고유하게 유지해야 함 (특히 '개발', '리뷰' 등 단어 포함 주의)
- init 스킬은 공통 구조 생성과 feature별 디렉토리/파일 생성을 동시에 처리해야 함 — feature 인자가 없으면 공통 구조만, 있으면 feature-spec.md도 함께 생성

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-78",
  "name": "[도그푸딩] built:init 실패: token-generation-api",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/52"},
  "actionStatus": "CompletedActionStatus"
}
```
