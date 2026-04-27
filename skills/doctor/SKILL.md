---
name: doctor
description: provider 환경을 사전 점검한다. Codex CLI 설치/인증/app-server 지원/broker 상태/sandbox 설정 오류를 실제 모델 호출 없이 진단한다.
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# /built:doctor [--feature <featureId>] [--json]

provider 환경을 사전 점검합니다. 실제 모델 호출 없이 Codex CLI 설치, app-server 지원, 인증 상태, broker 상태, run-request provider 설정 유효성을 확인합니다.

## 인자 추출

사용자가 추가 옵션을 전달한 경우 아래 형식으로 스크립트에 넘깁니다.

예:
- `/built:doctor` → 전체 기본 점검
- `/built:doctor --feature user-auth` → feature의 run-request.json provider 설정 포함
- `/built:doctor --json` → 결과를 구조화 JSON으로 출력

## 실행 방법

대상 프로젝트 루트 cwd를 유지한 상태에서 built plugin/repo의 script를 절대 경로로 호출합니다.
Claude Bash tool, zsh, bash, interactive shell 모두에서 `BASH_SOURCE[0]`로 skill 파일 위치를 추정하지 않습니다.

**기본 점검:**

```bash
: "${BUILT_PLUGIN_DIR:?BUILT_PLUGIN_DIR must point to the installed built plugin/repo path}"
SCRIPT_DIR="$(cd "$BUILT_PLUGIN_DIR/scripts" && pwd -P)"
node "$SCRIPT_DIR/provider-doctor.js" --cwd "$(pwd)"
```

**feature provider 설정 포함 점검 (예: user-auth):**

```bash
: "${BUILT_PLUGIN_DIR:?BUILT_PLUGIN_DIR must point to the installed built plugin/repo path}"
SCRIPT_DIR="$(cd "$BUILT_PLUGIN_DIR/scripts" && pwd -P)"
node "$SCRIPT_DIR/provider-doctor.js" --cwd "$(pwd)" --feature "user-auth"
```

**JSON 출력:**

```bash
: "${BUILT_PLUGIN_DIR:?BUILT_PLUGIN_DIR must point to the installed built plugin/repo path}"
SCRIPT_DIR="$(cd "$BUILT_PLUGIN_DIR/scripts" && pwd -P)"
node "$SCRIPT_DIR/provider-doctor.js" --cwd "$(pwd)" --json
```

## 점검 항목

| 항목 | 설명 |
|------|------|
| Codex CLI 설치 | `codex --version` 응답 여부 |
| Codex app-server 지원 | `codex app-server --help` 성공 여부 |
| Codex 인증 상태 | `codex login status` 인증 여부 |
| Broker 상태 | 기존 broker session PID 생존 및 socket 접근성 |
| Broker Lock | stale lock 파일 존재 여부 |
| run-request 설정 | `--feature` 지정 시 providers 필드 유효성 |
| Feature Registry | 실행 중인 feature 확인 (broker 경합 방지) |

## 상태 종류

| 상태 | 종료코드 | 의미 |
|------|---------|------|
| `[정상]` | 0 | 환경이 준비되어 있습니다. |
| `[주의]` | 0 | 실행은 가능하지만 확인이 필요한 항목이 있습니다. |
| `[실패]` | 1 | 조치 없이는 실행이 불가능합니다. |

실패 시 각 항목에 조치 메시지(`-> 조치: ...`)가 함께 출력됩니다.

## 출력 예시

```
=== built provider doctor ===
전체 상태: 실패

[정상] Codex CLI 설치
       codex 0.x.x 설치됨
[정상] Codex app-server 지원
       app-server 명령 지원 확인
[실패] Codex 인증 상태
       인증되지 않은 상태입니다.
       -> 조치: codex login 으로 인증하세요.
[주의] Broker 상태
       실행 중인 broker session 없음 — 정상 상태입니다.
...

하나 이상의 점검이 실패했습니다. 위의 조치를 수행한 뒤 다시 점검하세요.
환경 준비 후: `node "$SCRIPT_DIR/provider-doctor.js" --cwd "$(pwd)"`
```

## 비범위

- 실제 모델 호출을 수행하지 않습니다.
- token, secret, 환경 변수 원문을 출력하지 않습니다.
- GUI 설정 화면을 포함하지 않습니다.

## 주의

- 외부 npm 패키지 없음. Node.js 20+ 필요.
- 대상 프로젝트 경로에서 실행하거나 `--cwd`로 경로를 지정합니다.
- 실제 smoke 테스트 전 사전 점검 용도입니다. 실행 가능 여부 최종 확인은 `docs/smoke-testing.md` 참조.
- 자세한 내용은 `docs/ops/provider-setup-guide.md` 참조.
