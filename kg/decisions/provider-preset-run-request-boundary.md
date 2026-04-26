---
id: ADR-21
title: provider preset helper와 run-request 작성 경계
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-169
related_issues: [BUI-95]
tags: [provider, preset, config, runtime, skills]
---

## 컨텍스트

provider 설정 문서는 사용자가 `run-request.json`의 `providers` 필드에 phase별 provider를 직접 쓰는 방법을 설명한다.
그러나 대표 조합을 매번 수동 작성하면 provider 이름, sandbox, phase 키, timeout 같은 검증 오류가 실행 시점까지 늦게 드러날 수 있다.

또한 skill 문서에 Claude 전용 문구와 `run-request.json` 수동 작성 예시가 섞여 있으면 Codex opt-in 경로와 Claude 기본 경로의 책임 경계가 흐려진다.

## 결정

provider preset helper는 `.built/runtime/runs/<feature>/run-request.json` 생성만 담당한다.
전역 `.built/config.json`에는 provider 설정을 쓰지 않는다.

기본 preset은 다음 4개를 제공한다.

| preset | 의미 |
|--------|------|
| `claude-default` | `providers` 필드를 쓰지 않는 기존 Claude fallback과 동일 |
| `codex-do` | `do`/`iter`는 Codex `workspace-write`, `check`/`report`는 Claude |
| `codex-plan` | `plan_synthesis`만 Codex `read-only`, 나머지는 Claude fallback |
| `codex-all` | 구현된 모든 phase를 Codex로 지정하되 쓰기 phase만 `workspace-write` |

helper는 새 검증 규칙을 독자적으로 만들지 않고 `parseProviderConfig`를 호출해 기존 provider config 계약을 재사용한다.

`run-opus`와 `run-sonnet`은 provider 전환 preset이 아니라 Claude provider의 모델 preset으로 표현한다.
따라서 provider 선택과 모델 선택은 `run-request.json` 안에서 충돌하지 않게 분리한다.

BUI-95에서 모델 preset helper의 쓰기 경계를 추가로 고정했다.
helper는 대상 프로젝트 cwd에 `.built/features/<feature>.md`가 존재할 때만 `.built/runtime/runs/<feature>/run-request.json`을 작성한다.
marketplace/plugin cache cwd처럼 feature spec이 없는 위치에서 실행되면 실패해야 하며, 그 위치에 `.built` runtime artifact를 만들면 안 된다.

`claude-default` 모델 preset을 다시 적용할 때는 기존 custom `providers`를 제거해 기본 Claude phase fallback 의미를 복구한다.
다만 기존 요청 파일의 실행 보조 필드인 `createdAt`, `planPath`, `dry_run`, `max_cost_usd`는 보존한다.

## 근거

- run 단위 `providers` 설정은 feature별 opt-in과 rollback에 적합하다.
- `.built/config.json`에 provider 선택을 쓰면 전역 기본 provider처럼 오해되며 기존 config 검증 계약과 충돌한다.
- preset helper가 parser를 재사용하면 문서 예시, CLI 생성물, runtime 검증이 같은 규칙을 따른다.
- `claude-default`를 빈 providers로 두면 기존 Claude 기본 경로와 legacy 요청 파일이 바뀌지 않는다.
- skill 문서에서 provider 중립 표현을 쓰면 새 provider가 추가되어도 사용자-facing 산출물 계약이 덜 흔들린다.
- plugin cache cwd에서 `.built`를 생성하지 않게 막으면 marketplace 설치 환경에서 플러그인 캐시와 대상 프로젝트 runtime state가 섞이지 않는다.
- `claude-default`가 custom `providers`를 제거해야 사용자가 명시적으로 Claude 기본 경로로 되돌렸다는 의미가 분명해진다.
- 실행 보조 필드는 사용자가 이미 구성한 run 단위 제약이므로 모델만 바꾸는 preset 재적용에서 잃어버리면 안 된다.

## 결과

- 사용자는 `node scripts/provider-preset.js <feature> --preset codex-do` 같은 명령으로 대표 provider 조합을 생성할 수 있다.
- helper가 생성한 요청은 `.built/runtime/runs/<feature>/run-request.json`에만 저장된다.
- 잘못된 preset, provider 이름, sandbox 조합은 실행 전 오류로 실패한다.
- Claude 모델 preset skill은 `--model`을 통해 Claude provider 모델만 지정하고 provider phase 선택과 분리된다.
- `run-opus`와 `run-sonnet` 문서 예시는 대상 프로젝트 cwd를 유지한 채 plugin/repo script 절대 경로를 호출해야 한다.
- plugin cache cwd에서 helper를 실행하는 실수는 쓰기 없이 실패하고, 회귀 테스트는 cache 안에 `.built`가 생기지 않는지 확인한다.

## 대안

- 문서 예시만 유지하고 helper를 만들지 않는다: 사용자가 반복적으로 JSON을 직접 작성해야 하며 parser 검증 전 오류가 숨어 있을 수 있어 선택하지 않았다.
- `.built/config.json`에 provider preset을 저장한다: 전역 기본 provider 변경처럼 보이고 config 계약을 흔들어 선택하지 않았다.
- preset마다 별도 skill을 만든다: provider 조합이 늘어날수록 skill 문서 drift가 커져 선택하지 않았다.
- skill 문서에서 shell echo로 `run-request.json`을 직접 만든다: feature 이름 escaping과 기존 필드 보존이 깨질 수 있고 `src/state.js`/preset helper 계약과 drift가 생겨 선택하지 않았다.

## 되돌릴 조건

workspace 또는 사용자 단위 provider 기본값 정책이 별도 승인되면 전역 설정 위치를 재검토할 수 있다.
그 경우에도 run 단위 opt-in과 `.built/config.json` 검증 계약의 하위 호환은 별도 migration 계획으로 다뤄야 한다.

plugin runtime artifact 위치가 명시적인 `--project-root` 계약으로 바뀌면 cwd 기반 feature spec gate는 재검토할 수 있다.
그 경우에도 plugin cache에 대상 프로젝트 `.built/runtime`을 쓰지 않는 원칙은 유지해야 한다.
