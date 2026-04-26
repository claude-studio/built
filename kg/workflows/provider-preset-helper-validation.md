---
id: WF-18
title: provider preset helper와 skills UX 검증 워크플로우
type: workflow
date: 2026-04-26
validated_by: [BUI-169, BUI-95]
tags: [provider, preset, skills, validation, regression]
---

## 패턴 설명

provider preset helper나 skill 문서의 provider 안내를 바꿀 때는 helper 생성물, parser 검증, 문서 표현 경계를 함께 확인한다.
helper는 사용자의 편의 기능이지만 실제 실행 계약은 `run-request.json`의 `providers` 필드와 `parseProviderConfig`가 결정한다.

## 언제 사용하나

- `src/providers/presets.js`의 preset을 추가하거나 바꿀 때
- `scripts/provider-preset.js` CLI 동작이나 옵션을 바꿀 때
- `skills/run`, `skills/do`, `skills/check`, `skills/iter`, `skills/report`, `skills/run-opus`, `skills/run-sonnet`, `skills/run-codex-do`의 provider 설명을 수정할 때
- Codex opt-in 예시, Claude 기본값, model preset 문구를 정리할 때
- marketplace/plugin cache 설치 환경에서 helper script 절대 경로와 target project cwd가 분리되는 실행 예시를 수정할 때

## 단계

1. 기준 문서 확인: `docs/contracts/provider-config.md`, `docs/ops/provider-setup-guide.md`, `docs/ops/provider-routing-matrix.md`.
2. preset이 `.built/runtime/runs/<feature>/run-request.json`의 `providers` 형식과 일치하는지 확인한다.
3. helper가 `.built/config.json`을 생성하거나 수정하지 않는지 테스트나 코드 리뷰로 확인한다.
4. 모든 preset이 `parseProviderConfig({ providers })`를 통과하는 fixture 테스트를 둔다.
5. `do`와 `iter`에서 Codex를 쓰는 preset은 `sandbox: "workspace-write"`를 포함하는지 확인한다.
6. `check`, `report`, `plan_synthesis`의 read-only Codex 예시는 parser 정책과 맞는지 확인한다.
7. `claude-default` preset은 `providers` 필드를 쓰지 않는 기존 Claude fallback과 동등한지 확인한다.
8. `run-opus`와 `run-sonnet`은 Claude provider 모델 preset으로 설명하고 provider 선택 preset처럼 표현하지 않는다.
9. skill 문서의 사용자-facing 문장은 "설정된 provider" 중심으로 쓰고, `claude -p`는 Claude provider 구현 디테일 설명에만 남긴다.
10. 모델 preset helper는 대상 프로젝트 cwd의 `.built/features/<feature>.md`가 있을 때만 `run-request.json`을 쓰는지 확인한다.
11. plugin cache cwd에서 helper를 실행했을 때 실패하고 cache 안에 `.built`가 생성되지 않는지 packaging 회귀 테스트로 확인한다.
12. `claude-default` 재적용이 기존 custom `providers`를 제거하는지 확인한다.
13. 모델 preset 재적용이 기존 `createdAt`, `planPath`, `dry_run`, `max_cost_usd`를 보존하는지 확인한다.
14. 변경 후 `npm test` 또는 최소 `npm run test:provider:unit`과 preset helper 단위 테스트를 실행한다.

## 주의사항

- preset helper는 provider subprocess를 직접 실행하지 않는다.
- helper가 timeout, sandbox, provider 이름 검증을 직접 재구현하면 parser 계약과 drift가 생긴다.
- 문서에서 미구현 phase를 preset으로 제공하는 것처럼 설명하지 않는다.
- Codex를 기본 provider로 바꾸는 표현은 별도 provider default 결정 없이는 쓰지 않는다.
- generated `run-request.json`의 `createdAt`은 실행 시점 메타이므로 KG나 fixture에 고정값으로 복사하지 않는다.
- skill 문서 예시가 `cd <BUILT_PLUGIN_DIR>` 형태로 plugin cache를 cwd로 만들면 대상 프로젝트 runtime state가 cache에 섞일 수 있다.
- helper가 feature spec gate 전에 `.built/runtime` 디렉터리를 만들면 cache cwd 오염 방지 테스트가 실패해야 한다.
