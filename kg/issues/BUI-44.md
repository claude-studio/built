---
id: BUI-44
title: "[KG] report.js 완료 후 kg/ 자동 갱신 훅 (completed 시점 트리거)"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-44
pr: https://github.com/claude-studio/built/pull/34
week: 1
tags: [kg, report, automation, hook, completed]
---

## 목표

report.js 완료(state.json status=completed) 시점에 kg/issues/<feature-id>.md 초안을 자동 생성하여 CTO가 수동으로 KG를 갱신하는 누락 위험을 방지한다.

## 구현 내용

- `src/kg-updater.js` 신규 생성
  - feature spec frontmatter + do-result.md + check-result.md 기반으로 kg/issues/<ID>.md 초안 생성
  - `generateKgDraft(featureId, workDir)` 함수 export
  - specData.week 필드 우선 참조, 없을 때만 isoWeek() 폴백
  - fs/path 내장 모듈만 사용 (외부 deps 0 원칙 준수)
- `scripts/report.js` 수정
  - 완료 직후(173번 라인) generateKgDraft() 호출 추가
- 안전 장치
  - 기존 엔트리 존재 시 덮어쓰기 금지 (fs.existsSync 체크 후 skip + warn)
  - kg/ 디렉토리 없거나 파일 없어도 warn + return으로 graceful 처리

## 결정 사항

- KG 갱신 훅 위치를 approved(check) 시점이 아닌 completed(state) 시점으로 결정
  - 근거: report.md 생성 후 state=completed가 되므로 이 시점에 KG 갱신 정보가 가장 완전하다
- weekNum을 isoWeek(연간 주차) 대신 spec frontmatter의 week 필드에서 읽도록 수정 (1회차 반려 후)
  - 근거: KG 엔트리의 week 값은 캘린더 주차(1~52)가 아닌 프로젝트 로드맵 주차(1~4)를 의미

## 발생한 이슈

- 1회차 리뷰 반려: weekNum 계산 오류
  - 기존: const weekNum = isoWeek(new Date()); // 연간 ISO 주차 반환 (예: 4/24 → 17)
  - 수정: const weekNum = specData.week || isoWeek(new Date()); // spec frontmatter week 우선 참조
  - 동일 날짜(2026-04-24) 기존 KG 엔트리들이 week:1, week:4 등 다른 값을 가지므로 캘린더 계산 불가
- 2회차 리뷰 통과

## 완료 기준 충족 여부

1. src/kg-updater.js 신규 생성 - 충족
2. scripts/report.js 완료 직후 generateKgDraft() 호출 - 충족
3. 기존 엔트리 덮어쓰기 금지 (존재하면 skip + 경고) - 충족
4. kg/ 없거나 파일 없어도 오류 없이 동작 - 충족
5. 외부 npm 패키지 없음 (fs/path 내장만 사용) - 충족

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-44",
  "name": "[KG] report.js 완료 후 kg/ 자동 갱신 훅 (completed 시점 트리거)",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/34"},
  "actionStatus": "CompletedActionStatus"
}
```
