# Provider transition work items

작성일: 2026-04-26 KST

이 문서는 provider 전환 작업을 Multica 티켓으로 분해하기 위한 작업 목록이다.

## 운영 원칙

- PR 2부터 실제 개발 작업은 Multica 티켓으로 처리한다.
- 이슈 제목, 설명, 코멘트는 한글로 작성한다.
- 사용자-visible 시간은 KST 기준으로 작성한다.
- 티켓에는 assignee를 미리 지정하지 않는다.
- 티켓 description에는 관련 계약 문서와 완료 기준을 명시한다.
- 작업은 작게 나누고, 각 티켓은 독립적으로 리뷰 가능해야 한다.

## 티켓 1: Claude provider 추출 및 현재 동작 contract test 추가

권장 제목:

```text
[Provider] Claude provider 추출 및 현재 동작 contract test 추가
```

목표:

- 기존 Claude 직접 호출부를 provider 모듈로 이동한다.
- 외부 동작 변화 없이 리팩터링한다.
- 현재 결과 파일 계약을 contract test로 고정한다.

참고 문서:

- `docs/contracts/file-contracts.md`
- `docs/contracts/provider-events.md`
- `docs/roadmaps/provider-transition-review-checklist.md`

작업 범위:

- `src/pipeline-runner.js`
- `src/providers/claude.js`
- `test/pipeline-runner.test.js`
- 필요한 경우 provider 단위 테스트

완료 기준:

- `runPipeline()` API 유지
- stream-json mode 회귀 없음
- json schema mode 회귀 없음
- `progress.json`, `logs/<phase>.jsonl`, `do-result.md`, structured output 계약 유지
- provider는 결과 파일을 직접 쓰지 않음
- `npm test` 통과

비범위:

- Codex provider 구현
- provider config parser
- real Codex 호출

## 티켓 2: provider config parser 추가

권장 제목:

```text
[Provider] phase별 provider 설정 parser 추가
```

목표:

- run-request/config에서 phase별 provider 설정을 읽고 normalize한다.
- 설정이 없으면 기존 Claude 동작을 유지한다.

참고 문서:

- `docs/contracts/provider-config.md`

작업 범위:

- provider 설정 parser 모듈
- config validation
- 단위 테스트

완료 기준:

- 단축형 provider 설정 지원
- 상세형 provider 설정 지원
- phase별 기본 provider는 Claude
- `do`/`iter`에서 Codex + read-only sandbox 조합은 경고 또는 validation 대상
- 기존 config 없는 프로젝트 동작 변화 없음
- `npm test` 통과

비범위:

- real Codex provider 연결

## 티켓 3: fake provider 기반 E2E 추가

권장 제목:

```text
[Provider] fake provider 기반 file contract E2E 추가
```

목표:

- provider interface와 result writer 계약을 실제 외부 LLM 없이 검증한다.

참고 문서:

- `docs/contracts/file-contracts.md`
- `docs/contracts/provider-events.md`

작업 범위:

- fake provider
- E2E scenario
- result/progress/log 비교 assertion

완료 기준:

- fake Claude/fake Codex가 같은 runner interface로 실행 가능
- provider가 달라도 결과 파일 필수 필드 동일
- progress/log key set 검증
- CI에서 인증 없이 실행 가능
- `npm test` 또는 E2E test 통과

비범위:

- real Codex 호출

## 티켓 4: Codex provider app-server adapter MVP

권장 제목:

```text
[Provider] Codex app-server provider adapter MVP 추가
```

목표:

- 벤더링된 Codex app-server runtime을 built provider interface 뒤에서 호출한다.
- 초기에는 파일 수정 없는 read-only 실행만 검증한다.

참고 문서:

- `docs/research/codex-plugin-cc.md`
- `docs/contracts/provider-events.md`
- `vendor/codex-plugin-cc/README.md`

작업 범위:

- `src/providers/codex.js`
- Codex readiness/login check
- app-server notification -> provider event mapping
- smoke test guard

완료 기준:

- `codex app-server` runtime 호출 가능
- `threadId`, `turnId`, `duration_ms`, provider/model metadata 반환
- raw Codex notification을 built provider event로 normalize
- real Codex smoke test는 `npm test`와 분리
- 일반 CI는 fake provider만 사용

비범위:

- do phase 파일 수정
- Codex를 기본 provider로 변경

## 티켓 5: plan_synthesis phase 도입

권장 제목:

```text
[Provider] plan_synthesis phase 도입 및 Codex smoke 연결
```

목표:

- interactive discovery 이후 `plan_synthesis` 산출물을 만들 수 있게 한다.
- Codex provider의 첫 real 사용처로 read-only phase를 연결한다.

참고 문서:

- `docs/contracts/plan-synthesis-input.md`
- `docs/contracts/provider-config.md`

작업 범위:

- plan_synthesis input payload 생성
- plan_synthesis output 저장 위치 확정
- `do` phase가 plan_synthesis 산출물을 읽는 경로 준비
- smoke test

완료 기준:

- provider가 필요한 입력을 세션 기억 없이 payload로 받음
- plan_synthesis는 파일 수정 없음
- 산출물은 canonical path에 저장
- `do`가 같은 plan_synthesis 결과를 참조 가능
- smoke test는 opt-in

## 티켓 6: Codex do phase MVP

권장 제목:

```text
[Provider] Codex do phase MVP 연결
```

목표:

- Codex provider로 실제 구현 phase를 수행한다.

참고 문서:

- `docs/contracts/file-contracts.md`
- `docs/contracts/provider-config.md`
- `docs/roadmaps/provider-transition-review-checklist.md`

작업 범위:

- `do` phase provider 선택
- `sandbox: "workspace-write"` 검증
- worktree/run 격리
- Codex final output -> built result writer 연결
- 검증 명령 실행 결과 반영

완료 기준:

- Codex provider가 `do` phase에서 파일 변경 가능
- provider가 결과 파일 직접 작성하지 않음
- built writer가 `do-result.md`, `progress.json`, logs 생성
- 기존 Claude do flow 회귀 없음
- 검증 실패 시 completed로 보지 않음
- real Codex E2E는 opt-in

## 티켓 7: 문서와 KG의 provider 중립화

권장 제목:

```text
[Docs] provider 구조 반영 및 Claude 전용 표현 정리
```

목표:

- 사용자-facing 문서와 KG에서 Claude 전용 표현을 provider 구조에 맞게 정리한다.

작업 범위:

- README
- BUILT-DESIGN
- KG decision/workflow 문서
- 필요한 경우 command help text

완료 기준:

- 실제 구현 디테일인 `claude -p`와 사용자-facing provider 개념이 분리됨
- built provider와 Multica agent runtime이 혼동되지 않음
- Codex provider는 opt-in임을 명시

## 티켓 생성 템플릿

```markdown
## 배경

provider 전환 로드맵의 <단계> 작업입니다.

## 참고 문서

- `docs/roadmaps/provider-transition.md`
- `docs/contracts/...`

## 작업 범위

- ...

## 완료 기준

- ...
- `npm test` 통과

## 비범위

- ...

## 리뷰 기준

- `docs/roadmaps/provider-transition-review-checklist.md`를 기준으로 확인합니다.
```
