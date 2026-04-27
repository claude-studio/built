---
id: ADR-41
title: direct report approved check gate 계약
type: decision
date: 2026-04-27
status: accepted
context_issue: BUI-384
tags: [safety, artifacts, report, check-result, opt-in]
---

## 컨텍스트

`/built:run` 경로에서는 Do 이후 Check/Iter가 승인된 뒤 Report가 실행된다.
하지만 `scripts/report.js`를 직접 실행하면 기존에는 `check-result.md`가 없거나 approved가 아니어도 placeholder 또는 기존 입력으로 `report.md`를 만들 수 있었다.
이 경로는 Plan/Do/Check/Report artifact 계약에서 `report.md`가 검증 완료 후 생성된 최종 보고서라는 의미를 약화시킨다.

## 결정

direct `/built:report`와 `scripts/report.js`의 기본 실행 조건은 `check-result.md` frontmatter의 `status: approved`다.
`check-result.md`가 없거나 `status`가 `needs_changes` 또는 missing이면 기본적으로 report phase를 실패시킨다.

검증 미완료 상태에서 보고서를 만들어야 하는 운영 예외는 `--allow-unchecked` CLI 플래그를 요구한다.
이 예외로 생성된 `report.md` frontmatter에는 `check_status`, `unchecked: true`, `unchecked_reason`을 남겨야 한다.

## 근거

- `report.md`는 feature 완료 판단과 handoff에 쓰이는 결과물이므로 Check 승인 없이 생성되면 완료 기준과 실제 검증 상태가 분리된다.
- direct script 실행도 `/built:run`과 같은 artifact safety boundary를 가져야 운영자가 우회 경로로 잘못된 완료 보고서를 만들지 않는다.
- 예외 실행을 명시 플래그로 제한하면 비정상 상황의 진단 보고서는 허용하면서도, artifact만 보아도 검증 미완료 보고서임을 알 수 있다.
- `check_status`, `unchecked`, `unchecked_reason`은 report artifact 자체에 남는 감사 필드라서 issue comment나 실행 로그가 없어도 상태를 복원할 수 있다.

## 결과

- `scripts/report.js`는 provider 실행 전에 check gate를 평가한다.
- missing `check-result.md`와 `needs_changes` 상태는 기본 실패가 됐다.
- `--allow-unchecked` 예외 실행은 `report.md` frontmatter에 검증 미완료 evidence를 남긴다.
- `docs/contracts/file-contracts.md`와 `skills/report/SKILL.md`가 direct report gate의 기준 문서가 됐다.

## 대안

- `check-result.md`가 없을 때 placeholder로 계속 진행한다: 완료 보고서의 의미가 검증 승인과 분리되어 선택하지 않았다.
- 예외 실행을 전면 금지한다: 운영 진단이나 중간 보고가 필요한 경우가 있어 선택하지 않았다.
- warning만 출력하고 report를 생성한다: artifact만 공유되면 warning이 사라질 수 있어 선택하지 않았다.

## 되돌릴 조건

Report phase가 더 이상 완료 보고서 역할을 하지 않거나, 별도 artifact type으로 unchecked report를 분리하는 계약이 도입되면 이 gate를 재검토할 수 있다.
그 전까지 direct report의 기본 실행은 approved `check-result.md`를 요구한다.
