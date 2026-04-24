---
name: hooks-inspect
description: .built/hooks.json과 .built/hooks.local.json을 병합한 현재 활성 훅 설정을 출력한다. 이벤트별 훅 목록, 출처(team/local), 누락 이벤트를 표시한다.
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# /built:hooks-inspect

현재 활성 훅 설정을 이벤트별로 출력합니다.
팀 공통(`hooks.json`)과 개인(`hooks.local.json`)을 병합하여 전체 구성을 한눈에 확인할 수 있습니다.

## 사용법

```
/built:hooks-inspect [--json]
```

- `--json`: 기계 처리용 JSON 출력 (기본값: 사람이 읽기 쉬운 텍스트)

## 실행 방법

```bash
node scripts/hooks-inspect.js
node scripts/hooks-inspect.js --json
```

## 출력 형식 (텍스트)

```
=== built hooks-inspect ===

Team  : .built/hooks.json
Local : .built/hooks.local.json

[before_do]  (no hooks)

[after_do]  (2 hooks)
  1. run: npm run lint -- --fix  |  halt_on_fail
  2. run: npm run typecheck  |  halt_on_fail  |  timeout: 60000ms
  3. run: echo "done"  [local]

[after_check]  (1 hook)
  1. run: npm run coverage  |  if: check.status == 'approved'

[after_report]  (1 hook)
  1. skill: built-pr-draft
```

- `[local]` 태그: `hooks.local.json`에서 가져온 훅
- 태그 없음: `hooks.json` (팀 공통)
- `(no hooks)`: 해당 이벤트에 훅 없음

## 출력 형식 (--json)

```json
{
  "team_path": ".built/hooks.json",
  "local_path": ".built/hooks.local.json",
  "events": {
    "before_do": [],
    "after_do": [
      { "source": "team", "type": "command", "run": "npm run lint -- --fix", "halt_on_fail": true },
      { "source": "local", "type": "command", "run": "echo \"done\"" }
    ],
    "after_check": [
      { "source": "team", "type": "command", "run": "npm run coverage", "condition": "check.status == 'approved'" }
    ],
    "after_report": [
      { "source": "team", "type": "skill", "skill": "built-pr-draft" }
    ]
  }
}
```

## 이벤트 목록

| 이벤트 | 발화 시점 |
|--------|-----------|
| `before_do` | Do 단계 시작 전 |
| `after_do` | Do 단계 완료 후 |
| `after_check` | Check 단계 완료 후 |
| `after_report` | Report 단계 완료 후 |

## 병합 규칙

- `hooks.local.json`의 훅은 팀 훅 **뒤에** 추가됩니다 (덮어쓰지 않음).
- 이벤트 배열 순서가 실행 순서입니다.
- local 파일이 없으면 팀 설정만 표시합니다.

## Exit codes

| 코드 | 의미 |
|------|------|
| 0 | 정상 출력 |
| 1 | hooks.json 없음 또는 파싱 오류 |

## 주의

- 외부 npm 패키지 없음. Node.js 20+ 필요.
- 대상 프로젝트 루트에서 실행합니다.
- `hooks.local.json`은 optional — 없으면 팀 설정만 표시합니다.
- 훅 유효성 검증은 `/built:validate`를 사용하세요.
