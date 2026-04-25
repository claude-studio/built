# Provider transition roadmap

작성일: 2026-04-26 KST

이 문서는 `built`를 Claude 전용 실행 구조에서 provider 기반 실행 구조로 전환하기 위한 전체 로드맵이다.

## 목표

`built`의 사용자 경험과 결과 파일 계약은 유지하면서 내부 실행 엔진을 phase별 provider로 분리한다.

현재 구조:

```text
built run
  -> claude -p 직접 실행
  -> progress/result/state 파일 저장
```

목표 구조:

```text
built run
  -> provider 선택
     -> claude provider
     -> codex provider
  -> built runner/writer가 progress/result/state 파일 저장
```

## 비목표

- Claude Code plugin 구조 제거
- 모든 phase를 Codex로 강제 전환
- 같은 Do phase를 Claude와 Codex가 기본으로 동시에 실행
- provider가 `progress.json`, `state.json`, result markdown을 직접 작성
- usage/cost 정규화를 초기 필수 기능으로 강제

## 기준 문서

- `docs/research/codex-plugin-cc.md`
- `docs/contracts/file-contracts.md`
- `docs/contracts/provider-events.md`
- `docs/contracts/provider-config.md`
- `docs/contracts/plan-synthesis-input.md`
- `docs/roadmaps/provider-transition-work-items.md`
- `docs/roadmaps/provider-transition-review-checklist.md`

## 단계 요약

### PR 0a: Codex plugin reference 분석

상태: 완료

산출물:

- `docs/research/codex-plugin-cc.md`

핵심 결정:

- Codex는 CLI batch 호출보다 `codex app-server` 기반으로 접근한다.
- `dependency`는 현재 부적합하다.
- 전체 재구현보다 최소 vendor copy가 안전하다.
- background job store와 review gate는 built에 가져오지 않는다.

### PR 0b: Codex app-server vendor runtime 추가

상태: 완료

산출물:

- `vendor/codex-plugin-cc/`

완료 기준:

- Apache-2.0 `LICENSE`와 `NOTICE` 보존
- app-server/broker runtime 최소 subset만 포함
- built pipeline에는 아직 연결하지 않음
- 동적 import로 주요 runtime 함수 로드 가능
- 기존 테스트 통과

### PR 1: provider 계약 문서화

상태: 완료

산출물:

- `docs/contracts/file-contracts.md`
- `docs/contracts/provider-events.md`
- `docs/contracts/provider-config.md`
- `docs/contracts/plan-synthesis-input.md`

완료 기준:

- provider가 파일을 직접 쓰지 않는 원칙 명시
- `phase_start`, `text_delta`, `tool_call`, `tool_result`, `phase_end`, `error`, optional `usage` 이벤트 정의
- provider 설정 단축형/상세형 정의
- sandbox 정책과 review gate 비결합 명시
- `plan_synthesis` 입력 계약 명시

### PR 2: Claude provider 추출

상태: 예정

목표:

- 현재 `pipeline-runner.js`의 Claude 직접 호출을 `src/providers/claude.js`로 분리한다.
- 외부 동작은 바꾸지 않는다.
- 현재 Claude 결과 파일 계약을 contract test로 고정한다.

완료 기준:

- 기존 `runPipeline()` public API 유지
- stream-json mode 동작 유지
- json schema mode 동작 유지
- `progress.json`, `logs/<phase>.jsonl`, `do-result.md`, structured check output 회귀 없음
- `npm test` 통과

### PR 3: provider config parser 추가

상태: 예정

목표:

- phase별 provider 설정을 읽고 normalize한다.
- 설정이 없으면 기존 Claude 기본값을 유지한다.

완료 기준:

- 단축형 `"do": "codex"` 지원
- 상세형 `{ "name": "codex", "model": "...", "sandbox": "..." }` 지원
- phase별 기본값 정의
- 잘못된 provider 이름, 잘못된 sandbox, 잘못된 timeout 검증
- 기존 config가 없는 프로젝트에서 동작 변화 없음

### PR 4: fake provider E2E

상태: 예정

목표:

- 실제 Claude/Codex 호출 없이 provider interface와 file contract를 검증한다.

완료 기준:

- fake Claude provider와 fake Codex provider를 같은 runner 계약으로 실행 가능
- provider가 달라도 결과 파일 필수 필드 동일
- `progress.json` key set 회귀 없음
- `logs/<phase>.jsonl`에 표준 provider event 기록
- CI에서 외부 인증 없이 실행 가능

### PR 5a: real Codex plan_synthesis MVP

상태: 예정

목표:

- Codex app-server provider를 가장 낮은 위험의 `plan_synthesis` phase에 먼저 연결한다.
- 파일 수정 없는 read-only 흐름으로 real Codex runtime을 검증한다.

완료 기준:

- `codex app-server` readiness/login check
- `plan_synthesis` 입력 payload 생성
- Codex output을 built 결과 계약으로 normalize
- real Codex smoke test는 일반 `npm test`에서 분리
- 실패 시 기존 Claude 기반 flow에 영향 없음

### PR 5b: real Codex do phase MVP

상태: 예정

목표:

- Codex provider로 실제 구현 phase를 수행할 수 있게 한다.

완료 기준:

- `sandbox: "workspace-write"` 검증
- provider별 또는 run별 worktree 격리
- Codex output이 built result writer를 통해 저장
- 기존 `do-result.md` 계약 유지
- 같은 acceptance criteria와 검증 명령으로 완료 판정
- 구현 provider와 review provider 분리 가능

### PR 6: KG/documentation cleanup

상태: 예정

목표:

- 문서와 KG에 남은 Claude 전용 표현을 provider 중립 표현으로 정리한다.

완료 기준:

- `claude -p`가 실제 구현 디테일인 곳과 사용자-facing 설명인 곳을 분리
- built provider와 Multica agent runtime을 혼동하지 않도록 문서화
- README와 design 문서가 provider 구조를 반영

## Multica 전환 경계

PR 0a, PR 0b, PR 1은 개발 전 준비 작업으로 직접 수행했다.

PR 2부터는 실제 코드 구조 변경이므로 Multica 티켓 기반으로 처리한다.

Multica 티켓은 다음 원칙을 따라야 한다.

- 이슈 제목/설명/코멘트는 한글로 작성
- 사용자-visible 시간은 KST 기준
- 티켓 description에 관련 계약 문서 링크 포함
- 구현자는 계약 문서를 기준으로 작업
- 리뷰어는 `docs/roadmaps/provider-transition-review-checklist.md` 기준으로 확인

## 병렬 비교 실행 정책

기본 실행에서는 한 phase에 provider 하나만 실행한다.

Claude와 Codex를 같은 feature에서 동시에 실행해 비교하는 흐름은 명시적 실험 모드에서만 허용한다.

실험 모드를 허용할 경우:

- provider별 worktree 분리
- provider별 output directory 분리
- 최종 merge 대상은 검증을 통과한 하나만 선택

## 완료 판단

provider 전환의 완료는 "Codex도 실행된다"가 아니다.

완료 기준은 다음이다.

- 기존 Claude flow 회귀 없음
- Codex provider가 최소 `plan_synthesis`와 `do`에서 동작
- provider가 달라도 built file contract 유지
- 같은 acceptance criteria와 검증 명령으로 완료 판정
- real provider smoke test가 일반 CI와 분리
- 사용자-facing 명령의 사용성 유지
