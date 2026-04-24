---
title: built KG Index
type: index
updated: 2026-04-24
---

# built Knowledge Graph

built 프로젝트의 작업 이력, 결정 사항, 에이전트 활동을 구조화한 KG.

## 폴더 구조

- [[issues/]] — 이슈별 완료/blocked/반려 이력
- [[decisions/]] — 아키텍처 결정 기록 (ADR)
- [[agents/]] — 에이전트 활동 프로필
- [[workflows/]] — 반복 발견된 워크플로우 패턴

## 엔티티 타입

| 타입 | 설명 |
|------|------|
| issue | multica 이슈 처리 이력 |
| decision | 기술 결정 및 근거 |
| agent | 에이전트 활동 기록 |
| workflow | 검증된 워크플로우 패턴 |

## 관계 타입

- `implemented_by` — 이슈를 구현한 에이전트
- `blocked_by` — blocked 원인
- `decided_because` — 결정 근거
- `led_to` — 결정이 만들어낸 결과
- `references` — 참조 관계
