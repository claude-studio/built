# built provider 비교 모드 설계

작성일: 2026-04-26 KST

이 문서는 Claude/Codex 결과를 같은 입력과 같은 검증 기준으로 비교하는 명시적 실험 모드를 정의한다.

비교 모드는 기본 provider 실행 경로가 아니다. `/built:run`과 `node scripts/run.js <feature>`는 계속 phase마다 provider 하나만 선택한다. 비교 모드는 사람이 품질 최적화나 고위험 변경 판단을 위해 별도 명령으로 실행하고, 자동 winner 선택 없이 report를 남기는 보조 경로다.

관련 계약:

- `docs/contracts/provider-config.md`
- `docs/contracts/file-contracts.md`
- `docs/ops/provider-routing-matrix.md`
- `kg/decisions/provider-comparison-mode-boundary.md`
- `kg/goals/north-star.md`

## 원칙

- 기본 실행에서 한 phase는 provider 하나만 실행한다.
- 비교 모드는 `comparison.enabled: true`와 비교 전용 명령이 모두 있을 때만 실행한다.
- provider별 run, worktree, output directory는 서로 격리한다.
- 모든 provider 후보는 같은 입력 snapshot, 같은 acceptance criteria, 같은 verification plan을 사용한다.
- 비교 결과는 사람이 검토할 수 있는 report와 diff 중심으로 남긴다.
- 자동 winner 선택, 자동 merge, 기본 phase 상태 승격은 하지 않는다.
- provider는 비교 report나 공통 파일 계약을 직접 쓰지 않는다. 비교 orchestrator와 writer가 기록한다.

## Activation

제안 명령:

```bash
node scripts/compare-providers.js <feature> --phase do --comparison <comparison-id>
```

Claude Code 명령을 추가한다면 다음처럼 비교 전용 명령으로 둔다.

```text
/built:compare <feature> --phase do
```

금지 사항:

- `/built:run`에서 `providers.do`를 배열로 받아 자동 비교하지 않는다.
- `providers.check` 같은 기존 phase provider 설정을 비교 모드로 해석하지 않는다.
- `plan_synthesis`, `do`, `check`, `iter`, `report`의 canonical 결과 파일을 비교 모드가 덮어쓰지 않는다.

## 최소 run-request 확장 후보

비교 모드는 기존 `providers` 필드와 분리된 top-level `comparison` 필드를 사용한다.
이 필드는 비교 전용 명령에서만 읽고, 기본 runner는 phase provider 선택에 사용하지 않는다.

```json
{
  "featureId": "user-auth",
  "planPath": ".built/features/user-auth.md",
  "createdAt": "2026-04-26T00:00:00.000Z",
  "providers": {
    "do": "claude",
    "check": "claude"
  },
  "comparison": {
    "enabled": true,
    "id": "20260426-153000-do-claude-codex",
    "phase": "do",
    "base_ref": "HEAD",
    "candidates": [
      {
        "id": "claude",
        "provider": {
          "name": "claude",
          "model": "claude-opus-4-5",
          "timeout_ms": 1800000
        }
      },
      {
        "id": "codex",
        "provider": {
          "name": "codex",
          "model": "gpt-5.5",
          "effort": "high",
          "sandbox": "workspace-write",
          "timeout_ms": 1800000
        }
      }
    ],
    "verification": {
      "commands": ["npm test"],
      "smoke": false
    },
    "report": {
      "format": "markdown"
    }
  }
}
```

필드 의미:

| 필드 | 설명 |
|------|------|
| `comparison.enabled` | 명시적 opt-in. `true`가 아니면 비교 명령도 실행하지 않는다. |
| `comparison.id` | 산출물 directory와 branch 이름에 쓰는 안정 ID. 없으면 KST 기준 timestamp로 생성한다. |
| `comparison.phase` | 비교할 phase. MVP는 `do`만 허용한다. |
| `comparison.base_ref` | 모든 candidate worktree가 시작할 동일 base ref. 기본값은 현재 `HEAD`. |
| `comparison.candidates[].id` | directory, branch, report 섹션 식별자. provider 이름과 같을 필요는 없다. |
| `comparison.candidates[].provider` | 기존 `providers.<phase>` 상세형과 같은 ProviderSpec. |
| `comparison.verification.commands` | 모든 candidate에 동일하게 실행할 검증 명령 목록. |
| `comparison.verification.smoke` | real provider smoke 여부. 기본 `false`; 기본 테스트와 분리한다. |

## Directory contract

비교 실행의 canonical runtime root:

```text
.built/runtime/runs/<feature>/comparisons/<comparison-id>/
  manifest.json
  input-snapshot.json
  acceptance-criteria.md
  verification-plan.json
  report.md
  providers/
    <candidate-id>/
      run-request.json
      state.json
      progress.json
      logs/<phase>.jsonl
      result/<phase>-result.md
      verification.json
      diff.patch
      git-status.txt
```

provider별 execution worktree:

```text
.claude/worktrees/<feature>-compare-<comparison-id>-<candidate-id>/
```

provider별 branch:

```text
compare/<feature>/<comparison-id>/<candidate-id>
```

격리 규칙:

- 각 candidate는 동일한 `base_ref`에서 별도 worktree와 별도 branch를 만든다.
- 각 candidate는 자기 worktree 안에서만 파일 변경을 수행한다.
- candidate 실행 중 canonical `.built/features/<feature>/do-result.md` 같은 기본 phase 결과 파일을 덮어쓰지 않는다.
- runner가 필요하면 candidate worktree의 결과를 `providers/<candidate-id>/result/`로 복사하거나 normalized writer를 비교 output root에 바인딩한다.
- `manifest.json`에는 `base_ref`, candidate branch, worktree path, provider spec, 시작/종료 시각을 기록한다.

