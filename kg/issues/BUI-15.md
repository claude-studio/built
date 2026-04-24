---
id: BUI-15
title: "[Week 3] [Phase2] Iter 루프 구현"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-15-iter-loop
pr: https://github.com/claude-studio/built/pull/16
week: 3
tags: [phase2, iter, loop, pipeline]
---

## 목표

check-result.md의 frontmatter status가 needs_changes일 때 최대 3회 반복 실행하는 Iter 루프 구현. 이전 산출물(do-result.md, check-result.md, feature-spec.md)을 컨텍스트로 재주입하여 Do 단계를 재실행.

## 구현 내용

- scripts/iter.js: check-result.md needs_changes 감지 후 Do+Check 재실행 루프
  - BUILT_MAX_ITER 환경변수 기반 최대 반복 횟수 (기본값 3)
  - 반복 초과 시 state.json에 failed 기록 후 종료
  - state.json의 attempt 카운터 갱신
  - MULTICA_AGENT_TIMEOUT 지원 (pipeline-runner 경유)
- skills/iter/SKILL.md: Claude Code 스킬 형식 작성
- 단위 테스트 21개: approved/needs_changes 분기, 최대 반복 초과, state.json 갱신 케이스

## 결정 사항

- pipeline-runner.js의 runPipeline() 재호출 방식으로 Do 재실행 (직접 호출 아님)
  - 이유: 기존 파이프라인 추상화 재사용, 타임아웃/에러 처리 일관성 유지
- BUILT_MAX_ITER 환경변수로 최대 반복 제어
  - 이유: 환경별 조정 가능, 기본값 3은 실용적 수렴 횟수

## 발생한 이슈

없음 (1회차 리뷰 통과)

## 완료 기준 충족 여부

1. scripts/iter.js 구현 - 충족
2. skills/iter/SKILL.md 작성 - 충족
3. 외부 npm 패키지 없음 - 충족 (Node.js 표준 라이브러리만)
4. MULTICA_AGENT_TIMEOUT 지원 - 충족
5. 단위 테스트 21개 전체 통과 - 충족

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-15",
  "name": "[Week 3] [Phase2] Iter 루프 구현",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/16"},
  "actionStatus": "CompletedActionStatus"
}
```
