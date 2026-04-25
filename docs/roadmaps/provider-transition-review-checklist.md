# Provider transition review checklist

작성일: 2026-04-26 KST

이 문서는 provider 전환 PR을 리뷰할 때 확인해야 하는 체크리스트다.

## 공통 리뷰 기준

- [ ] 기존 Claude flow가 회귀하지 않는다.
- [ ] `runPipeline()` public API가 의도 없이 깨지지 않는다.
- [ ] provider가 `.built/` 결과 파일을 직접 쓰지 않는다.
- [ ] 파일 쓰기는 built runner/writer 계층에서 수행된다.
- [ ] `state.json` lifecycle ownership이 유지된다.
- [ ] `progress.json`은 execution snapshot으로 유지된다.
- [ ] usage/cost를 필수 완료 조건으로 만들지 않는다.
- [ ] real provider smoke test가 일반 `npm test`에 섞이지 않는다.

## 파일 계약

기준 문서:

- `docs/contracts/file-contracts.md`

확인 항목:

- [ ] `.built/runtime/runs/<feature>/run-request.json` 의미가 유지된다.
- [ ] `.built/runtime/runs/<feature>/state.json`은 orchestrator가 관리한다.
- [ ] `.built/features/<feature>/progress.json` 필수 필드가 유지된다.
- [ ] `.built/features/<feature>/logs/<phase>.jsonl`은 JSONL로 기록된다.
- [ ] `do-result.md` frontmatter 의미가 유지된다.
- [ ] `check-result.md`의 `approved | needs_changes` 계약이 유지된다.
- [ ] `report.md` 생성 흐름이 깨지지 않는다.

## provider 이벤트

기준 문서:

- `docs/contracts/provider-events.md`

확인 항목:

- [ ] `phase_start`가 첫 이벤트다.
- [ ] `phase_end` 또는 `error`가 terminal 이벤트다.
- [ ] `tool_call`과 `tool_result` pairing이 가능한 구조다.
- [ ] `error` 이후 별도 `phase_end`를 emit하지 않는다.
- [ ] Claude raw event가 표준 provider event로 매핑 가능하다.
- [ ] Codex app-server notification이 표준 provider event로 매핑 가능하다.

## provider 설정

기준 문서:

- `docs/contracts/provider-config.md`

확인 항목:

- [ ] 설정이 없으면 Claude 기본값으로 동작한다.
- [ ] 단축형 provider 설정이 동작한다.
- [ ] 상세형 provider 설정이 동작한다.
- [ ] 잘못된 provider 이름을 검증한다.
- [ ] 잘못된 sandbox 값을 검증한다.
- [ ] `do`/`iter` + Codex 조합에서 `workspace-write` 필요성이 반영된다.
- [ ] review gate가 built phase에 자동 결합되지 않는다.

## plan_synthesis

기준 문서:

- `docs/contracts/plan-synthesis-input.md`

확인 항목:

- [ ] provider가 세션 기억에 의존하지 않는다.
- [ ] feature spec, answers, repo context, acceptance criteria가 payload에 포함된다.
- [ ] plan_synthesis는 파일을 수정하지 않는다.
- [ ] do phase가 같은 plan_synthesis 산출물을 읽을 수 있다.

## Codex provider

기준 문서:

- `docs/research/codex-plugin-cc.md`
- `vendor/codex-plugin-cc/README.md`

확인 항목:

- [ ] vendor runtime을 직접 크게 수정하지 않는다.
- [ ] 수정이 필요하면 변경 이유를 기록한다.
- [ ] app-server readiness/login failure가 명확히 보고된다.
- [ ] broker lifecycle cleanup 경로가 있다.
- [ ] `threadId`, `turnId`, `duration_ms` 같은 디버깅 메타가 보존된다.
- [ ] real Codex 호출은 opt-in smoke test로 분리된다.

## 실제 코드 결과물 갭 축소

확인 항목:

- [ ] Claude와 Codex가 같은 입력 묶음을 받는다.
- [ ] 같은 acceptance criteria를 사용한다.
- [ ] 같은 test/lint/check 명령으로 완료 판정한다.
- [ ] 구현 provider와 review provider를 분리할 수 있다.
- [ ] provider별 실험 실행은 명시적 모드에서만 허용한다.
- [ ] 병렬 비교 실행 시 worktree/output directory가 분리된다.

## 테스트 기준

최소 기준:

- [ ] `npm test`

provider config/parser 변경 시:

- [ ] 단위 테스트 추가
- [ ] 기존 config 없는 프로젝트 회귀 테스트

fake provider 변경 시:

- [ ] fake provider E2E
- [ ] file contract assertion

real Codex 변경 시:

- [ ] 일반 CI에서는 skip
- [ ] 별도 smoke command 또는 환경 변수 guard
- [ ] 인증 실패 메시지 확인

## 리뷰 코멘트 기준

리뷰어는 문제를 다음 기준으로 분류한다.

- `blocking`: 파일 계약, 기존 Claude flow, state lifecycle, 보안/인증, 테스트 회귀
- `needs-follow-up`: 문서 미비, telemetry/usage 보강, 리팩터링 여지
- `non-blocking`: naming, 작은 구조 개선, 후속 clean-up

blocking 항목이 있으면 merge하지 않는다.
