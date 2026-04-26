---
id: WF-17
title: Provider Comparison Real Smoke
type: workflow
date: 2026-04-26
validated_by: [BUI-167, BUI-178]
tags: [provider, comparison, smoke, claude, codex, artifact]
---

## 패턴 설명

provider comparison real smoke는 fake/offline 비교 MVP 위에 얹는 선택적 운영 검증이다.
Claude와 Codex를 같은 feature spec, 같은 base ref, 같은 verification command로 실행하고, candidate별 diff와 verification artifact를 분리해 사람이 비교할 evidence를 남긴다.

## 언제 사용하나

- Claude/Codex 실제 `do` phase 결과 gap을 확인할 때
- provider comparison runner의 real-mode worktree/output 격리를 점검할 때
- provider 전환 중 fake E2E만으로 확인할 수 없는 CLI availability, auth, timeout, candidate failure를 검증할 때
- smoke 문서, cleanup 정책, comparison artifact contract를 갱신할 때

## 단계

1. 기본 회귀 테스트와 real smoke를 분리한다.
   `npm test`는 fake/offline test만 실행하고, real comparison smoke는 `BUILT_COMPARE_REAL_SMOKE=1` 또는 `npm run test:smoke:compare`로만 실행한다.
2. 실행 전 Claude CLI와 Codex CLI 상태를 확인한다.
   Claude는 `claude --version`, Codex는 `codex --version`, `codex login`, `codex app-server` 지원 여부가 전제다.
3. smoke는 임시 git repo에서 실행한다.
   feature spec, `package.json`, `run-request.json`을 repo 안에 만들고 초기 commit을 생성한 뒤 `base_ref: HEAD`를 사용한다.
4. comparison 설정은 top-level `comparison` 필드에만 둔다.
   `providers.do`는 기본 provider fallback으로 남기고, 실제 비교 activation은 `comparison.enabled: true`와 비교 전용 명령에 묶는다.
5. candidate는 최소 `claude`, `codex`를 분리한다.
   Codex `do` phase는 파일 쓰기가 필요하므로 `sandbox: workspace-write`를 사용한다.
6. `scripts/compare-providers.js <feature> --phase do --comparison <comparison-id>`를 실행한다.
   전체 smoke timeout은 real provider latency를 고려하되 기본 테스트 timeout과 섞지 않는다.
7. comparison root의 공통 artifact를 확인한다.
   `manifest.json`, `report.md`, `input-snapshot.json`, `acceptance-criteria.md`, `verification-plan.json`이 기준 artifact다.
8. candidate별 artifact를 확인한다.
   `providers/<candidate-id>/run-request.json`, `state.json`, `verification.json`, `diff.patch`, `git-status.txt`, `result/do-result.md`가 candidate directory 아래에 있어야 한다.
9. canonical output 보호를 확인한다.
   비교 실행이 canonical `.built/features/<feature>/do-result.md`, canonical progress, 기본 run `state.json`을 만들거나 덮어쓰면 실패로 본다.
10. `report.md`는 자동 winner를 선택하지 않았다는 점을 명시해야 한다.
    검증 명령 통과 여부와 diff는 evidence이며 merge 또는 provider 승격의 자동 결정 근거가 아니다.
11. 실패 출력은 smoke 문서의 원인축과 맞춘다.
    comparison real smoke의 핵심 축은 `provider_unavailable`, `인증(auth)`, `comparison_setup`, `candidate_failed`, `artifact_missing`, `timeout`이다.
12. cleanup 정책을 실행 결과와 맞춘다.
    `BUILT_KEEP_SMOKE_DIR=1`이면 임시 디렉토리를 보존하고, 유지하지 않는 경우 자동 삭제가 실제 exit path에서 동작하는지 확인한다.

## 주의사항

- real comparison smoke는 비용, 인증, 네트워크, provider quota에 의존하므로 기본 CI 신호로 쓰지 않는다.
- fake comparison E2E 통과는 file contract와 canonical 보호의 기본 회귀 신호이고, real comparison smoke 통과는 provider 통합과 결과 gap 관찰 신호다.
- candidate별 artifact가 없을 때 provider 실패로 단정하지 않는다.
  runner setup 실패, artifact path drift, canonical output 오염 가능성을 먼저 분리한다.
- cleanup 문서와 구현은 함께 검증한다.
  `process.exit()`를 직접 호출하면 `finally` cleanup이 실행되지 않을 수 있으므로, 자동 삭제를 보장하려면 return-based exit 또는 process exit handler를 사용한다.
- `BUILT_KEEP_SMOKE_DIR=1`로 유지한 디렉토리는 investigation 후 수동 삭제한다.
  삭제 전 필요한 evidence는 `report.md`, candidate별 `diff.patch`, `verification.json`, `git-status.txt` 중심으로 확인한다.
