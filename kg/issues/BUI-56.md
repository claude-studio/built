---
id: BUI-56
title: "[KG] workflows/ + agents/ 초기 엔트리 작성 — KG 공백 해소"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-56
pr: null
week: 2
tags: [kg, documentation, workflow, agent]
keywords: [KG workflows agents 초기 엔트리 공백 해소 프로필 스키마]
---

## 목표

BUI-41에서 발견된 KG 공백 해소:
- kg/workflows/: _index.md에 'workflow' 타입 선언됐으나 엔트리 없음
- kg/agents/: _index.md에 'agent' 타입 선언됐으나 실제 엔트리 미작성

반복 확인된 패턴과 에이전트 프로필을 문서화하여 KG를 실질적인 운영 지식 베이스로 만든다.

## 구현 내용

kg/workflows/ 엔트리 2개 신규 작성:
- feature-development-loop.md (WF-1): Plan→Do→Check→Iter→Report 전체 루프 패턴
- kg-review-and-backlog.md (WF-2): KG 검토 및 backlog 보충 워크플로우 패턴
- _index.md 신규 작성

kg/agents/ 엔트리 3개 신규 작성:
- cto.md: CTO 에이전트 프로필 (조율, 위임, 에스컬레이션)
- 개발.md: 개발 에이전트 프로필 (구현 담당)
- 리뷰.md: 리뷰 에이전트 프로필 (PR 검토)
- _index.md 신규 작성

_schema.md workflow 타입: BUI-45에서 이미 추가되어 있어 변경 불필요 (리뷰에서 확인)
main 브랜치 직접 커밋 (43d95e2) 및 push

## 결정 사항

- PR 없이 main 직접 커밋: 순수 KG 문서 작업으로 코드 변경 없음, PR 불필요로 판단
- _schema.md workflow 타입 이미 존재: BUI-45에서 선행 추가되어 중복 수정 불필요

## 발생한 이슈

없음 (1회차 리뷰 통과)

## 완료 기준 충족 여부

- kg/workflows/ 최소 2개 엔트리 작성 — 충족 (WF-1, WF-2)
- kg/agents/ 최소 3개 에이전트 프로필 작성 — 충족 (cto, 개발, 리뷰)
- _schema.md workflow 타입 스키마 추가 — 충족 (BUI-45에서 기존 추가)
- _index.md 업데이트 — 충족 (각 서브폴더 _index.md 신규 작성)
- kg/ main 브랜치 직접 커밋 — 충족 (커밋: 43d95e2)

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-56",
  "name": "[KG] workflows/ + agents/ 초기 엔트리 작성 — KG 공백 해소",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": null},
  "actionStatus": "CompletedActionStatus"
}
```
