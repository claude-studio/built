---
id: WF-MISDIRECTED-EXECUTION-SAFETY
title: 잘못 시작된 execution 안전 중단 워크플로우
type: workflow
date: 2026-04-26
validated_by: [BUI-187]
tags: [ops, execution, routing, assignee, pr-safety]
---

# 잘못 시작된 execution 안전 중단 워크플로우

## 언제 사용하나

- 오래된 execution이 issue 재assign 이후 뒤늦게 시작됐을 때
- issue가 `backlog`, `done`, `blocked`, `in_review`로 바뀐 뒤 이전 역할 execution이 남아 있을 때
- 같은 BUI 번호로 canonical PR이 이미 있는데 다른 branch에서 PR을 만들려 할 때
- Operator heartbeat에서 stale running execution을 발견했을 때

## 핵심 규칙

현재 issue의 `status`, `assignee`, 최신 routing comment가 execution의 SSOT다. 이 셋이 현재
실행과 맞지 않으면 작업 결과를 만들지 않는다.

잘못 시작된 execution은 다음을 하지 않는다.

- 코드 수정
- commit/push
- PR 생성 또는 기존 PR close
- issue status 변경
- 다른 정상 실행 중단

대신 한글/KST 기준 comment로 현재 canonical 상태와 무시 사유를 남긴다.

## Builder 절차

1. 시작 전 `issue get`으로 `status=in_progress`, assignee=Builder를 확인한다.
2. 최신 comment에서 정정/되돌림/중단 지시와 canonical PR/branch를 확인한다.
3. 코드 수정 전, 테스트 전, PR 생성 전 같은 확인을 반복한다.
4. PR 생성 전 같은 BUI 번호의 open PR과 현재 branch의 open PR을 조회한다.
5. 조건이 깨지면 commit/push/PR 없이 중단 comment만 남긴다.

## Coordinator 절차

1. 최신 canonical routing을 handoff comment에 명확히 남긴다.
2. 실행 취소가 불가능한 오래된 run은 status/assignee gate에서 무시되도록 둔다.
3. 잘못 시작된 실행이 보고되면 현재 canonical assignee/status/PR을 기준으로 정정 comment를
   남긴다.
4. 같은 issue를 중복으로 새 branch/PR에 라우팅하지 않는다.

## Operator 절차

1. heartbeat에서 running execution과 issue status/assignee 불일치를 찾는다.
2. 불일치 run은 무시 대상으로 기록하고, 정상 canonical 실행은 건드리지 않는다.
3. cleanup은 worktree cleanup 정책의 안전 조건을 만족할 때만 수행한다.
4. 안전 조건이 모호하면 Coordinator 판단을 요청한다.

## 완료 기준

- 잘못 라우팅된 execution이 commit, push, PR, status 변경을 만들지 않는다.
- 중단/무시 근거가 한글/KST comment로 남는다.
- 정상 canonical issue 실행과 open PR은 방해받지 않는다.
