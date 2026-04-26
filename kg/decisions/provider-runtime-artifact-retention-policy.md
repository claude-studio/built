---
id: ADR-13
title: provider runtime artifact 보존과 cleanup 경계
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-180
tags: [ops, provider, cleanup, retention, comparison, smoke, evidence]
---

# Provider Runtime Artifact 보존과 Cleanup 경계

## 컨텍스트

provider 비교 모드와 real smoke가 추가되면서 `.built/runtime/runs/<feature>/comparisons/<comparison-id>/`, candidate worktree, compare branch, smoke 임시 디렉토리가 빠르게 늘어난다.

이 산출물 중 일부는 단순 실행 잔여물이지만, 일부는 PR 리뷰와 provider 품질 판단의 audit evidence다. cleanup 자동화가 evidence와 임시 실행 환경을 구분하지 못하면 report, diff, log가 삭제되어 나중에 provider decision을 재검증할 수 없다.

## 결정

provider runtime cleanup의 경계는 evidence 보존을 기준으로 나눈다.

- comparison evidence directory는 삭제하지 않는다.
  `report.md`, `diff.patch`, `manifest.json`, `verification.json`, `providers/<candidate-id>/logs/`는 audit evidence로 보존한다.
- cleanup 대상으로 허용되는 것은 candidate worktree, compare branch, 24시간을 초과한 smoke 임시 디렉토리다.
- candidate worktree/branch는 open PR 없음, branch merge 완료 또는 PR closed/merged, uncommitted 변경 없음 조건을 모두 만족할 때만 삭제한다.
- cleanup 명령은 dry-run과 실제 삭제를 분리한다.
  운영 기본 확인 명령은 `node scripts/cleanup-artifacts.js --dry-run`이다.
- smoke 임시 디렉토리는 기본 smoke가 자동 삭제한다. `BUILT_KEEP_SMOKE_DIR=1`로 남긴 디버그 디렉토리만 24시간 후 cleanup 후보가 된다.

상세 정책과 명령 예시는 `docs/ops/artifact-retention-policy.md`를 기준으로 한다.

## 근거

- north-star는 자동화가 관측 가능성과 복구 가능성을 해치지 않아야 한다. comparison report와 diff는 provider 선택의 근거이므로 cleanup으로 잃으면 안 된다.
- worktree와 branch는 재생성 가능한 실행 환경 잔여물이며, safety gate를 통과하면 삭제해도 evidence가 유지된다.
- dry-run 결과를 먼저 기록하면 Finisher/Operator가 삭제 전에 blocked 후보와 남은 위험을 공유할 수 있다.
- smoke 임시 디렉토리는 디버그 편의를 위한 예외 보존물이므로 긴 기간 보존할 이유가 적다.

## 결과

- comparison evidence는 장기 보존 대상으로 고정되었다.
- Operator는 주기 점검에서 comparison/smoke cleanup 후보를 찾되 blocked 후보를 삭제하지 않는다.
- Finisher는 PR merge 후 feature cleanup evidence를 남기되 comparison evidence directory를 삭제하지 않는다.
- provider cleanup script의 성공 기준은 "삭제량 최대화"가 아니라 "삭제해도 되는 잔여물과 보존해야 하는 evidence의 분리"가 되었다.

## 대안

- comparison directory 전체를 TTL 기반으로 삭제한다: storage는 줄지만 provider 품질 판단 evidence와 review history를 잃으므로 선택하지 않았다.
- 모든 comparison artifact를 영구 보존한다: 안전하지만 candidate worktree와 compare branch가 누적되어 운영 비용이 커지므로 선택하지 않았다.
- open PR 여부만 확인하고 branch를 삭제한다: unmerged commit이나 dirty worktree를 잃을 수 있어 선택하지 않았다.
- smoke 임시 디렉토리를 무기한 보존한다: 디버그 목적을 넘어서는 운영 부채가 되므로 24시간 기준을 선택했다.

## 되돌릴 조건

별도 artifact archive나 object storage로 report/diff/log를 복제하고 무결성 확인이 가능해지면 comparison evidence directory의 로컬 보존 기간을 재검토할 수 있다.

그 경우에도 삭제 전 dry-run, open PR 보호, unmerged branch 보호, uncommitted 변경 보호는 유지해야 한다.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Decision",
  "identifier": "ADR-13",
  "name": "provider runtime artifact 보존과 cleanup 경계",
  "about": "provider comparison and smoke artifact retention policy",
  "isBasedOn": {"@type": "CreativeWork", "name": "BUI-180"}
}
```
