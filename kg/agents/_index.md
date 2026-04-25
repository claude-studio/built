---
title: KG Agents Index
type: index
updated: 2026-04-26
---

# Agents

built 운영 역할의 공개 가능한 활동 프로필 목록.

이 디렉터리는 실제 Multica agent instruction의 원본이 아니다. 공개 레포에 남길 수 있는
역할 책임, handoff 범위, 운영 주의사항만 기록한다.

## 공개 기록 원칙

- 내부 agent UUID, workspace UUID, 로컬 daemon/host 정보는 기록하지 않는다.
- token, chat id, secret, private environment value는 기록하지 않는다.
- raw execution history와 긴 처리 이슈 누적 목록은 기록하지 않는다.
- 개별 완료 이력은 `kg/issues/`에 기록하고, 이 디렉터리는 역할 프로필만 유지한다.

## 엔트리

- [[coordinator.md]] — Coordinator (queue routing, backlog planning)
- [[builder.md]] — Builder (scoped implementation)
- [[reviewer.md]] — Reviewer (PR review, quality gate)
- [[recorder.md]] — Recorder (KG 기록, durable knowledge)
- [[finisher.md]] — Finisher (PR finalization, notification, queue tick)
- [[operator.md]] — Operator (heartbeat, queue health)
- [[specialist.md]] — Specialist (high-complexity analysis / second opinion)

## v1 역할 정리

기존 CTO/개발/리뷰 3역할 프로필은 v2 운영모델로 대체되었다. v1 역할명은 현재
실행 지침의 기준으로 사용하지 않는다.
