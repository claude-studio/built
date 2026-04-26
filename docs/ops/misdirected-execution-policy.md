---
title: 잘못 시작된 execution 감지와 중단/무시 정책
scope: ops
created: 2026-04-26
updated: 2026-04-26
related_issues: [BUI-187]
tags: [ops, execution, routing, assignee, safety]
---

# 잘못 시작된 execution 감지와 중단/무시 정책

## 목적

이슈 ID 혼선, 오래된 run, 중복 assign 때문에 현재 canonical routing과 다른 execution이
시작될 수 있다. Multica CLI에 직접 cancel 명령이 없을 때도 잘못된 실행이 commit, push, PR,
status 변경을 만들지 않도록 status와 assignee를 안전 gate로 사용한다.

## Canonical 기준

한 execution이 작업을 계속할 수 있는 조건은 모두 만족해야 한다.

- issue `status`가 현재 역할에 맞다. Builder 작업은 `in_progress`여야 한다.
- issue assignee가 현재 agent다.
- 최신 handoff/result/correction comment가 현재 실행을 취소하거나 되돌리지 않았다.
- 선행조건이 있다면 최신 comment 기준으로 충족되어 있다.
- PR 생성 전 같은 BUI 번호의 canonical open PR이 없거나, 현재 branch가 그 canonical PR의
  head branch다.

위 조건 중 하나라도 깨지면 잘못 시작된 execution으로 보고 작업을 중단하거나 무시한다.

## Agent 시작 전 확인

모든 역할은 작업 시작 전에 다음 최소 정보를 확인한다.

```bash
multica issue get <issue-id> --output json
multica issue comment list <issue-id> --limit 5 --output json
```

comment list는 raw 전문을 덤프하지 않고, 최신 handoff/result/correction 여부와 PR/branch
정보만 요약해서 판단한다. "정정", "되돌림", "시작하면 안 됨", "중단" 같은 최신 지시가 있으면
코드 수정이나 상태 변경 없이 종료한다.

## Builder PR 생성 전 확인

Builder는 코드 수정 전, 테스트 전, PR 생성 전 총 세 번 gate를 반복한다. 특히 PR 생성 직전에는
다음을 확인한다.

```bash
multica issue get <issue-id> --output json
multica issue comment list <issue-id> --limit 5 --output json
gh pr list --state open --search "BUI-<N> in:title" --json number,title,url,headRefName,state
gh pr list --state open --head <branch> --json number,title,url,headRefName,state
```

- 기존 canonical PR이 있으면 새 PR을 만들지 않고 해당 branch를 이어 쓴다.
- canonical PR이 불명확하거나 issue가 더 이상 Builder `in_progress`가 아니면 push/PR 생성 없이
  한글/KST comment로 Coordinator 판단을 요청한다.
- 이미 로컬 변경이 있어도 잘못 시작된 실행이면 commit, push, PR 생성, status 변경을 하지 않는다.

## 중단/무시 코멘트 형식

잘못 시작된 execution은 다음 정보를 한글과 KST 기준으로 남기고 종료한다.

```text
YYYY-MM-DD HH:mm KST 기준으로 이 실행은 무시합니다.

- 사유: 현재 issue status=<status>, assignee=<assignee>로 이 실행 대상과 다릅니다.
- 현재 canonical routing: <역할/agent 또는 없음>
- 로컬/원격 변경: commit/push/PR 생성 없음
- 후속 조치: Coordinator 판단 필요 또는 조치 없음
```

assignee 변경과 agent mention은 같은 코멘트에서 중복 사용하지 않는다. 단순 무시 보고에는
mention을 붙이지 않는다.

## Operator 정리 절차

Operator는 heartbeat나 stale 점검에서 오래된 running execution을 발견하면 다음 순서로 처리한다.

1. issue의 현재 status, assignee, 최신 routing comment를 확인한다.
2. canonical 실행이 다른 agent/status로 진행 중이면 기존 running execution을 무시 대상으로
   기록한다.
3. 정상 진행 중인 다른 issue 실행, open PR, canonical branch를 중단하거나 닫지 않는다.
4. branch/worktree cleanup은 `docs/ops/worktree-cleanup-policy.md`의 open PR 없음, merge 완료,
   running 작업 없음 조건을 통과할 때만 수행한다.
5. cleanup 조건을 통과하지 못하면 blocked/운영 코멘트만 남기고 Coordinator 판단을 요청한다.

## 재발 방지 포인트

- handoff comment는 다음 역할이 raw execution log를 보지 않아도 목표, branch, PR, head commit,
  완료 기준, blocker를 알 수 있게 작성한다.
- status 변경과 assignee 변경은 한 줄 command로 묶지 않는다. audit trail을 위해 결과 comment를
  먼저 남긴 뒤 상태와 담당자를 바꾼다.
- backlog로 되돌아간 issue에 남은 running execution은 새 작업 신호가 아니다.
- PR은 한 이슈당 하나의 canonical PR만 유지한다.
