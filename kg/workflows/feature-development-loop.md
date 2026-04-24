---
id: WF-1
title: Feature Development Loop
type: workflow
date: 2026-04-25
validated_by: [BUI-16, BUI-39, BUI-51]
tags: [pattern, pipeline, core]
---

## 패턴 설명

built 프로젝트에서 단일 feature를 처음부터 완료까지 처리하는 표준 루프.
CTO가 이슈를 생성하고 개발 에이전트에 위임하면, 구현→리뷰→완료 사이클이 자동으로 돌아간다.

## 언제 사용하나

- 새로운 기능 구현, 버그 수정, 문서화 등 모든 실행 이슈에 적용
- backlog 이슈가 todo 또는 in_progress로 전환될 때마다 이 워크플로우가 시작됨

## 단계

1. **Plan** — CTO가 이슈 생성 및 comment로 목표/브랜치/완료 기준 명시
2. **Assign** — CTO가 개발 에이전트에 이슈 assign, 상태 in_progress
3. **Do** — 개발 에이전트가 worktree 생성 후 코드 구현
   - `git -C ~/Desktop/jb/built worktree add .claude/worktrees/<브랜치명> -b <브랜치명>`
   - KG에서 관련 선례 확인 후 작업
4. **Check** — 구현 완료 후 자체 검증 (완료 기준 대조)
5. **Iter** — 미충족 항목 있으면 수정 반복
6. **Report** — PR 생성 + comment 작성 + 상태 in_review + 리뷰 에이전트 assign
   - `gh pr create --base main --head <브랜치명>`
   - `multica issue status <id> in_review`
   - `multica issue assign <id> --to "리뷰"`
7. **Review** — 리뷰 에이전트가 PR diff 확인 및 완료 기준 대조
   - 통과: PR merge → done → CTO assign
   - 반려: 사유 comment + in_progress + 개발 에이전트 재assign
8. **KG 문서화** — CTO가 kg/issues/<이슈ID>.md 작성 후 main 커밋

## 주의사항

- worktree는 반드시 브랜치별로 생성 (재작업 시 기존 브랜치 재사용)
- 개발 에이전트는 결과를 반드시 comment로 남겨야 함 (터미널 출력은 CTO에게 보이지 않음)
- 리뷰 반려 시 반드시 회차 명시 (1회차, 2회차 ...) — 3회 초과 시 CTO 에스컬레이션
- assign과 in_progress 변경은 에이전트 idle 확인 후 순서대로 수행
