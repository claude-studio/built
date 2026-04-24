---
id: BUI-57
title: "[Audit] 절대 경로 하드코딩 감사 및 수정 (m4 대응)"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-57
pr: https://github.com/claude-studio/built/pull/42
week: 2
tags: [audit, path, portability]
keywords: [절대경로 하드코딩 감사 수정 포터빌리티 tmpdir homedir os]
---

## 목표

scripts/, src/, skills/ 내 절대 경로(/Users/, /tmp/ 등) 하드코딩을 전수 감사하고, 동적 경로(os.homedir(), os.tmpdir(), process.cwd(), path.resolve(__dirname))로 교체하여 다른 팀원 환경에서도 동작하도록 개선.

## 구현 내용

- scripts/, src/, skills/ 전체 grep 감사: /Users/ 하드코딩 0건 확인
  - scripts/sanitize.js의 /Users/ 는 경로 마스킹용 regex 패턴 (파일 접근 아님)
  - skills/SKILL.md의 /Users/ 는 문서 예시 (파일 접근 아님)
  - test/sanitize.test.js의 /Users/gin/ 는 함수 검증용 입력 데이터 (파일 접근 아님)
- test/ 내 /tmp/ 하드코딩 4건 발견 → os.tmpdir() 기반으로 교체
  - test/state.test.js
  - test/result-to-markdown.test.js (2곳)
  - test/progress-writer.test.js
  - test/status.test.js

## 결정 사항

- sanitize.js의 /Users/ regex 패턴은 실제 파일 경로 하드코딩이 아니므로 수정 불필요로 판단 (리뷰 통과)
- test/run.test.js 실패는 main 브랜치에도 존재하는 pre-existing 이슈로 이번 작업 범위 외

## 발생한 이슈

없음 (1회차 리뷰 통과)

## 완료 기준 충족 여부

- /Users/ 하드코딩 0건 (grep 검증) — 충족
- /tmp/ 하드코딩 0건 (os.tmpdir() 기반으로 교체) — 충족
- 모든 경로가 os.homedir/cwd/tmpdir/__dirname 기반 — 충족
- 수정된 테스트 파일 전체 통과 — 충족
- 외부 npm 패키지 없음 — 충족

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-57",
  "name": "[Audit] 절대 경로 하드코딩 감사 및 수정 (m4 대응)",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/42"},
  "actionStatus": "CompletedActionStatus"
}
```
