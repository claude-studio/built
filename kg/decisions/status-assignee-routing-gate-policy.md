---
id: ADR-23
title: status와 assignee 기반 execution routing gate
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-187
tags: [ops, execution, routing, assignee, status, safety]
---

## 컨텍스트

Multica issue는 reassignment, status 변경, 오래된 execution 재개가 겹칠 수 있다. CLI에 running
execution을 직접 cancel하는 명령이 명확하지 않으면, 의도하지 않은 실행이 뒤늦게 commit, push, PR,
status 변경을 만들 위험이 있다. BUI-167 관찰 이후 BUI-187에서는 cancel 기능을 새로 만들지 않고
현재 운영 모델 안에서 안전하게 무시하는 기준을 정했다.

## 결정

작업 계속 여부의 canonical gate는 현재 issue의 `status`, `assignee`, 최신
routing/result/correction comment다.

- agent는 시작 전 현재 issue가 자신의 역할과 assignee를 가리키는지 확인한다.
- Builder는 코드 수정 전, 테스트 전, PR 생성 전 같은 gate를 반복한다.
- 최신 comment에 정정, 되돌림, 시작 금지, 선행조건 미충족, canonical PR 충돌이 있으면 작업을
  중단한다.
- gate가 깨진 실행은 코드 수정, commit, push, PR 생성, issue status 변경, 다른 정상 실행 중단을
  하지 않는다.
- 무시/중단 결과는 한글과 KST 기준 comment로 남긴다.
- handoff/result comment는 status와 assignee 변경보다 먼저 남긴다.

## 근거

- `status`와 `assignee`는 플랫폼의 현재 routing 상태를 나타내며 오래된 run보다 최신이다.
- 최신 comment는 correction, 선행조건, canonical PR/branch 정보를 담는 운영 SSOT다.
- 직접 cancel 기능 없이도 산출물 생성을 막으면 잘못 시작된 실행의 피해 반경을 줄일 수 있다.
- status/assignee 변경 전에 결과 comment를 남기면 assignee 변경으로 현재 execution 표시가
  cancelled처럼 보이더라도 audit trail이 남는다.

## 대안

1. **running execution을 강제 취소하는 CLI 기능 추가**: 이슈 비범위이며 플랫폼 기능 변경이 필요해
   선택하지 않았다.
2. **Operator가 오래된 branch나 PR을 직접 닫기**: 정상 canonical 실행이나 open PR을 방해할 수 있어
   안전 조건이 명확할 때의 cleanup 절차로만 제한했다.
3. **agent가 자신의 로컬 상태만 보고 계속 진행**: reassignment와 correction comment를 놓쳐 중복 PR과
   잘못된 status 변경을 만들 수 있어 선택하지 않았다.

## 되돌릴 조건

- Multica가 issue run cancel/ignore 상태를 native contract로 제공하고, 취소된 run이 write command를
  실행할 수 없다는 보장이 생기면 이 gate를 단순화할 수 있다.
- issue routing과 PR canonical mapping이 플랫폼에서 원자적으로 제공되면 최신 comment 기반 판단의
  일부를 플랫폼 상태 조회로 대체할 수 있다.

## 결과

- 잘못 시작된 execution은 산출물을 만들기 전에 스스로 중단하거나 무시된다.
- 정상 canonical 실행, branch, open PR은 방해받지 않는다.
- Builder, Coordinator, Operator는 같은 gate와 코멘트 형식을 기준으로 stale execution을 처리한다.
