---
id: BUI-41
title: "[KG] KG Control Plane 강화 — 진단 및 백로그 도출"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-41
pr: https://github.com/claude-studio/built/pull/25
week: 4
tags: [kg, architecture, diagnosis, check]
---

## 목표

현재 `built`가 가지고 있는 KG(knowledge layer) 사용 방식을 진단하고, KG를 단순 참고 문서가 아닌 control plane으로 강화하기 위한 분석 및 최소 구현을 수행한다.

## 구현 내용

- `src/kg-checker.js` 신규 작성 (deps 0, Node.js 표준 라이브러리만 사용)
  - `checkKg()` API: frontmatter 필수 필드 누락, dangling context_issue, schema-gap, schema-asymmetry 검사
- `scripts/check.js` 수정
  - kg-checker 호출 추가
  - `check-result.md`에 `## KG 일관성` 섹션 추가 (비차단: approved/needs_changes 판정에 영향 없음)

## 결정 사항

- KG update 훅 위치: `completed`(state.json status=completed) 시점이 적합. approved(check 판정) 시점은 아직 pipeline이 완료되지 않았으므로 부적절. `report.js` 완료 직후가 트리거 지점.
- KG 일관성 검사는 비차단으로 구현. KG baseline이 정리되기 전까지 blocking 조건으로 격상하지 않음.
- `kg/*`와 `.built/*`는 별개 레이어로 유지. 통합은 Next Step.

## 발생한 이슈

**진단 중 발견된 버그 (P2/P3):**

- `progress.json` 경로 불일치:
  - 쓰기: `.built/features/<feature>/progress.json` (progress-writer.js)
  - 읽기: `.built/runtime/runs/<feature>/progress.json` (run.js 비용 경고)
  - 결과: run.js의 $1.0 비용 경고가 실제로 동작하지 않음
- `state.json` 이중화:
  - `.built/runtime/runs/<feature>/state.json` (orchestrator, state.js 관리)
  - `.built/features/<feature>/state.json` (phase, progress-writer.js 관리)
  - SSOT 불명확

**schema-index 비대칭:**
- `_index.md`: agents/ 타입 선언
- `_schema.md`: agent 타입 정의 없음
- `kg/agents/`: 디렉토리 존재, 엔트리 없음 (스키마-인덱스 비대칭 + 엔트리 공백)
- `kg/workflows/`: 디렉토리 존재, 엔트리 없음 (스키마 선언됨, 실사용 공백)

## 완료 기준 충족 여부

- [x] 분석 6개 섹션(0~6) 모두 작성
- [x] 실제 코드 수정 1 PR 범위 내 (src/kg-checker.js, scripts/check.js)
- [x] BUILT-DESIGN.md 스펙 준수 (외부 deps 0)
- [x] KG findings 비차단 구현 확인
- [x] progress.json / state.json 이중화 버그 진단 및 Next Step 분리
- [x] kg/* 와 .built/* 레이어 구분 명확히 유지
- [x] 리뷰 통과 (1회차)

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-41",
  "name": "[KG] KG Control Plane 강화 — 진단 및 백로그 도출",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/25"},
  "actionStatus": "CompletedActionStatus"
}
```
