---
id: WF-25
title: Progress Log Compaction Validation
type: workflow
date: 2026-04-26
validated_by: [BUI-227]
tags: [provider, progress, logs, status, compaction, validation]
---

## 패턴 설명

progress/log 표시 경계를 바꿀 때는 사용자-facing snapshot이 bounded 되는지와 원본 JSONL audit log가 손실되지 않는지를 함께 검증한다.
핵심은 `progress.json`의 summary/tail과 `logs/<phase>.jsonl`의 원본 보존 책임을 혼동하지 않는 것이다.

## 언제 사용하나

- `src/progress-compaction.js`의 limit, summary, recent tail 정책을 바꿀 때
- `src/progress-writer.js` 또는 `src/providers/standard-writer.js`가 `progress.json` 필드를 추가하거나 갱신할 때
- `scripts/status.js`의 progress/log 표시 방식을 바꿀 때
- provider event의 `tool_result`, result, error/failure payload 구조를 바꿀 때
- `docs/contracts/file-contracts.md`의 progress/log 계약을 바꿀 때

## 단계

1. 관련 계약과 KG를 확인한다:
   `docs/contracts/file-contracts.md`,
   `kg/decisions/progress-log-compaction-policy.md`,
   `kg/decisions/provider-runner-output-boundary.md`.
2. 사용자-facing 필드와 audit 필드를 분류한다.
   `progress.json`의 `last_text`, `result`, `result_summary`, `last_error`, `recent_events[].summary`는 bounded snapshot이다.
   `logs/<phase>.jsonl`은 원본 event 보존 계층이다.
3. 대용량 `tool_result` fixture를 넣고 `recent_events[].summary`가 500자 경계와 `truncated` metadata를 갖는지 확인한다.
4. 대용량 final result fixture를 넣고 `result`, `result_summary`, `result_chars`, `result_truncated`가 1200자 경계를 따르는지 확인한다.
5. error/failure fixture를 넣고 `last_error`와 error summary가 200자 경계를 따르는지 확인한다.
6. `recent_events`가 최대 5개만 유지되고, 전체 event 수와 type별 count는 `log_summary`에 남는지 확인한다.
7. 같은 fixture의 원본 event 전문이 `logs/<phase>.jsonl`에 남는지 확인한다.
8. `scripts/status.js` 출력이 `progress.json` summary/tail을 사용하며 원본 JSONL 전체를 기본으로 읽지 않는지 확인한다.
9. provider adapter가 `progress.json`이나 JSONL 파일을 직접 쓰지 않고 writer 경계를 통과하는지 확인한다.
10. 문서 계약을 바꿨다면 `docs/contracts/file-contracts.md`와 테스트 fixture가 같은 limit과 책임 경계를 말하는지 확인한다.

## 최소 테스트 세트

- `node test/progress-writer.test.js`
- `node test/standard-writer.test.js`
- `node test/status.test.js`
- `node test/file-contracts.test.js`
- provider event나 runner 경계를 함께 바꿨다면 `npm run test:provider:contracts`

## 주의사항

- compaction은 표시 정책이다.
  원본 JSONL event를 줄이거나 삭제하는 변경과 섞지 않는다.
- `last_error`는 문자열 하위 호환 필드다.
  구조화 failure 정보는 `last_failure`에 두고, `last_error`에는 bounded 사용자 메시지만 둔다.
- `recent_events` limit을 늘리는 변경은 agent context 비용 증가로 이어진다.
  limit 변경에는 status 출력과 handoff payload 크기 검토가 필요하다.
- secret, token, private environment value는 compact summary에도 남기지 않는다.
  provider failure 경로는 sanitize 정책을 먼저 적용한 뒤 progress snapshot에 반영한다.