## 입력 동일성 절차

비교 orchestrator는 provider 실행 전에 다음 snapshot을 만든다.

1. `run-request.json`에서 `featureId`, `planPath`, `comparison`을 읽는다.
2. `base_ref`의 commit SHA를 확정해 `manifest.json`에 기록한다.
3. feature spec, plan synthesis output, acceptance criteria, out-of-scope를 `input-snapshot.json`과 `acceptance-criteria.md`에 고정한다.
4. 검증 명령과 환경 전제를 `verification-plan.json`에 고정한다.
5. 모든 candidate worktree를 같은 `base_ref`에서 생성한다.

실행 중 한 candidate가 입력 파일을 수정해도 다른 candidate에는 반영하지 않는다. 입력 변경이 필요한 경우 비교 실행을 중단하고 새 comparison id로 다시 시작한다.

## 실행 절차

MVP는 순차 실행을 기본으로 한다. 병렬 실행은 provider quota, local resource, app-server broker 충돌을 별도로 검증한 뒤 opt-in으로 추가한다.

1. candidate별 worktree와 branch를 생성한다.
2. candidate별 `run-request.json`을 작성한다. 이 파일에는 해당 phase의 provider 하나만 들어간다.
3. phase runner를 candidate output root에 바인딩해 실행한다.
4. 동일한 `verification.commands`를 candidate worktree에서 실행한다.
5. `git status --short`와 `git diff --binary <base_ref>`를 저장한다.
6. provider result, verification result, diff metadata를 취합해 `report.md`를 생성한다.

## Report contract

`report.md`는 다음 정보를 포함한다.

- 비교 id, feature, phase, base commit, 생성 시각(KST)
- candidate별 provider/model/sandbox/timeout
- candidate별 phase status, duration, failure taxonomy
- candidate별 검증 명령 결과와 실패 로그 요약
- candidate별 변경 파일 목록과 diff summary
- acceptance criteria별 evidence matrix
- 사람이 판단해야 할 open questions
- 자동 winner 미선정 문구

redaction 경계:

- `report.md`, `manifest.json`, `input-snapshot.json`, candidate별 `run-request.json`, `progress.json`, `verification.json`은 저장 직전 공통 redaction helper를 적용한다.
- 사용자-facing report에는 token, chat id, workspace UUID, local daemon path 원문을 남기지 않는다.
- provider raw error 전문은 public summary가 아니라 sanitize된 `failure.debug_detail` 같은 디버그 전용 필드에서만 다룬다.

예시 구조:

```markdown
# Provider 비교 리포트: user-auth do

생성 시각: 2026-04-26 15:30 KST
base: abc1234

## 요약

자동 winner는 선택하지 않았습니다. 아래 evidence를 기준으로 사람이 판단해야 합니다.

## Candidate Matrix

| candidate | provider | phase status | verification | files changed |
|-----------|----------|--------------|--------------|---------------|
| claude | claude | completed | pass | 4 |
| codex | codex | completed | fail | 5 |

## Acceptance Criteria Evidence

| 기준 | claude | codex |
|------|--------|-------|
| 로그인 리다이렉트 유지 | 충족 | 충족 |
| 기존 세션 만료 테스트 통과 | 충족 | 실패 |
```

## Rollback과 diff 확인

비교 모드는 canonical feature branch에 자동 적용하지 않으므로 rollback의 기본 단위는 candidate worktree/branch 삭제다.

확인 명령 예시:

```bash
git -C .claude/worktrees/<feature>-compare-<comparison-id>-<candidate-id> diff <base-ref>
cat .built/runtime/runs/<feature>/comparisons/<comparison-id>/providers/<candidate-id>/diff.patch
```

선택한 candidate를 이어서 작업하려면 사람이 명시적으로 branch를 지정해 PR을 만들거나 cherry-pick한다.

정리 절차:

1. `report.md`와 `diff.patch`가 필요한 evidence를 보존했는지 확인한다.
2. candidate branch가 PR로 승격되지 않았으면 worktree를 제거한다.
3. 필요 시 `compare/<feature>/<comparison-id>/<candidate-id>` branch를 삭제한다.
4. `.built/runtime/runs/<feature>/comparisons/<comparison-id>/`는 audit evidence로 유지한다.

## 리스크와 검증

주요 리스크:

- 기본 runner가 `comparison` 필드를 phase provider 설정으로 오해하면 기존 실행 경로가 복잡해진다.
- candidate가 canonical `.built/features/<feature>/`를 공유하면 결과 파일이 덮어써진다.
- 병렬 실행은 provider broker와 local worktree 리소스 충돌을 만들 수 있다.
- real provider smoke를 기본 테스트에 섞으면 인증, 네트워크, 비용 상태가 회귀 신호를 오염시킨다.

필수 검증:

- parser 단위 테스트: `comparison`은 비교 명령에서만 허용하고, 기본 provider parser의 phase 선택을 바꾸지 않는다.
- fake provider E2E: 같은 입력에서 candidate별 output root가 분리되는지 확인한다.
- file contract 테스트: canonical `state.json`, `progress.json`, phase result가 비교 모드에 의해 덮어써지지 않는지 확인한다.
- smoke 테스트: 실제 Claude/Codex 비교는 명시적 환경 변수로만 실행한다.

## MVP 범위

포함:

- `do` phase 비교
- Claude/Codex candidate 각각 하나
- 순차 실행
- provider별 worktree/branch/output 격리
- report와 diff 산출물 생성

제외:

- 자동 winner 선택
- 자동 merge 또는 canonical branch 적용
- 기본 `/built:run` 경로 변경
- 병렬 provider 실행
- provider별 비용 최적화 판단 자동화
