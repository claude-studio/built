# built phase별 provider routing matrix

작성일: 2026-04-26 KST

이 문서는 phase별 provider 기본값과 opt-in 선택 기준, 구현/리뷰 provider 분리 패턴, 그리고 고위험 변경 시 운영 지침을 정의한다.

설정 계약은 `docs/contracts/provider-config.md`, KG 결정은 `kg/decisions/phase-provider-routing-matrix.md`를 함께 참조한다.
Claude/Codex 결과를 같은 phase에서 직접 비교하는 실험 모드는 기본 routing이 아니며, `docs/ops/provider-comparison-mode.md`를 참조한다.

---

## 1. phase별 provider routing matrix

| phase | 기본 provider | opt-in provider | sandbox 요건 | activation |
|-------|--------------|-----------------|-------------|------------|
| `plan_synthesis` | claude | codex | read-only | `run-request.json`에 `plan_synthesis: true` 또는 `providers.plan_synthesis` 설정 시에만 실행 |
| `do` | claude | codex | claude: N/A, codex: `workspace-write` | `providers.do` 설정으로 전환 |
| `check` | claude | codex | read-only | `providers.check` 설정으로 전환 |
| `iter` | claude | codex | claude: N/A, codex: `workspace-write` | `providers.iter` 설정으로 전환 |
| `report` | claude | codex | read-only | `providers.report` 설정으로 전환 |

설정이 없으면 모든 phase에서 Claude 기본값으로 실행된다. 기존 `run-request.json`은 변경 없이 동작한다.

---

## 2. phase별 provider 선택 기준

### plan_synthesis

목적: interactive discovery 결과를 구현 계획(`plan-synthesis.json`)으로 구조화.

- **Claude**: 기본값. 기존 Claude 세션 컨텍스트와 자연스럽게 연결된다.
- **Codex**: reasoning effort를 높여 복잡한 구현 계획을 정밀하게 구조화할 때 opt-in. read-only이므로 sandbox 위험 없음.
- 이 phase는 항상 opt-in이다. 기본 pipeline(`do → check → iter → report`)을 바꾸지 않는다.

### do

목적: acceptance criteria에 맞는 파일 변경 구현.

- **Claude**: 기본값. 기존 동작을 유지하며 대부분의 구현 작업에 적합.
- **Codex**: 복잡한 다중 파일 변경, 특정 reasoning 모델이 필요한 작업에 opt-in. `workspace-write` sandbox 필수.
- `read-only` sandbox로 Codex를 `do`에 쓰면 실제 파일 변경이 없어도 성공처럼 보일 수 있다. parser가 이를 즉시 오류로 처리한다.

### check

목적: do 결과물을 acceptance criteria 기준으로 검증.

- **Claude**: 기본값. 구조화된 JSON schema 검증 출력에 적합.
- **Codex**: `do` phase를 Claude로 실행했을 때 교차 검증(cross-provider review) 용도로 opt-in.
- read-only phase이므로 파일 변경은 허용하지 않는다. Codex가 `fileChange`를 발생시키면 built는 sandbox 실패로 처리한다.
- 구현 provider와 다른 provider를 사용하는 것이 권장된다(3절 참조).

### iter

목적: check 결과 `needs_changes` 판정 시 개선 반복.

- **do와 동일한 선택 기준을 따른다.** iter는 do의 수정 루프이므로 provider와 sandbox 정책이 같다.
- do를 Claude로 실행했다면 iter도 Claude를 기본으로 유지한다. do를 Codex로 설정했다면 iter도 동일한 설정을 사용하는 것이 일관성을 유지한다.

### report

목적: 완료 결과를 요약 문서로 정리.

- **Claude**: 기본값. 저비용 모델(`claude-haiku-4-5-20251001`)로도 충분하다.
- **Codex**: 일반적으로 불필요. 특수한 요약 형식이 필요한 경우에만 opt-in.
- read-only phase이므로 파일 변경은 허용하지 않는다.

### workspace-write 운영 범위

`workspace-write`는 `do`/`iter`에서 acceptance criteria 구현에 필요한 worktree 변경을 허용하기 위한 설정이다.
허용 범위는 구현 파일, 테스트, 구현과 직접 연결된 문서, 그리고 built runner/control plane이 표준 writer로 관리하는 runtime 산출물이다.
provider는 `.git/`, credential, local-only config, workspace 밖 경로를 직접 변경하면 안 된다.
현재 guard 후보와 read-only phase 실패 기준은 `docs/contracts/provider-config.md`의 sandbox 정책을 기준으로 삼는다.

---

## 3. 구현 provider와 리뷰 provider 분리 패턴

구현(`do`)과 리뷰(`check`)에 같은 provider를 사용하면 provider 고유의 편향이나 blind spot이 검증을 통과할 수 있다.

**원칙**: 가능하면 구현 provider와 리뷰 provider를 달리 설정한다.
- Codex가 구현한 결과는 Claude가 review.
- Claude가 구현한 결과는 Codex가 review (opt-in 시).

