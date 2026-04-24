---
id: WF-2
title: KG 검토 및 Backlog 보충
type: workflow
date: 2026-04-25
validated_by: [BUI-41, BUI-50, BUI-32]
tags: [pattern, kg, backlog, automation]
---

## 패턴 설명

오토파일럿이 주기적으로 생성하는 "KG 검토 및 개선 backlog 보충" 이슈를 처리하는 루프.
CTO 에이전트가 KG 전체와 코드베이스를 읽고 미구현/드리프트 항목을 새 backlog 이슈로 생성한다.

## 언제 사용하나

- 오토파일럿 스케줄에 의해 자동 트리거 (현재 주기 미정)
- backlog가 바닥나거나 프로젝트 방향 재점검이 필요할 때

## 단계

1. **KG 전체 읽기** — kg/issues/, kg/decisions/ 전체 파일 읽기
   - `ls ~/Desktop/jb/built/kg/issues/` → 각 파일 내용 확인
   - `ls ~/Desktop/jb/built/kg/decisions/` → 각 파일 내용 확인
2. **BUILT-DESIGN.md 읽기** — 설계 스펙과 현재 구현 간 드리프트 감지
3. **README.md 읽기** — 구현 현황 문서와 실제 코드 상태 비교
4. **기존 이슈 전체 조회** — 중복 방지
   - 상태별로 backlog/todo/in_progress/done 모두 조회
5. **개선 항목 선별** — 이미 다뤄진 항목 제외, 신규 항목만 선별
6. **backlog 이슈 생성** — 항목당 1개, 중복 없이
   - `multica issue create --title "..." --status backlog --priority <우선순위>`
7. **결과 comment 작성** — 생성한 이슈 목록 + 개수
8. **done 처리 + 텔레그램 알림** — 신규 backlog 수 포함
9. **즉시 위임 (조건부)** — 신규 backlog >= 1이면 바로 이슈 선정 및 위임 루프 진입

## 주의사항

- KG 공백(엔트리 없는 폴더, 스키마 불일치)은 반드시 backlog 이슈로 생성
- 이미 backlog/todo/in_progress에 동일 내용 이슈가 있으면 중복 생성 금지
- 신규 backlog 0개이면 종료 (할 일 없음 — 이상 아님)
- 텔레그램 알림은 신규 backlog가 없어도 반드시 전송
