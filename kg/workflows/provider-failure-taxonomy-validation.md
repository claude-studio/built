---
id: WF-6
title: Provider Failure Taxonomy Validation
type: workflow
date: 2026-04-26
validated_by: [BUI-132]
tags: [provider, failure, contracts, validation, regression]
---

## 패턴 설명

provider 실패 표현을 바꿀 때는 raw error, 사용자-facing 메시지, runner 판단 필드를 분리해 검증한다.
핵심은 provider가 표준 `failure` 객체를 만들고, writer/runner가 이를 `logs/<phase>.jsonl`, `progress.json`, `state.json` 계층에 맞게 기록하는지 확인하는 것이다.

## 언제 사용하나

- `src/providers/failure.js`의 taxonomy, classifier, sanitize 규칙을 바꿀 때
- Claude 또는 Codex provider의 auth/config/sandbox/timeout/model response 실패 경로를 수정할 때
- `src/providers/event-normalizer.js`의 error event fallback 또는 terminal ordering을 바꿀 때
- `src/providers/standard-writer.js`, `src/progress-writer.js`, `scripts/run.js`의 failure 기록/승격 경로를 바꿀 때
- `docs/contracts/provider-events.md` 또는 `docs/contracts/file-contracts.md`의 error/last_failure 계약을 바꿀 때

## 단계

1. 관련 계약과 KG를 확인한다:
   `docs/contracts/provider-events.md`, `docs/contracts/file-contracts.md`,
   `kg/decisions/provider-event-normalization-and-standard-writer.md`,
   `kg/decisions/provider-failure-taxonomy-and-message-boundary.md`.
2. 실패 유형을 `auth`, `config`, `sandbox`, `timeout`, `provider_unavailable`, `model_response`, `runner_normalize`, `runner_io`, `unknown` 중 하나로 분류한다.
3. 새 실패 경로는 `user_message`, `action`, `retryable`, `blocked`, `code`, `debug_detail` 기대값을 먼저 정한다.
4. provider raw error를 사용자 메시지에 직접 넣지 않고 `sanitizeDebugDetail()`을 거친 `debug_detail`로만 보존한다.
5. error event는 `message`, `retryable`, `failure`를 함께 포함해 하위 호환을 유지한다.
6. `progress.json.last_failure`에는 debug detail을 제외한 요약만 기록되는지 확인한다.
7. `state.json.last_failure`는 provider가 직접 쓰지 않고 runner가 progress에서 승격하는지 확인한다.
8. `logs/<phase>.jsonl`에는 표준 error event가 남고 terminal event 이후 추가 event가 없는지 확인한다.
9. 테스트는 최소 `providers-failure`, 변경 provider 테스트, `providers-normalizer`, `file-contracts`를 함께 실행한다.
10. retryable 의미 변경이 있으면 자동 retry trigger인지 단순 분류 신호인지 리뷰 코멘트와 KG에 명시한다.

## 주의사항

- `last_error`는 문자열 하위 호환 필드다. 구조화 정보를 넣기 위해 의미를 바꾸지 않는다.
- `retryable=true`는 자동 재실행 허가가 아니다.
  자동 retry가 붙으면 retry cap과 failure kind별 정책을 별도 계약으로 둔다.
- `blocked=true`는 사용자의 설정, 인증, 권한, 환경 조치가 필요하다는 신호로 사용한다.
- `provider_unavailable`은 binary 없음, app-server 미지원, broker busy/start 실패를 모두 담을 수 있으므로 `code`와 `action`으로 세분화한다.
- state/progress에는 `debug_detail`, raw stderr, token 후보, private environment value를 기록하지 않는다.
- `unknown` fallback은 실패를 숨기는 용도가 아니다.
  debug detail과 후속 taxonomy 추가 후보를 남겨야 한다.
