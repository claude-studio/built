---
name: lint-fix
description: built after_do 훅 — lint 오류 자동 수정
user-invocable: false
---

# built-quality: lint-fix

> 이 스킬은 `after_do` 훅으로 실행된다. 직접 호출은 지원하지 않는다.

## 동작

1. `.built/hooks.json`의 `after_do.lint-fix` 설정을 읽는다
2. 프로젝트 루트에서 lint 명령을 실행한다 (기본: `npm run lint --fix`)
3. 오류가 있으면 결과를 `do-result.md`에 append한다

## 설정 예시 (.built/hooks.json)

```json
{
  "after_do": {
    "lint-fix": {
      "enabled": true,
      "command": "npm run lint --fix"
    }
  }
}
```

## 상태

스텁 (MVP 이후 구현 예정)