### 설정 예시: Codex do + Claude check

```json
{
  "providers": {
    "do": {
      "name": "codex",
      "model": "gpt-5.5",
      "effort": "high",
      "sandbox": "workspace-write",
      "timeout_ms": 1800000
    },
    "check": {
      "name": "claude",
      "model": "claude-opus-4-5",
      "timeout_ms": 900000
    },
    "iter": {
      "name": "codex",
      "model": "gpt-5.5",
      "effort": "high",
      "sandbox": "workspace-write",
      "timeout_ms": 1800000
    }
  }
}
```

### 설정 예시: Claude do + Codex check (실험적)

```json
{
  "providers": {
    "do": "claude",
    "check": {
      "name": "codex",
      "model": "gpt-5.5",
      "effort": "medium",
      "sandbox": "read-only",
      "timeout_ms": 900000
    }
  }
}
```

이 패턴은 기존 Claude 구현 흐름을 유지하면서 check phase에서만 Codex를 실험적으로 투입한다.

### 설정 예시: plan_synthesis Codex + do/check Claude

고위험 feature에서 계획 단계만 Codex reasoning으로 강화하고 나머지는 안정적인 Claude 흐름을 유지한다.

```json
{
  "providers": {
    "plan_synthesis": {
      "name": "codex",
      "model": "gpt-5.5",
      "effort": "high",
      "sandbox": "read-only",
      "timeout_ms": 900000
    }
  }
}
```

`plan_synthesis: true`도 함께 설정해야 plan_synthesis phase가 실행된다.

---

## 4. 고위험 변경 시 운영 지침

### 고위험 변경 판단 기준

아래 조건 중 하나 이상에 해당하면 고위험 변경으로 분류한다.

- provider 계약(`docs/contracts/`), 파일 계약, standard-writer, event-normalizer 수정
- runner/pipeline 흐름 변경
- 새로운 provider 추가 또는 기존 provider adapter 교체
- sandbox 정책, timeout 정책, retry 정책 변경
- KG north-star 불변 원칙에 영향을 줄 수 있는 변경

### 고위험 변경 시 권장 설정

1. **plan_synthesis Codex opt-in**: 구현 계획을 더 엄밀하게 구조화한다.
2. **cross-provider review**: 구현 provider와 다른 provider로 check를 실행해 blind spot을 줄인다.
3. **provider 동등성 테스트 실행**: `test/e2e/scenarios/05-provider-equivalence-contracts.js`와 기존 E2E 전체를 실행한다.

### Multica agent runtime과 혼동하지 않는 방법

이 문서의 "provider 분리"와 Multica agent의 Specialist/Reviewer 역할 분리는 별개 축이다.

| 구분 | 주체 | 목적 |
|------|------|------|
| built `do`/`check` provider | Claude, Codex (로컬 subprocess) | feature phase 실행 엔진 선택 |
| Multica Specialist | 에이전트 (이슈 시스템) | 설계/분석 담당 운영 역할 |
| Multica Reviewer | 에이전트 (이슈 시스템) | PR 코드 리뷰 담당 운영 역할 |

고위험 변경에서 Multica Specialist는 architecture 판단을 담당하고, Multica Reviewer는 PR 코드를 검토한다. 이 역할 분기는 built provider 선택과 독립적이다.

혼동 방지 원칙:
- built `check` phase를 "Reviewer가 돌린다"고 표현하지 않는다. `check`는 built runner가 provider subprocess를 호출하는 phase다.
- Multica Reviewer의 승인이 built `check` phase를 자동 트리거하지 않는다.
- built provider 전환 작업 자체가 고위험이면 Multica Coordinator/Specialist 판단을 받은 뒤 Builder가 구현한다.

### 운영 예시: provider 전환 고위험 feature

1. Coordinator가 architecture 판단 후 Specialist로 라우팅.
2. Specialist가 ADR 초안 작성, Builder로 라우팅.
3. Builder는 feature의 `run-request.json`에 cross-provider 설정을 적용하고 구현.
4. built runner: plan_synthesis(Codex) → do(Codex) → check(Claude) 순서로 실행.
5. Provider 동등성 테스트 통과 확인.
6. Multica Reviewer가 PR 코드를 검토.

---

## 5. 참조

- 설정 계약: `docs/contracts/provider-config.md`
- provider 이벤트 계약: `docs/contracts/provider-events.md`
- provider 비교 모드 설계: `docs/ops/provider-comparison-mode.md`
- provider 동등성 체크리스트: `docs/review-checklist-provider-equivalence.md`
- KG 결정: `kg/decisions/phase-provider-routing-matrix.md`
- KG 결정 (비교 모드): `kg/decisions/provider-comparison-mode-boundary.md`
- KG 결정 (기본값/sandbox): `kg/decisions/provider-config-default-and-sandbox-policy.md`
- KG 결정 (plan_synthesis): `kg/decisions/plan-synthesis-contract-and-opt-in-smoke.md`
- North-star 목표: `kg/goals/north-star.md`
