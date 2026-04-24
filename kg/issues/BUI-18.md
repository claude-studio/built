---
id: BUI-18
title: "[Week 3] [Phase2] Notification hook 구현"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-18-notification-hook
pr: https://github.com/claude-studio/built/pull/19
week: 3
tags: [phase2, notification, hook, lifecycle]
keywords: [notification, hook, 알림, lifecycle, 구현, macos, linux, osascript]
---

## 목표

Do/Check/Report 완료 시 macOS/Linux 알림 발송 및 WorktreeCreate/Remove lifecycle hook 연동.

## 구현 내용

- scripts/notify.js: macOS(osascript > terminal-notifier > echo), Linux(notify-send > echo), CI 환경 자동 감지 fallback
- pipeline hook(환경 변수) + lifecycle hook(stdin JSON) 양방향 지원
- 외부 npm 패키지 없이 Node.js 표준 라이브러리 + 시스템 CLI만 사용
- skills/notify/SKILL.md: /built:notify 트리거, hook-point 표, 플랫폼 동작 문서
- test/notify.test.js: 29개 단위 테스트 (플랫폼 감지, CI 감지, 메시지 포맷, CLI 실행, stdin JSON)
- .built/hooks.local.json.example: pipeline hook 연동 예시

## 결정 사항

- osascript 우선 시도 후 terminal-notifier fallback: 표준 macOS 방식이 더 범용적
- CI 환경(CI=true 또는 NO_NOTIFY=true) 자동 감지로 echo fallback: CI 환경에서 오류 없이 동작
- stdin JSON 방식으로 lifecycle hook 이벤트 수신: 기존 hook 인터페이스와 일관성 유지

## 발생한 이슈

없음. 1회차 리뷰 통과.

## 완료 기준 충족 여부

1. scripts/notify.js 구현 - 충족 (macOS/Linux/CI fallback 포함)
2. skills/notify/SKILL.md 작성 - 충족
3. 단위 테스트 29개 - 충족
4. CI 환경 fallback 동작 - 충족

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-18",
  "name": "[Week 3] [Phase2] Notification hook 구현",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/19"},
  "actionStatus": "CompletedActionStatus"
}
```
