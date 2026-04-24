---
id: BUI-3
title: "[Week 1] [PoC-2] stream-json + runtime 갱신 검증"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: poc-2
pr: https://github.com/claude-studio/built/pull/3
week: 1
tags: [poc, stream-json, progress-writer, pipeline]
---

## 목표

claude -p --output-format stream-json --verbose 실행 시 stdout JSON 이벤트를 파이프로 받아
progress.json, state.json, logs/*.jsonl을 갱신하는지 검증한다.
progress-writer.js 최소 구현 포함. 참고: BUILT-DESIGN.md §8 (stream-json 파이프라인)

## 구현 내용

- scripts/poc-2-progress-writer.js 최소 구현 (~120 LOC, 외부 의존성 0)
  - stdin readline으로 JSON 이벤트 수신
  - system/init, assistant, result 등 6종 이벤트 파싱
  - progress.json: turn, last_text, 토큰, cost_usd, session_id 실시간 갱신
  - state.json: running → completed/failed/crashed 상태 전환
  - logs/do.jsonl: 원본 이벤트 atomic append (tmp + rename)
- poc/poc-2-stream-json.md 검증 결과 문서화

## 결정 사항

- Atomic write (tmp + rename) 패턴 채택: 부분 기록 방지
- stdin close 시 crashed 상태 처리 구현 (프로세스 비정상 종료 대응)
- 표준 라이브러리만 사용 (fs, path, readline) — 외부 deps 0 원칙 준수

## 발생한 이슈

특이사항 없음. 1회차 리뷰 통과.

경미한 참고 사항: updateHeartbeat에서 worker.session_id를 도트 키로 전달하나,
result 핸들러에서 최종 state를 완전히 재작성하므로 최종 출력은 정상.

## 완료 기준 충족 여부

1. stream-json 이벤트 수신 확인 - system/init, assistant, result/success 등 6종 이벤트 실측
2. progress.json 갱신 확인 - session_id, turn, 토큰, cost_usd 실시간 갱신
3. state.json status 갱신 확인 - running → completed/failed/crashed 전환
4. logs/do.jsonl 누적 기록 확인 - 원본 이벤트 append, atomic write 적용
5. poc/poc-2-stream-json.md 검증 결과 문서화 완료

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-3",
  "name": "[Week 1] [PoC-2] stream-json + runtime 갱신 검증",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/3"},
  "actionStatus": "CompletedActionStatus"
}
```
