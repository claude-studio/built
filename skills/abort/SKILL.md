---
name: abort
description: 실행 중인 feature를 중단한다. state.json status를 aborted로 갱신, lock 해제, registry 정리
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# /built:abort

실행 중인 feature를 즉시 중단합니다.

## 사용법

```
/built:abort <feature>
```

- `feature`: 중단할 feature 이름 (필수)

## 실행 방법

이 스킬 파일(`skills/abort/SKILL.md`)을 기준으로 스크립트 경로는 `../../scripts/abort.js`입니다.

```bash
node "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/abort.js" <feature>
```

로컬 개발(`--plugin-dir` 방식)에서는:

```bash
node scripts/abort.js <feature>
```

## 출력 예시

중단 성공:
```
Aborted feature 'user-auth'. lock removed.
```

lock이 없는 경우:
```
Aborted feature 'user-auth'.
```

feature가 없는 경우:
```
No feature found: user-auth
```

이미 종료된 경우:
```
Feature 'user-auth' is already in terminal state: aborted
```

## 동작

1. `.built/runtime/runs/<feature>/state.json` 없으면 `No feature found` 출력 후 종료
2. `state.json`의 status가 이미 `aborted` / `completed` / `failed`이면 메시지 출력 후 종료
3. `state.json`의 status를 `aborted`로 갱신, `updatedAt` 갱신
4. `.built/runtime/locks/<feature>.lock` 파일 삭제 (없으면 무시)
5. `.built/runtime/registry.json`의 해당 feature status를 `aborted`로 갱신

## 주의

- 외부 npm 패키지 없음. Node.js 20+ 필요.
- 대상 프로젝트 루트에서 실행합니다.
- 실행 중인 worker 프로세스를 직접 종료하지는 않습니다. 상태 파일만 갱신합니다.
