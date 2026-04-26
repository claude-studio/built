---
id: BUI-95
title: "[Backlog] run-opus/run-sonnet의 run-request.json 생성 경로 표준화"
type: issue
date: 2026-04-27
status: completed
agent: Builder
branch: agent/builder/2f608ed1
pr: https://github.com/claude-studio/built/pull/107
merge_commit: d9c4b779652e25ad56ee1eb7d457b9fd819f6068
kg_files: [kg/issues/BUI-95.md, kg/decisions/provider-preset-run-request-boundary.md, kg/workflows/provider-preset-helper-validation.md]
week: 17
tags: [backlog, provider, preset, skills, runtime, marketplace]
keywords: [run-opus run-sonnet run-request provider-preset marketplace cache cwd artifact preservation]
---

## 목표

`/built:run-opus`와 `/built:run-sonnet`의 `run-request.json` 생성 경로를 `provider-preset.js` helper로 표준화한다.
shell echo로 JSON을 직접 만드는 문서 예시를 제거하고, marketplace/plugin cache cwd에서 대상 프로젝트가 아닌 위치에 `.built/runtime`이 생기는 회귀를 막는다.

## 구현 내용

- `scripts/provider-preset.js`가 대상 프로젝트 cwd의 `.built/features/<feature>.md`를 확인한 뒤에만 `.built/runtime/runs/<feature>/run-request.json`을 쓰도록 했다.
- 기존 요청 파일의 `createdAt`, `planPath`, `dry_run`, `max_cost_usd` 같은 실행 보조 필드는 모델 preset 재적용 시 보존한다.
- `claude-default` preset을 적용하면 기존 custom `providers`를 제거해 기본 Claude phase fallback 의미로 되돌린다.
- `skills/run-opus/SKILL.md`, `skills/run-sonnet/SKILL.md`, `skills/run/SKILL.md`는 대상 프로젝트 cwd를 유지하고 plugin/repo script는 `SCRIPT_DIR` 절대 경로로 호출하도록 정리했다.
- `test/plugin-packaging.test.js`에 plugin cache cwd에서 helper 실행이 실패하고 cache 안에 `.built`를 만들지 않는 회귀 테스트를 추가했다.

## 결정 내용

- 모델 변형 skill은 `run-request.json`을 직접 echo하지 않고 `provider-preset.js` helper를 통해 작성한다.
- helper의 쓰기 기준은 plugin 위치가 아니라 대상 프로젝트 cwd다.
  feature spec이 없는 cwd에서는 실패해야 하며 runtime artifact를 생성하지 않는다.
- `claude-default`는 `providers` 필드를 비워두는 것이 아니라 기존 custom `providers`를 제거해 fallback 의미를 명확히 복구한다.
- 모델 선택은 실행 보조 필드와 독립적이므로 기존 `createdAt`, `planPath`, `dry_run`, `max_cost_usd`는 보존한다.

## 결정 이유

- shell echo 방식은 feature 이름 escaping, 기존 필드 보존, JSON 유효성 면에서 `src/state.js`와 helper 계약에서 쉽게 drift된다.
- marketplace 설치 환경에서 실행자가 plugin cache로 `cd`하면 target project가 아닌 plugin cache에 `.built/runtime`이 생길 수 있다.
  feature spec gate와 cache cwd 회귀 테스트가 이 재현축을 직접 막는다.
- run 단위 요청 파일은 provider/model handoff의 계약면이므로, model preset 재적용이 사용자 지정 실행 제약을 지우면 안 된다.

## 발생한 이슈와 review history

- 2026-04-25 KST에는 agents-v2 운영모델과 provider/contracts 재정의가 선행되어야 한다는 이유로 임시 freeze 되었다.
- 2026-04-26 23:37 KST 도그푸딩 재현으로 backlog/high로 복구되었다.
  사용자가 `/built:run-opus`를 feature 인자 없이 실행한 뒤 plugin cache cwd에서 `provider-preset.js`와 `run.js`가 호출되어 cache 안에 `.built/runtime/runs/todo-list-service/run-request.json`이 생긴 것이 재현 근거였다.
- Builder는 PR #107, branch `agent/builder/2f608ed1`, head commit `494d82cf45fad3963b199d0cc6af6f1b15692208`로 구현을 제출했다.
- Reviewer 1차 검토는 file/config contract와 marketplace/plugin cache 동작 변경 때문에 Specialist second-review를 요청했다.
- Specialist second-review는 차단 이슈 없음으로 판단했고, custom `planPath` 확장 계약은 후속 정리 가능성만 남겼다.
- Reviewer 최종 PASS는 2026-04-27 00:07 KST에 확정되었다.

## 완료 기준 충족 여부

| 기준 | 상태 |
|------|------|
| 모델 지정용 helper 또는 state.js 기반 helper 사용 | 완료 |
| `run-opus`/`run-sonnet` skill이 helper 호출로 정리 | 완료 |
| `run-request.json` 생성 및 cache cwd 오염 방지 테스트 추가 | 완료 |
| assignee 없는 기존 백로그와 무관하게 `npm test` 통과 | 완료 |

검증:
- `node test/plugin-packaging.test.js` 통과
- `node test/providers-presets.test.js` 통과
- `npm test` 통과

## 재발 방지 포인트

- skill 문서에서 `run-request.json`을 shell echo로 직접 만들지 않는다.
- marketplace/plugin cache 환경에서 script 절대 경로를 쓰더라도 cwd는 대상 프로젝트 루트로 유지해야 한다.
- helper는 feature spec이 없는 cwd에 `.built`를 생성하면 안 된다.
- `claude-default` 재적용은 custom `providers` 제거를 검증하고, 실행 보조 필드 보존도 함께 검증한다.
- custom `planPath`를 실제 feature spec 입력으로 쓰는 확장 계약이 생기면 `run.js`/`do.js`의 기본 feature spec 요구와 별도 후속으로 정렬한다.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-95",
  "name": "[Backlog] run-opus/run-sonnet의 run-request.json 생성 경로 표준화",
  "agent": {"@type": "SoftwareAgent", "name": "Builder"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/107"},
  "actionStatus": "CompletedActionStatus"
}
```
