# Agents v1 Backup

상태: snapshot
날짜: 2026-04-25

이 디렉토리는 v2 에이전트 개편 전에 현재 v1 운영 가정을 보존한다.

현재 repo 안에서 확인 가능한 v1 profile의 기준 위치:

- `kg/agents/cto.md`
- `kg/agents/개발.md`
- `kg/agents/리뷰.md`
- `kg/workflows/feature-development-loop.md`
- `CLAUDE.md`

v1 모델은 작은 queue에서는 효과적이지만 CTO에게 queue routing, KG writing, heartbeat, backlog generation, cleanup이 모두 몰려 있다. 또한 status와 assignee를 함께 옮기지 않을 때 handoff drift가 생긴다.

v2 rollout 중에는 v1 KG profile을 삭제하지 않는다. v1 규칙으로 시작된 이슈를 마무리할 때 필요하다.

## Migration Rule

live Multica instruction을 갱신하기 직전에 active agent instruction을 export하고, sanitized copy를 이 디렉토리에 저장한다. export에는 secrets, access token, custom environment value, private webhook token을 포함하지 않는다.

## V1 Roles

| 역할 | Source | v2 처리 |
| --- | --- | --- |
| CTO | `kg/agents/cto.md` | queue owner로 유지하되 KG/heartbeat 구현 책임 제거 |
| 개발 | `kg/agents/개발.md` | Developer로 유지 |
| 리뷰 | `kg/agents/리뷰.md` | Reviewer로 유지 |
| 서기 | live Multica agent | report-writing duty를 Operator 또는 KG Recorder로 매핑 |
| 일지 | live Multica agent | daily review duty를 Operator 또는 KG Recorder로 매핑 |
| 고급모델 | live Multica agent | CTO-like instruction에서 high-complexity capability lane으로 전환 |

