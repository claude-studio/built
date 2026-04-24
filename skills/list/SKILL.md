---
name: list
description: 활성 feature 목록을 출력한다. registry.json 기반
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# /built:list

활성 feature 목록을 출력합니다.

## 사용법

```
/built:list
```

## 실행 방법

이 스킬 파일(`skills/list/SKILL.md`)을 기준으로 스크립트 경로는 `../../scripts/status.js`입니다.

```bash
node "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/status.js" --list
```

로컬 개발(`--plugin-dir` 방식)에서는:

```bash
node scripts/status.js --list
```

## 출력 예시

```
Active features (2):

  user-auth
    status:  running  phase: check  updated: 2분 전

  payment
    status:  running  phase: do     updated: 30초 전
```

등록된 feature가 없을 경우:
```
No active features found.
```

## 동작

1. `.built/runtime/` 없으면 `No runs found.` 출력
2. `.built/runtime/registry.json` 읽어 등록된 feature 목록 출력
   - 각 feature별: status, phase, 마지막 업데이트 시각 (state.json 기준)
3. registry.json 없거나 비어있으면 `runs/` 디렉토리 직접 탐색

## 주의

- 외부 npm 패키지 없음. Node.js 20+ 필요.
- 대상 프로젝트 루트에서 실행합니다.
