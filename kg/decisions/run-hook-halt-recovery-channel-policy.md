---
id: ADR-35
title: Run hook halt 복구 채널 정책
type: decision
date: 2026-04-27
status: accepted
context_issue: BUI-347
tags: [hooks, run, iter, recovery, contracts]
---

## 컨텍스트

Run pipeline의 hook 설명은 `before_do`, `after_do`, `before_check` hook 실패가 check result를 주입해 iter loop에서 `needs_changes`로 처리될 수 있다고 설명했다.
하지만 실제 구현은 해당 hook point의 `halt_on_fail: true` 실패에서 즉시 exit code 1로 종료해 자동 수정 루프가 끊어질 수 있었다.

hook 실패는 provider 실행 실패와도 다르다.
provider event writer가 phase terminal 상태를 기록하는 책임과, 사용자 hook이 정책 위반 또는 후처리 실패를 알리는 책임을 섞으면 run 상태와 산출물의 SSOT가 흔들린다.

## 결정

Do/Check 전후의 recoverable hook halt는 `check-result.md`를 단일 복구 채널로 사용한다.

- `before_do` halt: Do와 Check를 건너뛰고 `check-result.md`를 `needs_changes`로 만든다.
- `after_do` halt: Do 완료 후 Check를 건너뛰고 `check-result.md`를 `needs_changes`로 만든다.
- `before_check` halt: Check를 건너뛰고 `check-result.md`를 `needs_changes`로 만든다.
- `after_check` halt: 기존 `check-result.md` status가 `approved`여도 `needs_changes`로 강제한다.
- `before_report` halt: Report 실행 전 pipeline을 hard halt한다.
- `after_report` halt: Report 이후 남은 after_report hook 실행만 중단하고 Run 성공 상태는 유지한다.

synthetic `check-result.md`를 새로 만들 때도 최소 frontmatter 계약을 유지한다.
필드는 `feature`, `status`, `checked_at`, `provider`, `model`, `duration_ms`, `issues`를 포함한다.
실제 Check provider가 실행되지 않은 복구 artifact에서는 `provider: null`, `model: null`, `duration_ms: 0`을 사용한다.

## 근거

- iter는 `check-result.md`의 `status: needs_changes`와 `issues`를 표준 피드백 입력으로 사용한다.
  Do/Check 전후 hook halt를 exit code 1로만 표현하면 복구 가능한 정책 위반이 run 실패로 보인다.
- hook 실패는 provider terminal event를 소급 변경하지 않는다.
  provider phase 결과와 hook policy 결과는 runner가 결합해 pipeline 다음 단계를 결정한다.
- synthetic artifact가 정상 Check 결과와 같은 최소 frontmatter를 갖추면 file contract 소비자가 별도 예외 처리를 하지 않아도 된다.
- Report 직전 halt는 구현 피드백이 아니라 최종 보고 단계 차단이므로 iter 복구 요청과 구분해야 한다.
- `[hook-failure]` issue는 같은 hook 실패당 한 번만 기록한다.
  halt 주입과 warning 주입이 동시에 실행되면 사용자가 같은 원인을 중복 수정 대상으로 오해할 수 있다.

## 대안

- 모든 `halt_on_fail: true` hook 실패를 즉시 exit code 1로 처리한다: 단순하지만 Do/Check 전후 복구 가능한 정책 위반이 iter로 전달되지 않아 문서화된 자동 수정 흐름과 맞지 않는다.
- hook 실패를 provider `error` 이벤트로 기록한다: provider raw 실행 실패와 사용자 hook 정책 실패가 섞여 provider event contract와 runner 책임 경계가 흐려진다.
- hook failure 전용 artifact를 새로 만든다: 의미는 명확하지만 iter가 이미 이해하는 `check-result.md`와 별도 소비 경로가 필요해 scope가 커진다.

## 되돌릴 조건

iter가 `check-result.md` 외의 구조화된 hook feedback artifact를 공식 입력으로 지원하게 되면 Do/Check 전후 hook halt의 전달 채널을 재검토할 수 있다.
그 경우 file contract, runner loop, docs, `test/run.test.js`, `test/hooks-runner.test.js`를 함께 바꿔야 한다.

Report 단계 hook 실패를 자동 수정 루프로 연결해야 하는 명확한 제품 요구가 생기면 `before_report` hard halt 정책을 별도 이슈에서 재검토한다.
