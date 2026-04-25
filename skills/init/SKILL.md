---
name: init
description: 프로젝트를 built로 bootstrap한다. feature 인자를 주면 feature-spec.md도 생성한다.
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Write
---

# /built:init [feature-name]

프로젝트를 built로 bootstrap합니다. feature 이름을 인자로 넘기면 해당 feature의 `feature-spec.md`도 함께 생성합니다.

## 인자 추출

사용자가 `/built:init <feature-name>` 형태로 호출했다면, `<feature-name>` 부분을 `FEATURE` 변수에 담아 스크립트에 전달합니다.

예:
- `/built:init` → feature 없이 bootstrap만
- `/built:init token-generation-api` → bootstrap + feature-spec.md 생성

## 실행 방법

이 스킬 파일(`skills/init/SKILL.md`)을 기준으로 스크립트 경로는 `../../scripts/init.js`입니다.

**feature 없이 실행:**

```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
node "$SCRIPT_DIR/scripts/init.js" "$(pwd)"
```

**feature 인자와 함께 실행 (예: token-generation-api):**

```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
node "$SCRIPT_DIR/scripts/init.js" "$(pwd)" "token-generation-api"
```

실제 실행 시 `token-generation-api` 자리에 사용자가 전달한 feature 이름을 넣습니다.

로컬 개발(`--plugin-dir` 방식)에서는:

```bash
node scripts/init.js "$(pwd)" "<feature-name>"
```

## 동작

1. `.built/config.json` 존재 여부로 이미 초기화됐는지 확인
2. 미초기화 상태이면 아래 구조를 생성:

```
프로젝트 루트/
├── .claude/
│   ├── settings.json
│   └── worktrees/
├── .built/
│   ├── context.md
│   ├── config.json
│   ├── hooks.json
│   ├── hooks.local.json.example
│   ├── features-index.md
│   ├── features/
│   ├── decisions/
│   ├── entities/
│   ├── patterns/
│   ├── runs/
│   └── runtime/
├── .worktreeinclude
└── .gitignore (built 항목 자동 추가)
```

3. feature 인자가 있으면 (초기화 여부와 무관하게) 아래 파일 생성:

```
.built/features/<feature-name>.md
```

BUILT-DESIGN.md §7 스키마의 기본 템플릿(빈 값)으로 생성됩니다.
이미 존재하면 덮어쓰지 않습니다.

4. `.gitignore`에 built 관련 항목 추가 (중복 방지)

## 완료 후 안내

초기화 완료 후 사용자에게 다음을 안내합니다:

- `.built/context.md`를 열어 프로젝트 개요, 기술 스택, 팀 컨벤션을 채워주세요.
- feature spec이 생성된 경우: `.built/features/<feature-name>.md`를 열어 Intent, Scope 등을 채워주세요.
- 다음 단계: `/built:plan <feature-name>` 으로 feature 계획을 시작하세요.

## 주의

- 이 명령은 대상 프로젝트 레포에서 실행합니다 (built 레포 아님).
- 외부 npm 패키지 없음. Node.js 20+ 필요.
- 이미 존재하는 파일은 덮어쓰지 않습니다.
