---
id: WF-29
title: plan-draft target project root 검증 워크플로우
type: workflow
date: 2026-04-27
validated_by: [BUI-343]
tags: [plan, draft, file-contract, plugin-cache, validation]
---

## 패턴 설명

`scripts/plan-draft.js`와 `/built:plan` skill은 plugin repo가 아니라 target project의 `.built/runs/<feature>/plan-draft.md`를 읽고 써야 한다.
plugin script를 절대 경로로 require하는 marketplace/plugin cache 환경에서는 helper 파일 위치와 target project cwd가 달라질 수 있으므로 root 해석 계약을 별도로 검증한다.

## 언제 사용하나

- `scripts/plan-draft.js`의 read/write/remove/buildContent 동작을 수정할 때
- `skills/plan/SKILL.md`에서 draft 저장, 재개, 삭제 절차를 바꿀 때
- `docs/contracts/file-contracts.md`의 `plan-draft.md` 계약을 바꿀 때
- plugin cache나 절대 경로 require 환경에서 `/built:plan` 실행 방식을 조정할 때

## 단계

1. target project fixture를 만들고 helper를 plugin repo 절대 경로로 require한다.
2. helper 실행 cwd를 target project root로 둔 상태에서 draft를 작성한다.
3. draft가 target project `.built/runs/<feature>/plan-draft.md`에 생성됐는지 확인한다.
4. plugin repo 또는 plugin cache 아래 `.built/runs`에 draft가 생기지 않았는지 확인한다.
5. cwd를 일부러 다른 위치로 둔 뒤 `{ projectRoot }`, `BUILT_PROJECT_ROOT`, argv `--project-root` 중 필요한 escape hatch가 target project root를 우선하는지 확인한다.
6. `node -e` argv 예시는 `node -e "require('/path/to/plugin/scripts/plan-draft.js').write(...)" -- --project-root <TARGET_PROJECT_ROOT>` 형식으로 검증한다.
7. `node test/plan-draft.test.js`를 실행하고, 관련 계약 변경이 넓으면 `node scripts/run-tests.js --unit`까지 실행한다.
8. 문서 변경 시 `docs/contracts/file-contracts.md`와 `skills/plan/SKILL.md`가 같은 root 우선순위와 `node -e` 형식을 설명하는지 확인한다.

## 주의사항

- `__dirname`은 helper 파일 위치이므로 target project root로 사용하지 않는다.
- 기본 root는 `process.cwd()`이며, runner가 cwd를 보장하지 못할 때만 명시 root를 전달한다.
- `node -e`에서 `--` separator 없이 `--project-root`를 넘기면 Node 옵션으로 해석될 수 있다.
- provider나 runner가 `plan-draft.md` file contract를 직접 소유한다고 표현하지 않는다.
  `/built:plan` helper가 target project `.built/runs/<feature>/plan-draft.md`를 관리한다.
