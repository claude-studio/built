---
id: WF-15
title: Provider Doctor Diagnostics
type: workflow
date: 2026-04-26
validated_by: [BUI-168, BUI-176]
tags: [provider, diagnostics, codex, broker, smoke, regression, skill]
---

## 패턴 설명

provider doctor는 실제 provider 실행 전에 로컬 환경, broker 상태, run-request 설정을 읽기 전용으로 점검하는 diagnostics 절차다.
핵심은 사용자 조치가 필요한 설치/인증/설정 실패를 smoke 실패와 분리하고, broker stale 후보나 실행 경합은 자동 삭제 없이 `warn`으로 안내하는 것이다.
BUI-176 이후 Claude Code plugin 사용자는 `/built:doctor` skill로 같은 diagnostics script를 실행할 수 있다.

## 언제 사용하나

- real Codex smoke를 실행하기 전 환경 준비 상태를 확인할 때
- Claude Code plugin 안에서 `/built:doctor`로 provider 환경을 점검할 때
- Codex CLI 설치, app-server 지원, 로그인 상태 관련 사용자 문의를 분리할 때
- broker session 또는 lock stale 후보를 운영자가 확인해야 할 때
- `.built/runtime/runs/<feature>/run-request.json`의 provider 설정을 runner와 같은 parser로 사전 검증할 때
- feature registry에 running 상태가 남아 broker 경합 가능성이 있는지 확인할 때

## 단계

1. Claude Code plugin에서는 `/built:doctor`로 기본 환경 점검을 실행한다.
2. 로컬 개발이나 plugin 외부에서는 `node scripts/provider-doctor.js` 또는 `npm run doctor`로 기본 환경 점검을 실행한다.
3. 자동화나 CI에서 결과를 소비해야 하면 `/built:doctor --json` 또는 `node scripts/provider-doctor.js --json`을 사용한다.
4. 특정 feature 설정까지 확인해야 하면 `/built:doctor --feature <featureId>` 또는 `--feature <featureId>`를 추가한다.
5. skill은 `scripts/provider-doctor.js` 호출 경로와 인자 전달만 담당하고 diagnostics 로직은 중복 구현하지 않는다.
6. Codex 설치 점검은 binary 없음과 app-server 미지원 상태를 분리해 본다.
7. 인증 점검은 `codex login status` 기반 결과를 확인하고, 실패하면 사용자에게 `codex login` 조치를 안내한다.
8. broker session 점검은 PID 생존 여부를 먼저 보고, unix endpoint는 socket 파일 존재 여부까지만 확인한다.
9. broker lock 점검은 파싱 실패, stale PID, 30초 초과 lock을 stale 후보로 취급한다.
10. run-request provider 설정은 `parseProviderConfig()` 결과로 검증하고, 별도 doctor 전용 규칙을 만들지 않는다.
11. feature registry에 running feature가 있으면 동시 실행과 broker 경합 가능성을 확인한다.
12. doctor가 `fail`을 반환하면 smoke를 실행하기 전에 표시된 `action`을 먼저 처리한다.
13. doctor가 `warn`만 반환하면 실행은 가능하지만 stale broker, lock, registry 상태를 확인한 뒤 smoke 여부를 판단한다.
14. doctor가 `ok`여도 실제 provider 응답, 산출물, file contract 검증은 smoke 테스트에서 별도로 확인한다.

## 주의사항

- doctor는 실제 모델 호출이나 `/built:run` 실행을 수행하지 않는다.
- `/built:doctor` skill은 diagnostics script의 wrapper이며 별도 validator나 broker cleanup을 수행하지 않는다.
- doctor는 broker session이나 lock 파일을 자동 삭제하지 않는다.
  삭제가 필요하면 기존 broker lifecycle 정책의 안전 조건 또는 명시 사용자 조치에 따른다.
- JSON 출력에는 raw stderr, token, API key, private environment value, raw debug dump를 포함하지 않는다.
- `warn`은 운영자가 확인할 신호이며 `fail`과 같은 차단 상태로 취급하지 않는다.
- unix socket은 파일 존재 여부만 확인한다.
  실제 연결 가능성과 provider 응답은 smoke의 책임이다.
- provider config 계약이 바뀌면 `docs/contracts/provider-config.md`, parser 테스트, doctor 테스트를 함께 갱신한다.

## 관련 문서

- `scripts/provider-doctor.js`
- `src/providers/doctor.js`
- `skills/doctor/SKILL.md`
- `test/provider-doctor.test.js`
- `docs/ops/provider-setup-guide.md`
- `docs/smoke-testing.md`
- `docs/contracts/provider-config.md`
- `kg/decisions/provider-doctor-skill-boundary.md`
- `kg/decisions/codex-broker-lifecycle-policy.md`
- `kg/decisions/provider-failure-taxonomy-and-message-boundary.md`
