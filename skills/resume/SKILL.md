---
name: resume
description: 중단된 feature를 재실행 가능 상태로 복원한다. state.json status를 planned로 초기화, lock 해제
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# /built:resume

중단(aborted/failed)된 feature를 재실행 가능 상태로 복원합니다.

## 사용법

```
/built:resume <feature>
```

- `feature`: 재개할 feature 이름 (필수)

## 실행 방법

이 스킬 파일(`skills/resume/SKILL.md`)을 기준으로 스크립트 경로는 `../../scripts/resume.js`입니다.

```bash
node "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/resume.js" <feature>
```

로컬 개발(`--plugin-dir` 방식)에서는:

```bash
node scripts/resume.js <feature>
```

## 출력 예시

재개 성공:
```
Resumed feature 'user-auth'. Status reset to planned.
```

feature가 없는 경우:
```
No feature found: user-auth
```

이미 실행 중인 경우:
```
Feature 'user-auth' is already in state: running
```

완료된 경우:
```
Feature 'user-auth' is already in state: completed
```

## 동작

1. `.built/runtime/runs/<feature>/state.json` 없으면 `No feature found` 출력 후 종료
2. `state.json`의 status가 `running` 또는 `completed`이면 메시지 출력 후 종료
3. `state.json`의 status를 `planned`로 초기화, `last_error` 초기화, `updatedAt` 갱신
4. `.built/runtime/locks/<feature>.lock` 파일 삭제 (없으면 오류 없이 통과)
5. `.built/runtime/registry.json`의 해당 feature status를 `planned`로 갱신

## 재개 후 실행

복원 후에는 `/built:run <feature>`으로 재실행합니다:

```
/built:resume user-auth
/built:run user-auth
```

## 주의

- 외부 npm 패키지 없음. Node.js 20+ 필요.
- 대상 프로젝트 루트에서 실행합니다.
- `planned` 상태로만 복원하며, 실제 worker 재기동은 `/built:run`으로 별도 수행합니다.
