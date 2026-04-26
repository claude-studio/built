---
id: WF-11
title: Provider Comparison MVP Validation
type: workflow
date: 2026-04-26
validated_by: [BUI-137, BUI-167]
tags: [provider, comparison, worktree, fake, validation]
---

## 패턴 설명

provider 비교 모드는 기본 provider routing과 분리된 명시적 evidence 수집 경로다.
같은 input snapshot, acceptance criteria, verification plan을 candidate별로 분리된 branch/worktree/output root에 적용하고, 결과를 사람이 검토할 report로 남긴다.

## 언제 사용하나

- Claude/Codex 또는 다른 provider candidate의 `do` phase 결과 차이를 같은 기준으로 비교할 때
- provider transition 중 품질 gap을 diff, verification result, provider result로 남겨야 할 때
- canonical `.built/features/<feature>/`를 오염시키지 않고 실험 결과만 audit evidence로 보존해야 할 때
- provider comparison runner, parser, report format, cleanup 절차를 수정할 때

## 단계

1. 기본 실행 경로와 비교 경로를 분리한다.
   `/built:run`과 `node scripts/run.js <feature>`는 `comparison` 필드를 activation 신호로 쓰지 않는다.
2. `run-request.json`의 top-level `comparison.enabled: true`와 비교 전용 명령을 함께 요구한다.
   `providers.<phase>`는 단일 provider 선택 계약으로 유지한다.
3. MVP에서는 `comparison.phase`를 `do`로 제한한다.
   다른 phase 비교가 필요하면 parser, runner, file contract, review checklist를 별도 이슈에서 확장한다.
4. 모든 candidate는 같은 `base_ref`, input snapshot, acceptance criteria, verification commands를 사용한다.
   입력 변경이 필요하면 기존 comparison id를 재사용하지 않고 새 comparison id로 다시 실행한다.
5. candidate별 output은 `.built/runtime/runs/<feature>/comparisons/<comparison-id>/providers/<candidate-id>/` 아래에만 쓴다.
   `diff.patch`, `git-status.txt`, `verification.json`, provider result, logs를 candidate directory에 함께 둔다.
6. comparison root에는 `input-snapshot.json`, `acceptance-criteria.md`, `verification-plan.json`, `manifest.json`, `report.md`를 남긴다.
   report는 자동 winner를 선택하지 않았다는 점을 명시한다.
7. 기본 회귀 테스트는 fake/offline provider로 실행한다.
   real Claude/Codex 비교 smoke는 인증, 네트워크, 비용, provider availability에 의존하므로 opt-in 후속 검증으로 분리한다.
8. canonical output 보호를 테스트한다.
   비교 실행이 canonical `.built/features/<feature>/do-result.md`, `.built/features/<feature>/progress.json`, 기본 `.built/runtime/runs/<feature>/state.json`을 생성하거나 덮어쓰면 실패로 본다.
9. cleanup은 candidate worktree와 compare branch만 대상으로 한다.
   `.built/runtime/runs/<feature>/comparisons/<comparison-id>/`는 audit evidence로 보존한다.

## 주의사항

- 자동 winner 선택, 자동 merge, canonical branch 적용은 현재 workflow에 포함하지 않는다.
- `comparison` 필드를 기본 provider config나 `providers.do` 배열 확장처럼 해석하면 ADR-12의 경계를 깨뜨린다.
- real-mode candidate worktree 생성은 project root HEAD를 전환하지 않아야 한다.
  `git checkout -b` 후 `git worktree add`를 순차 실행하면 branch가 이미 checkout된 상태가 되어 실패하고 root branch가 오염될 수 있다.
  real-mode 활성화 전 `git worktree add -b <branch> <worktreePath> <base_ref>` 형태로 검증한다.
- fake E2E 통과는 output contract와 canonical 보호의 기본 회귀 신호다.
  실제 provider 품질 동등성은 별도의 real smoke와 human review로 판단한다.
