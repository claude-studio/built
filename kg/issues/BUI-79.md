---
id: BUI-79
title: "[도그푸딩] built:list 누락: token-generation-api"
type: issue
date: 2026-04-25
status: completed
agent: 개발
branch: bui-79
pr: https://github.com/claude-studio/built/pull/53
week: 4
tags: [dogfooding, registry, init, list]
keywords: [built list init registry token generation api feature 누락 등록 status planned]
---

## 목표

built:init 실행 후 built:list(built:status --list)를 실행했을 때 초기화한 feature가 목록에 표시되도록 init과 registry 연동을 수정한다.

## 구현 내용

scripts/init.js에 `registerFeatureInRegistry()` 함수를 추가했다.

- featureName이 주어질 때 .built/runtime/registry.json에 status=planned로 등록
- status.js formatList()가 registry.json 기반으로 목록을 출력하므로, init 시점에 registry에 등록하면 built:list에 즉시 반영됨
- 변경 파일: scripts/init.js 하나뿐

## 결정 사항

init 시점에 registry.json에 직접 등록하는 방식을 선택했다. status.js가 features/ 디렉토리를 스캔하는 방식도 검토했으나, registry.json이 SSOT(§5)이므로 init이 registry에 쓰는 것이 설계 일관성에 부합한다.

## 발생한 이슈

없음.

## 완료 기준 충족 여부

- built:init token-generation-api 실행 후 built:list 실행 시 token-generation-api가 목록에 표시됨 ✓
- init이 feature를 registry.json에 등록하도록 수정 ✓
- 기존 init 멱등성 유지: 이미 등록된 feature는 덮어쓰지 않음 ✓

## 재발 방지 포인트

- built:init은 단순히 디렉토리/파일 초기화만 하는 것이 아니라 registry.json에도 feature를 등록해야 built:list에 반영됨. 향후 init 관련 작업 시 반드시 registry.json 쓰기 여부를 확인할 것.
- status.js는 features/ 디렉토리가 아닌 registry.json을 SSOT로 사용하므로, feature 존재 여부를 파악하려면 registry.json을 봐야 함.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-79",
  "name": "[도그푸딩] built:list 누락: token-generation-api",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/53"},
  "actionStatus": "CompletedActionStatus"
}
```
