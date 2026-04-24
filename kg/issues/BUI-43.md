---
id: BUI-43
title: "[KG] do 단계 프롬프트에 kg/decisions + kg/issues 컨텍스트 주입"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-43
pr: https://github.com/claude-studio/built/pull/33
week: 1
tags: [kg, do-phase, prompt, context-injection]
keywords: [kg, do, phase, prompt, context, injection, 주입, 컨텍스트]
---

## 목표

scripts/do.js 실행 시 kg/decisions/*.md + kg/issues/*.md 컨텍스트를 프롬프트에 주입하여 파이프라인이 기존 아키텍처 결정과 일관된 코드를 생성하도록 개선한다.

## 구현 내용

- `loadMdFiles` 헬퍼 함수 추가 (fs/path 내장 모듈만 사용)
- kg/decisions/*.md 전체 로드
- kg/issues/*.md 전체 포함
- 프롬프트에 `## Prior Decisions (kg/)` 섹션 추가
  - Architecture Decisions 서브섹션 (decisions/)
  - Issue History 서브섹션 (issues/)
- kg/ 디렉토리 없거나 파일 없을 때 existsSync + try/catch로 graceful skip

## 결정 사항

- 관련성 필터링 없이 전체 포함 방식 채택: 단순 매칭보다 일관성이 높고 KG가 아직 소규모이므로 컨텍스트 비용 허용
- 외부 npm 패키지 없음 원칙 유지 (fs/path 내장만 사용)

## 발생한 이슈

없음 (1회차 리뷰 통과)

## 완료 기준 충족 여부

1. scripts/do.js에서 feature spec 로딩 후 kg/decisions/*.md 전체 로드 - 충족
2. 관련 kg/issues/*.md 로드 (전체 포함) - 충족
3. 프롬프트에 ## Prior Decisions (kg/) 섹션 추가 - 충족
4. 외부 npm 패키지 없음 - 충족
5. kg/ 없거나 파일 없어도 graceful skip - 충족

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-43",
  "name": "[KG] do 단계 프롬프트에 kg/decisions + kg/issues 컨텍스트 주입",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/33"},
  "actionStatus": "CompletedActionStatus"
}
```
