---
id: ADR-19
title: provider doctor skill 책임 경계
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-176
tags: [provider, diagnostics, doctor, skill, plugin, security]
---

## 컨텍스트

BUI-168은 provider doctor core와 `scripts/provider-doctor.js` diagnostics 명령을 추가했다.
BUI-176은 같은 점검을 Claude Code plugin 사용자가 `/built:doctor`로 실행할 수 있게 연결해야 했다.

skill이 자체 진단 로직을 갖기 시작하면 script, module, docs가 각자 Codex CLI 설치, 인증, app-server 지원, broker 상태, run-request provider 설정을 다르게 해석할 수 있다.
또한 skill은 사용자-facing UX이므로 raw env, token, provider stderr 같은 디버그 값을 직접 노출하지 않는 경계가 필요하다.

## 결정

`skills/doctor/SKILL.md`는 provider diagnostics의 사용자 UX 진입점으로만 둔다.
skill은 plugin 설치 경로와 로컬 개발 경로에서 `scripts/provider-doctor.js`를 어떻게 실행하는지, 어떤 인자를 전달하는지, 어떤 비범위를 지키는지만 문서화한다.

실제 diagnostics 로직은 `src/providers/doctor.js`에 둔다.
CLI 포맷, 종료 코드, `--json`, `--cwd`, `--feature` 인자 처리는 `scripts/provider-doctor.js`가 담당한다.
skill은 별도 validator, broker cleanup, provider 호출, smoke 실행을 수행하지 않는다.

README와 provider setup guide는 `/built:doctor`를 smoke 전 사전 점검 진입점으로 연결하되, 실제 provider 응답과 산출물 계약 검증은 smoke 테스트 책임으로 남긴다.

## 근거

- 하나의 diagnostics script를 plugin과 로컬 개발이 공유해야 점검 항목과 failure 메시지가 drift되지 않는다.
- skill은 Claude Code plugin 명령 UX에 가깝고, provider 상태 판정의 SSOT가 되기에는 테스트와 계약 관리 위치가 맞지 않는다.
- 실제 모델 호출을 skill에 넣으면 doctor와 smoke의 책임 경계가 흐려지고 비용, 인증, 네트워크 의존성이 기본 점검에 들어온다.
- raw env와 provider stderr를 skill 예시에 두지 않아야 ADR-9의 사용자 메시지와 debug detail 분리 원칙을 유지할 수 있다.
- broker stale 후보는 읽기 전용 `warn`으로만 안내해야 하며 skill이 자동 cleanup을 수행하면 ADR-8의 broker lifecycle 정책을 우회할 수 있다.

## 결과

- `/built:doctor`는 `skills/doctor/SKILL.md`를 통해 사용자 호출 가능한 provider 사전 점검 명령이 되었다.
- plugin 경로에서는 skill 파일 기준 `../../scripts/provider-doctor.js`를 호출한다.
- 로컬 개발 경로에서는 `node scripts/provider-doctor.js --cwd "$(pwd)"`를 직접 호출한다.
- `--feature <featureId>`는 run-request provider 설정 검증을 포함하고, `--json`은 구조화 결과 소비를 위한 출력으로 유지한다.
- README와 `docs/ops/provider-setup-guide.md`는 plugin 명령과 직접 실행 명령을 모두 노출한다.

## 대안

- skill 안에서 shell로 개별 점검을 다시 구현한다: script와 module의 점검 규칙이 중복되어 drift 위험이 커 선택하지 않았다.
- `/built:doctor`가 `npm run doctor`만 실행하게 한다: plugin 설치 경로와 로컬 개발 경로가 달라질 수 있고, script 위치 계약이 불명확해 선택하지 않았다.
- doctor skill에서 smoke까지 실행한다: 사전 점검과 실제 provider 검증의 책임이 섞여 선택하지 않았다.
- doctor skill이 broker stale 파일을 정리한다: false positive가 실행 중인 broker를 훼손할 수 있어 선택하지 않았다.

## 되돌릴 조건

Claude Code plugin runtime이 skill에서 repo-root script 경로를 안정적으로 제공하는 표준 helper를 제공하면 경로 해석 문서를 그 helper 기준으로 단순화할 수 있다.
그 경우에도 skill은 diagnostics 로직을 중복 구현하지 않고 script/module에 위임하는 원칙을 유지한다.

provider doctor가 실제 smoke나 cleanup을 포함하는 별도 product로 승격되면 `/built:doctor` 대신 별도 명령과 별도 workflow로 분리해야 한다.
