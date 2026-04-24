---
id: BUI-19
title: "[Week 4] [Phase3] /built:status, /built:list 구현"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-19-status-list
pr: https://github.com/claude-studio/built/pull/20
week: 4
tags: [phase3, status, list, scripts]
keywords: [status, list, 구현, 조회, 출력, feature, state]
---

## 목표

state.json 기반으로 feature 진행 상황 조회 및 활성 feature 목록 출력 기능 구현.
- `/built:status [feature]`: 개별 또는 전체 feature 상태 조회
- `/built:list`: 활성 feature 목록 출력

## 구현 내용

- `scripts/status.js`: state.json/progress.json/registry.json 읽기 구현
  - feature 지정 시 phase, status, heartbeat_at, pid, iteration 횟수 표시
  - feature 미지정 시 registry.json에서 모든 활성 feature 요약 출력
  - .built 디렉토리 없거나 runs/ 없으면 'No runs found' 메시지 출력
  - 외부 npm 패키지 없음 (deps 0 원칙 준수)
- `skills/status/SKILL.md`: /built:status 트리거 스킬
- `skills/list/SKILL.md`: /built:list 트리거 스킬
- `test/status.test.js`: 단위 테스트 26개 전부 통과

## 결정 사항

- state.json에서 pid, heartbeat 필드를 run.js 실제 작성 패턴과 일치하는 방식으로 접근
- /built:status와 /built:list를 별도 스킬로 분리 (단일 책임 원칙)

## 발생한 이슈

없음. 1회차 리뷰에서 바로 통과.

## 완료 기준 충족 여부

1. scripts/status.js 구현 - 완료
2. skills/status/SKILL.md 작성 - 완료
3. skills/list/SKILL.md 작성 - 완료
4. 단위 테스트 26개 통과 - 완료

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-19",
  "name": "[Week 4] [Phase3] /built:status, /built:list 구현",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/20"},
  "actionStatus": "CompletedActionStatus"
}
```
