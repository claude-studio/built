# Current Built Agents v1 Snapshot

날짜: 2026-04-25
Source: repo KG profiles and live Multica inspection

이 문서는 sanitized operational snapshot이다. raw export가 아니며 private environment value와 token은 의도적으로 제외한다.

## CTO

현재 역할: 사용자 의도를 이슈로 변환하고 Developer와 Reviewer에게 위임하는 high-level coordinator.

현재 추가 책임:

- `done` 이후 KG issue record 작성
- KG 파일을 `main`에 직접 커밋
- stuck issue와 zombie agent 확인
- orphan worktree 제거
- KG drift review와 backlog 생성

v2 변경:

- backlog drain과 routing은 유지한다.
- KG writing은 KG Recorder로 이동한다.
- heartbeat와 cleanup은 Operator로 이동한다.
- architecture contract와 provider decomposition은 Architect로 이동한다.

## 개발

현재 역할: CTO에게 assign받은 issue를 worktree에서 구현하고, test 후 PR을 만든 뒤 Reviewer에게 넘기는 implementation agent.

현재 제약:

- issue comment와 KG를 먼저 읽는다.
- scoped worktree와 issue branch를 사용한다.
- 외부 npm package를 피한다.
- terminal output은 CTO에게 보이지 않으므로 결과를 comment로 남긴다.
- KG-only issue는 라우팅된 경우 direct main commit이 가능하다.

v2 변경:

- implementation ownership은 유지한다.
- architecture uncertainty가 있으면 stop-and-route한다.
- Reviewer로 넘길 때 status와 assignee handoff를 엄격히 요구한다.

## 리뷰

현재 역할: PR review agent. 완료 기준, `BUILT-DESIGN.md`, file scope, dependency policy를 확인한다.

현재 제약:

- review round를 명시한다.
- 실패한 작업은 Developer에게 되돌린다.
- 3회 초과 반려는 에스컬레이션한다.
- PR diff를 review evidence로 사용한다.

v2 변경:

- normal review ownership은 유지한다.
- `고급모델`이 만든 작업은 cross-model review rule을 적용한다.
- KG record가 필요한 완료 건은 final done 전에 KG Recorder로 라우팅한다.

## 서기

현재 역할: weekly 또는 periodic report writer.

v2 변경:

- optional reporting helper로 유지하거나 status summary를 Operator에 흡수한다.
- durable KG record는 KG Recorder로 라우팅한다.

## 일지

현재 역할: daily alignment 또는 KG review helper.

v2 변경:

- optional reporting helper로 유지하거나 daily check를 Operator에 흡수한다.
- KG record와 decision은 KG Recorder로 라우팅한다.

## 고급모델

현재 관찰된 문제: live instruction이 CTO/backlog-drain에 가까워서, overriding comment 없이 architecture 또는 implementation work를 assign하기에는 안전하지 않다.

v2 변경:

- Codex/GPT-5.5 기반 high-complexity capability lane으로 전환한다.
- bounded implementation, review-assist, architecture-assist task에 사용한다.
- 자신이 구현한 결과를 직접 최종 리뷰하지 않는다.

