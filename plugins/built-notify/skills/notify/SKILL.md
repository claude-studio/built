---
name: notify
description: built after_report 훅 — 파이프라인 완료 알림 전송
user-invocable: false
---

# built-notify: notify

> 이 스킬은 `after_report` 훅으로 실행된다. 직접 호출은 지원하지 않는다.

## 동작

1. `.built/hooks.json`의 `after_report.notify` 설정을 읽는다
2. 설정된 채널로 완료 알림을 전송한다 (Slack webhook, macOS 알림 등)
3. `report.md`의 요약을 메시지에 포함한다

## 설정 예시 (.built/hooks.json)

```json
{
  "after_report": {
    "notify": {
      "enabled": true,
      "channels": ["slack"],
      "slack_webhook": "${SLACK_WEBHOOK_URL}"
    }
  }
}
```

## 상태

스텁 (MVP 이후 구현 예정)
