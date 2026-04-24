---
name: type-check
description: built after_do 훅 — TypeScript 타입 검사
user-invocable: false
---

# built-quality: type-check

> 이 스킬은 `after_do` 훅으로 실행된다. 직접 호출은 지원하지 않는다.

## 동작

1. `.built/hooks.json`의 `after_do.type-check` 설정을 읽는다
2. 프로젝트 루트에서 TypeScript 타입 검사를 실행한다 (기본: `npx tsc --noEmit`)
3. 오류가 있으면 결과를 `do-result.md`에 append한다

## 설정 예시 (.built/hooks.json)

```json
{
  "after_do": {
    "type-check": {
      "enabled": true,
      "command": "npx tsc --noEmit"
    }
  }
}
```

## 상태

스텁 (MVP 이후 구현 예정)
