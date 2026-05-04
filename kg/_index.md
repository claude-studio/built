---
title: built KG Index
type: index
updated: 2026-05-04
---

# built Knowledge Graph

built 프로젝트의 작업 이력, 결정 사항, 목표, 일일 점검을 구조화한 KG.

## 폴더 구조

- [[issues/]] — 이슈별 완료/blocked/반려 이력
- [[decisions/]] — 아키텍처 결정 기록 (ADR)
- [[goals/]] — 프로젝트의 장기 목표와 성공 기준
- [[reviews/]] — 목표 정렬 여부를 점검하는 일일 리뷰
- [[agents/]] — 에이전트 활동 프로필
- [[workflows/]] — 반복 발견된 워크플로우 패턴

## 엔티티 타입

| 타입 | 설명 |
|------|------|
| issue | multica 이슈 처리 이력 |
| decision | 기술 결정 및 근거 |
| goal | 프로젝트의 북극성 목표 |
| review | 일일 점검 기록 |
| agent | 에이전트 활동 기록 |
| workflow | 검증된 워크플로우 패턴 |

## 관계 타입

- `supports_goal` — 이슈/결정이 어떤 목표를 직접 밀어주는지
- `drifts_from` — 리뷰에서 감지한 방향 이탈
- `corrected_by` — 이탈을 바로잡기 위한 액션
- `references` — 참조 관계
