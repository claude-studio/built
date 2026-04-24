---
name: status
description: feature의 현재 진행 상황을 조회한다. feature 미지정 시 전체 요약 출력
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# /built:status

feature의 현재 실행 상태를 출력합니다.

## 사용법

```
/built:status [feature]
```

- `feature` 생략 시: 모든 활성 feature의 요약 출력
- `feature` 지정 시: 해당 feature의 state.json, progress.json 상세 출력

## 실행 방법

이 스킬 파일(`skills/status/SKILL.md`)을 기준으로 스크립트 경로는 `../../scripts/status.js`입니다.

```bash
# feature 지정
node "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/status.js" <feature>

# 전체 요약
node "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/status.js"
```

로컬 개발(`--plugin-dir` 방식)에서는:

```bash
node scripts/status.js [feature]
```

## 출력 예시

특정 feature 지정 시:
```
feature: user-auth
  phase:       check
  status:      running
  pid:         12345
  heartbeat:   2분 전
  attempt:     2
  started:     1시간 전
  updated:     2분 전
  progress:    check phase: analyzing test results
  steps:       3/5
  iteration:   2
```

전체 요약 시:
```
feature: user-auth
  phase:       check
  status:      running
  pid:         12345
  heartbeat:   2분 전
  attempt:     2
  started:     1시간 전
  updated:     2분 전

feature: payment
  phase:       do
  status:      running
  pid:         12399
  heartbeat:   30초 전
  attempt:     1
  started:     30분 전
  updated:     30초 전
```

## 동작

1. `.built/runtime/` 없거나 `runs/` 없으면 `No runs found.` 출력
2. feature 지정 시:
   - `.built/runtime/runs/<feature>/state.json` 읽어 phase/status/pid/heartbeat/attempt 출력
   - `.built/runtime/runs/<feature>/progress.json` 있으면 진행 메시지 추가 출력
3. feature 미지정 시:
   - `registry.json` 읽어 등록된 feature 목록 기준으로 각 state.json 요약 출력
   - registry.json 없으면 runs/ 디렉토리 직접 탐색

## 주의

- 외부 npm 패키지 없음. Node.js 20+ 필요.
- 대상 프로젝트 루트에서 실행합니다.
