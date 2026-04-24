---
name: notify
description: built 알림 발송 — Do/Check/Report 완료 및 Worktree lifecycle 이벤트 시 macOS/Linux 시스템 알림
user-invocable: true
allowed-tools:
  - Bash
---

# /built:notify — 알림 발송

Do/Check/Report 단계 완료 또는 WorktreeCreate/Remove 이벤트 발생 시 macOS/Linux 시스템 알림을 발송한다.
`scripts/notify.js`를 호출해 플랫폼에 맞는 알림 명령(osascript, notify-send 등)을 실행하며,
알림 도구가 없거나 CI 환경에서도 오류 없이 echo fallback으로 동작한다.

## 인자

`$ARGUMENTS` = `<hook-point> [feature]` 형식 (선택)

예시:
- `/built:notify after_do user-auth`
- `/built:notify after_report payment-flow`
- `/built:notify WorktreeCreate my-feature-runner`

인자 없이 호출하면 현재 환경변수(`BUILT_HOOK_POINT`, `BUILT_FEATURE`)를 사용한다.

---

## 사전 확인

1. `$ARGUMENTS`를 파싱해 `HOOK_POINT`와 `FEATURE`를 추출한다.
   - 첫 번째 토큰 → `HOOK_POINT` (예: `after_do`, `WorktreeCreate`)
   - 두 번째 토큰 → `FEATURE` (예: `user-auth`)
2. `HOOK_POINT`가 없으면 환경변수 `BUILT_HOOK_POINT`를 사용한다.
3. 둘 다 없으면 다음과 같이 안내하고 중단한다:
   > "hook-point를 입력해주세요. 예: `/built:notify after_do user-auth`"

---

## 실행

### 로컬 개발 (`--plugin-dir` 방식):

```bash
node scripts/notify.js <HOOK_POINT> [FEATURE]
```

### 플러그인으로 설치된 경우:

```bash
node "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/notify.js" <HOOK_POINT> [FEATURE]
```

---

## 지원 hook-point

| hook-point        | 발생 시점                        |
|-------------------|----------------------------------|
| `after_do`        | Do 단계 완료                     |
| `after_check`     | Check 단계 완료                  |
| `after_report`    | Report 단계 완료 (파이프라인 종료) |
| `before_do`       | Do 단계 시작 전                  |
| `before_check`    | Check 단계 시작 전               |
| `WorktreeCreate`  | Claude Code worktree 생성 시     |
| `WorktreeRemove`  | Claude Code worktree 제거 시     |

---

## 플랫폼 동작

| 플랫폼   | 1순위          | 2순위              | fallback      |
|---------|----------------|--------------------|---------------|
| macOS   | osascript      | terminal-notifier  | echo          |
| Linux   | notify-send    | —                  | echo          |
| 기타    | —              | —                  | echo          |

CI 환경(`CI=true`, `GITHUB_ACTIONS=true`, `NO_NOTIFY=1` 등)에서는 자동으로 echo fallback.

---

## hooks.local.json 연동 예시

`.built/hooks.local.json.example` 참고:

```json
{
  "pipeline": {
    "after_do":     [{ "run": "node scripts/notify.js after_do $BUILT_FEATURE" }],
    "after_check":  [{ "run": "node scripts/notify.js after_check $BUILT_FEATURE" }],
    "after_report": [{ "run": "node scripts/notify.js after_report $BUILT_FEATURE" }]
  }
}
```

## Claude Code lifecycle hooks 연동

`.claude/settings.json`에 다음을 추가하면 worktree 생성/제거 시 자동 알림:

```json
{
  "hooks": {
    "WorktreeCreate": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "node scripts/notify.js WorktreeCreate" }]
      }
    ],
    "WorktreeRemove": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "node scripts/notify.js WorktreeRemove" }]
      }
    ]
  }
}
```

Claude Code lifecycle hook은 stdin으로 JSON payload를 전달한다.
`hook_event_name`과 `worktree_path` 필드를 자동으로 파싱해 알림 메시지를 생성한다.

---

## 실행 중 동작

- `scripts/notify.js`를 실행해 플랫폼에 맞는 알림 명령을 선택
- 알림 발송 성공 시 exit code 0
- fallback(echo)도 exit code 0 (오류로 처리하지 않음)
- hook-point 인자 누락 시 exit code 1 + 사용법 안내

## 결과 출력

알림 발송 완료 후:
> `[built notify] built: <feature> — <phase> 완료`

알림 도구 없는 환경(fallback):
> `[built notify] built: <feature> — <phase> 완료` (stdout echo)
