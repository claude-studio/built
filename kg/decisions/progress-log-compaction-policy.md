---
id: ADR-24
title: progress/log compaction과 audit log 분리 정책
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-227
tags: [performance, provider, progress, logs, status, compaction]
---

## 컨텍스트

provider 전환 이후 `progress.json`은 status 화면, cost guard, agent handoff가 자주 읽는 사용자-facing snapshot이 되었다.
긴 실행에서 `tool_result`, 최종 result, error message가 커지면 status 출력과 agent context가 원본 로그 크기에 비례해 커진다.
하지만 원본 provider event 전문은 감사와 디버깅을 위해 보존되어야 한다.

## 결정

**`progress.json`에는 bounded summary와 recent tail만 저장하고, 원본 event 전문은 `logs/<phase>.jsonl`에 보존한다.**

구체적 기준은 다음과 같다.

- `recent_events`는 최대 5개 event tail만 유지한다.
- `tool_result` 표시 summary는 500자로 제한한다.
- 최종 `result`와 `result_summary`는 1200자로 제한한다.
- error와 `last_error`는 200자로 제한한다.
- `log_summary`에는 전체 event 수, type별 count, 원문 길이와 truncated 여부 같은 집계를 둔다.
- status 출력은 기본적으로 `progress.json`의 `log_summary`와 `recent_events`만 사용한다.
- `logs/<phase>.jsonl`은 compaction 대상이 아니며, 원본 event를 삭제하거나 축약하지 않는다.

## 근거

- status와 agent handoff는 자주 실행되므로 원본 로그 크기와 독립적으로 bounded 되어야 한다.
- audit log는 재현, review, provider event 디버깅의 근거이므로 손실 없이 남아야 한다.
- provider adapter가 파일을 직접 쓰지 않는 기존 runner/writer 경계를 유지하면 provider별 compaction 차이를 막을 수 있다.
- `progress.json`은 append-only log가 아니라 최신 관찰 상태 snapshot이라는 계약과 맞다.

## 대안

- `progress.json`에 원본 `tool_result`와 result 전문을 계속 저장한다.
  구현은 단순하지만 긴 실행에서 status와 agent context가 비대해지고, 같은 대용량 출력이 여러 계층에 중복 저장된다.
- JSONL 원본 로그를 tail만 남기고 줄인다.
  저장량은 줄지만 audit와 디버깅 근거를 잃으므로 이번 목표와 맞지 않는다.
- status가 필요할 때마다 JSONL 전체를 읽어 즉석 요약한다.
  `progress.json`은 작아지지만 status 비용이 원본 로그 크기에 비례하고, agent가 전체 로그를 반복 읽는 문제를 해결하지 못한다.

## 결과

- 사용자-facing 출력은 bounded summary/tail이 되어 긴 provider 실행에서도 status가 과도하게 길어지지 않는다.
- 원본 event 전문은 JSONL audit 계층에 남아 review와 디버깅에 사용할 수 있다.
- `scripts/status.js`와 agent handoff는 기본적으로 `progress.json` snapshot만 읽으면 된다.
- error/failure 경로에서도 `last_error`가 bounded string으로 유지된다.

## 되돌릴 조건

별도 외부 로그 저장소나 indexed log reader가 도입되어 status가 bounded query를 안정적으로 수행할 수 있고, audit log 보존 계약이 새 저장소로 이전된다는 ADR이 승인될 때만 이 정책을 재검토한다.
그 전에는 `progress.json`에 원본 대용량 출력 전문을 다시 넣지 않는다.
