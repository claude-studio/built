# built

> PDCA 오케스트레이션 도구 — Plan/Design은 사람이, Do → Check → Iter → Report는 Claude가.

Ride 엔지니어링팀의 AI 개발 워크플로우 도구. Claude Code 위에서 feature를 **"built 상태"까지 자동으로 끌고 가는** 방식으로 동작합니다.

---

## 특징

- **사람은 Plan/Design까지만** — 대화형 인터뷰로 의도와 청사진 확정
- **나머지는 완전 자동화** — `claude -p` 서브세션이 Do/Check/Iter/Report 수행
- **파일 시스템이 SSOT** — 메인 세션과 서브세션 간 유일한 통신 수단
- **공식 Claude Code 기능 위에 얇은 레이어** — worktree, subagent, hooks, plugins 그대로 활용
- **impeccable craft 기반 Plan** — shape(의도) + build order(청사진)를 하나로 묶은 검증된 구조
- **Obsidian vault 호환** — 모든 산출물(feature / decision / entity / pattern)이 Markdown + frontmatter + `[[wikilink]]`. `.built/` 폴더를 그대로 Obsidian으로 열면 Graph View, 백링크, 태그 검색 공짜
- **일관성 자동 확보 (Prior Art)** — 새 Plan 시작 시 이전 feature들의 `[[wikilink]]`를 따라 탐색, 채택된 결정/패턴/엔티티를 자동 제안
- **stream-json → Markdown 변환** — 서브세션의 JSON 이벤트 스트림을 `progress-writer` + `result-to-markdown`이 받아 Obsidian 호환 `.md` 산출물로 포매팅
- **프로젝트 영향 0** — Node.js 표준 라이브러리만으로 구현 (외부 npm deps 0). 대상 프로젝트의 `package.json`/`node_modules`를 건드리지 않으며, 어떤 언어/런타임의 레포에서도 동작

## 요구사항

- **시스템**: Node.js 20+ 권장 (built 스크립트 런타임). Claude Code 설치 방식에 따라 이미 설치되어 있을 수 있으나, built 요구사항으로 별도 명시
- **프로젝트**: 없음. Python/Go/Rust/JS 어떤 레포든 동일하게 동작

---

## 빠른 시작

```bash
# 1. 작업 폴더 준비
/built:init user-auth

# 2. 대화로 계획 확정 (Intent → Architecture → Build Plan)
/built:plan user-auth

# 3. 자동 실행 (Do → Check → Iter → Report)
/built:run user-auth

# 4. 진행 확인
/built:status
```

---

## 명령어

### 핵심

| 명령어 | 용도 |
|---|---|
| `/built:init <feature>` | feature 작업 시작, 디렉토리 준비 |
| `/built:plan <feature>` | Plan+Design 대화식 인터뷰 |
| `/built:run <feature>` | Do → Check → Iter → Report 자동 실행 |
| `/built:status [feature]` | 진행 상황 조회 |
| `/built:list` | 활성 feature 목록 |
| `/built:abort <feature>` | 중단 |
| `/built:resume <feature>` | 재개 |

### 모델 변형

| 명령어 | 용도 |
|---|---|
| `/built:run-opus <feature>` | Opus로 실행 |
| `/built:run-sonnet <feature>` | Sonnet으로 실행 |

### 유틸리티

| 명령어 | 용도 |
|---|---|
| `/built:validate` | 설정 파일 검증 |
| `/built:hooks-inspect` | 효과적 훅 설정 출력 |

---

## 동작 방식

```
Plan (사람, 메인 세션)
  └─ /built:plan — 대화식 인터뷰로 features/<name>.md 확정
       ├─ Phase 0: Prior Art — Obsidian vault 탐색 (features-index → wikilink 재귀)
       ├─ Phase 1: Intent (의도 캡처)
       ├─ Phase 2: Architecture Direction (이전 채택 결정 제안)
       ├─ Phase 3: Build Plan (Schema → Core → Structure → States → Integration → Polish)
       ├─ Phase 4: Spec Review
       └─ Phase 5: Save → Claude가 Write로 features/<name>.md 직접 작성
                          + decisions/entities/patterns 갱신 + features-index.md 재생성

Automation (Claude, 서브세션)
  └─ /built:run
       ├─ Do      — claude -p, worktree 격리 → stream-json → do-result.md
       ├─ Check   — claude -p + --json-schema, 구조화 JSON 응답 강제 → check-result.md
       ├─ Iter    — check-result.md frontmatter status == 'needs_changes' 시 최대 3회
       └─ Report  — 저비용 모델, Markdown 직접 생성 → report.md
```

### stream-json → Markdown 변환 파이프라인

서브세션(`claude -p`)은 Markdown을 직접 뱉지 않고 **줄 단위 JSON 이벤트 스트림**을 뱉습니다. built은 2단계로 변환합니다.

```
claude -p --output-format stream-json --verbose
  │  (stdout: JSON lines — system / assistant / tool_use / tool_result / result)
  ├─ runs/<name>/logs/<phase>.jsonl  ← 원본 이벤트 로그 (gitignore)
  ▼
progress-writer.js         ← 실시간 파이프, atomic write
  │
  ▼
runs/<name>/progress.json  ← 기계 전용 snapshot (session_id, 수정된 파일, 턴 수, 비용)
  │  result 이벤트 수신 시 1회 실행
  ▼
result-to-markdown.js      ← 템플릿 포매팅
  │
  ▼
runs/<name>/do-result.md   ← 사람용 + Obsidian용 (frontmatter + 본문)
```

| 레이어 | 형식 | 용도 |
|---|---|---|
| `claude -p` 출력 | stream-json | 기계 프로토콜 |
| `logs/<phase>.jsonl` | JSON Lines (gitignore) | 원본 이벤트 로그 |
| `progress.json` | JSON (gitignore) | 실시간 진행 snapshot |
| `*-result.md` | Markdown + frontmatter (git) | 사람이 읽고 Obsidian이 시각화 |

**Check**는 프롬프트 + `--json-schema`로 구조화 응답을 강제 → `result.result` 필드를 `JSON.parse` → Markdown 템플릿 포매팅.
**Report**는 Claude가 이미 Markdown으로 응답 → frontmatter만 prepend.
**Plan**은 변환 레이어 없음 — 메인 세션에서 Claude가 Write tool로 직접 `.md` 작성.

### Phase 감지는 파일 존재로

| 없는 파일 | 현재 Phase |
|---|---|
| `features/<name>.md` | plan |
| `runs/<name>/do-result.md` | do |
| `runs/<name>/check-result.md` | check |
| `check-result.md` frontmatter `status: needs_changes` | iter |
| `runs/<name>/report.md` | report |

---

## 디렉토리 구조

built은 **두 공간**으로 나뉩니다. 실행 스크립트는 플러그인 측에만 존재하므로 프로젝트 레포는 오염되지 않습니다.

### 플러그인 소스 측 (배포 레포 기준)

```
built-marketplace/
├── .claude-plugin/
│   └── marketplace.json
└── plugins/
    └── built/
        ├── .claude-plugin/plugin.json
        ├── skills/
        │   ├── init/SKILL.md
        │   ├── plan/SKILL.md
        │   ├── run/SKILL.md
        │   └── ...
        ├── hooks/hooks.json           # plugin lifecycle hooks (선택)
        ├── .mcp.json                  # plugin MCP wiring (선택)
        ├── scripts/                   # Node.js, deps 0
        │   ├── pipeline-runner.js
        │   ├── progress-writer.js
        │   ├── result-to-markdown.js
        │   ├── update-index.js
        │   ├── frontmatter.js
        │   ├── hooks-parser.js
        │   └── mcp/built-pdca-server.js
        └── settings.json              # plugin default settings (선택)
```

Claude Code가 설치 후 plugin을 실제로 어디에 보관하는지는 구현 세부사항으로 보고, built 문서에서는 배포 레포 구조와 `--plugin-dir` 테스트 경로를 기준으로 설명합니다.

### 프로젝트 측 (레포에 속함 — Obsidian vault 호환)

`.built/` 폴더를 **그대로 Obsidian vault로 열 수 있습니다**. 모든 산출 문서가 Markdown + frontmatter + `[[wikilink]]`로 저장되어 Graph View가 자동으로 관계를 그려줍니다.

```
프로젝트 루트/
├── .claude/
│   ├── settings.json                   # 팀 공통 (git)
│   ├── settings.local.json             # 개인 (gitignore)
│   └── worktrees/                      # 공식 worktree 경로 (gitignore)
│
├── .built/                             # ← Obsidian vault 루트
│   ├── context.md                      # 프로젝트 전역 컨텍스트 (git)
│   ├── features-index.md               # 허브 — 전체 feature 목록 (git, 자동 생성)
│   ├── config.json                     # 팀 설정 (git, 기계 전용)
│   ├── config.local.json               # 개인 (gitignore)
│   ├── hooks.json                      # 팀 파이프라인 훅 (git)
│   ├── hooks.local.json                # 개인 훅 (gitignore)
│   │
│   ├── features/                       # feature 단위 스펙 (git)
│   │   ├── user-auth.md                # ★ feature-spec (frontmatter + 본문)
│   │   └── payment.md
│   │
│   ├── decisions/                      # 재사용되는 아키텍처 결정 (git)
│   │   ├── nextauth-v5-wrapping.md
│   │   └── prisma-postgres.md
│   │
│   ├── entities/                       # 도메인 엔티티 (git)
│   │   ├── user.md
│   │   └── team-membership.md
│   │
│   ├── patterns/                       # 참조 패턴 / 컨벤션 (git)
│   │   ├── api-route-convention.md
│   │   └── button-primitive.md
│   │
│   └── runs/                           # 실행 산출물 (feature별)
│       └── <feature-name>/
│           ├── state.json              # 상태 머신 (조건부 git, 기계 전용)
│           ├── do-result.md            # git (sanitize, frontmatter + 본문)
│           ├── check-result.md         # git
│           ├── report.md               # git
│           ├── progress.json           # 실시간 snapshot (gitignore, 기계 전용)
│           └── logs/                   # 원본 이벤트 로그 (gitignore)
│
├── .worktreeinclude                    # .env 등 자동 복사 (git)
└── .gitignore
```

> **주목**: 프로젝트에는 `package.json`, `node_modules`, `.ts` 파일이 **추가되지 않습니다**.
>
> **파일 형식 이분화**:
> - **Markdown + frontmatter** — 사람이 읽고 Obsidian이 시각화하는 모든 산출물 (feature / decision / entity / pattern / do / check / report)
> - **JSON** — 사람이 직접 편집 안 하는 기계 전용 상태 (`config.json`, `hooks.json`, `state.json`, `progress.json`)
>
> **frontmatter 제한**: built은 외부 YAML 패키지를 쓰지 않으므로 문자열/숫자/boolean/null, inline 배열, block 배열, 최대 2단계 객체만 허용합니다. anchor, alias, multiline scalar, 깊은 중첩은 본문 Markdown으로 옮깁니다.

---

## feature-spec.md (frontmatter + 본문)

Plan 단계의 **핵심 산출물**. `.built/features/<name>.md` 한 파일로 저장되며, **frontmatter**에 구조화 메타데이터, **본문**에 서술 + `[[wikilink]]` 관계를 담습니다.

```markdown
---
feature: user-auth
version: 1
status: planned
tags: [auth, onboarding]
primary_user_action: "첫 로그인 후 5분 이내 팀 레포 clone + 필수 도구 설치 완료"
persona:
  role: "주니어 FE (신입~1년차)"
  state_of_mind: "긴장, 실수하기 싫음, 빠르게 기여하고 싶음"
success_criteria:
  - "첫날 퇴근 전 첫 PR open"
  - "설정 관련 슬랙 질문 주 1건 이하"
includes: ["OAuth2 (GitHub, Google)", "팀 repo 권한 부여"]
excludes: ["SSO (SAML)", "2FA 강제"]
anti_goals: ["복잡한 권한 체계 (역할 5개 초과)", "관리자 개입 필요"]
architecture_decision: "[[decisions/nextauth-v5-wrapping]]"
build_files: ["prisma/schema.prisma", "src/lib/auth.ts", "src/app/login/page.tsx"]
---

# user-auth

## Intent
주니어 FE가 첫 반나절 내 PR을 올릴 수 있도록...
- 사용자: [[entities/junior-fe]]

## Architecture
채택: [[decisions/nextauth-v5-wrapping]]
선택하지 않은 대안: 완전 자체 JWT (유지보수 부담), Auth0 (벤더 락인)

## Build Plan
1. **schema**: [[entities/user]] 테이블에 provider_id 추가
2. **core**: NextAuth 설정 → `src/lib/auth.ts`
3. **structure**: 로그인 페이지
...

## Reference Patterns
- [[patterns/api-route-convention]]
- [[patterns/button-primitive]]

## Related
- [[features/payment]] — 같은 [[entities/user]] 확장
```

**보조 문서 타입** (같이 `.built/` 아래에 생성, Obsidian 그래프 구성):
- `decisions/<slug>.md` — 재사용되는 아키텍처 결정 (채택된 feature 역링크 포함)
- `entities/<slug>.md` — 도메인 엔티티
- `patterns/<slug>.md` — 참조 패턴 / 컨벤션
- `features-index.md` — 자동 생성 허브 파일

전체 스키마는 [BUILT-DESIGN.md §7](./BUILT-DESIGN.md#7-feature-specmd-스키마-frontmatter--본문) 참조.

---

## Hooks

파이프라인 중간에 훅을 꽂을 수 있습니다. **command**(셸)와 **skill**(Claude 추론) 두 타입 지원.

`.built/hooks.json` (팀 공통, git):

```json
{
  "pipeline": {
    "after_do": [
      { "run": "npm run lint -- --fix", "halt_on_fail": false },
      { "run": "npm run typecheck", "halt_on_fail": true, "timeout": 60000 },
      {
        "skill": "built-security-audit",
        "condition": "feature.touches_auth == true",
        "model": "sonnet"
      }
    ]
  }
}
```

`.built/hooks.local.json` (개인, gitignore):

```json
{
  "pipeline": {
    "after_do": [
      { "run": "terminal-notifier -title \"built\" -message \"$BUILT_FEATURE done\"" }
    ]
  }
}
```

> `npm run` 부분은 팀 패키지 매니저에 맞춰(`pnpm`, `yarn`, `bun`) 교체. built는 패키지 매니저를 강제하지 않습니다.

| 타입 | 용도 | 비용 | 속도 |
|---|---|---|---|
| `command` | 린트, 타입체크, 테스트 (80%) | 거의 없음 | 수 ms |
| `skill` | 보안 감사, 아키텍처 검토 (20%) | 토큰 + 시간 | 수 초~수십 초 |

환경변수(`BUILT_FEATURE`, `BUILT_WORKTREE`, `BUILT_PREVIOUS_RESULT` 등)가 명령 실행 시 자동 주입됩니다.

> **MVP에서는 훅 시스템 유예.** v1.0 팀 확장 단계에서 도입.

---

## 공식 Claude Code 기능 활용

전부 직접 만들지 않고, **공식 기능 위에 built 레이어만** 올립니다.

| 기능 | 활용처 |
|---|---|
| `--worktree <name>` | worktree 자동 생성/정리 |
| `.worktreeinclude` | gitignored 로컬 파일 자동 복사. secret 파일은 deny-by-default |
| `--permission-mode plan` | Plan Mode (read-only) |
| Subagent `isolation: worktree` | 서브에이전트 자동 격리 |
| `--resume <session-id>` | Iter 시 컨텍스트 재사용 |
| WorktreeCreate/Remove hooks | worktree 라이프사이클 커스텀 |
| Notification hook | macOS/Linux/Windows 알림 |
| Skills + `disable-model-invocation` | Claude의 자동 skill invocation 차단 |
| Skills + `user-invocable: false` | `/` 메뉴에서 숨기는 내부 지식용 skill |
| `--output-format stream-json` | 진행 상황 모니터링 |
| Plugin marketplace 구조 | 팀 배포 |

---

## Git 추적 정책

### 추적 (git)

**Markdown 산출물 (Obsidian vault)**:
- `features/*.md` — feature spec, 팀 공유 자산
- `decisions/*.md`, `entities/*.md`, `patterns/*.md` — 재사용 가능한 결정/엔티티/패턴
- `features-index.md` — 허브 (자동 생성)
- `context.md` — 프로젝트 전역 컨텍스트
- `runs/<name>/do-result.md`, `check-result.md`, `report.md` — sanitize 후

**기계 전용 상태**:
- `runs/<name>/state.json` (조건부)
- `.claude/settings.json`
- `.built/config.json`, `hooks.json`
- `.worktreeinclude`

### Gitignore

```gitignore
.claude/worktrees/
.claude/settings.local.json

.built/locks/
.built/registry.json
.built/config.local.json
.built/hooks.local.json

.built/runs/*/progress.json
.built/runs/*/logs/
.built/runs/*/iterations/
.built/runs/*/plan-draft.md

# Obsidian 개인 설정 (사용자가 .built/를 vault로 열 경우)
.built/.obsidian/workspace.json
.built/.obsidian/workspace-mobile.json
```

### Sanitize

추적되는 **Markdown 및 JSON** 산출물에서 커밋 전 자동 마스킹:
- `session_id` (선택적)
- 사용자 홈 경로 (`/Users/gin/...` → `~/...`)
- API 키 패턴 (`sk-ant-*`, `ghp_*`)
- 환경변수 (`SAFE_KEYS` 외 전부 제거)

Markdown의 경우 frontmatter와 본문 양쪽에 동일 규칙 적용. pre-commit hook으로 안전망.

## `.worktreeinclude` 보안 기본값

`.worktreeinclude`에 포함된 파일은 worktree 안에서 Claude가 읽을 수 있으므로, built 기본 정책은 secret 파일 deny-by-default입니다.

- `.env`, `.env.local`, `.env.production`, 인증서, private key는 기본 템플릿에 넣지 않음
- 실제 secret 대신 `*.example.*` 파일이나 로컬 테스트 값 우선
- sanitize는 마지막 안전망일 뿐이고, 민감 파일을 worktree에 복사하지 않는 것이 1차 방어선

---

## 에디터 성능

worktree 여러 개 생기면 에디터가 버벅일 수 있습니다. `.vscode/settings.json`에 제외 경로를 추가하세요.

```json
{
  "files.watcherExclude": {
    "**/.claude/worktrees/**": true,
    "**/node_modules/**": true,
    "**/.built/runs/**/logs/**": true
  },
  "search.exclude": { "**/.claude/worktrees": true },
  "files.exclude": { "**/.claude/worktrees": true },
  "typescript.tsserver.maxTsServerMemory": 4096
}
```

```json
// tsconfig.json
{ "exclude": ["node_modules", "dist", ".claude/worktrees"] }
```

성능 이슈가 지속되면 개인 `config.local.json`에서 worktree 위치 override:

```json
{ "worktree_location": "sibling" }
```
(프로젝트 바깥 sibling 디렉토리에 worktree 생성)

---

## 비용 관리

Plan (Opus) + Do (Opus) + Check (Opus) + Iter 3회 (Opus) = **feature 당 $5~15**.
첫 달 10개 feature 돌리면 $100+ 예상.

**대응**:
- `total_cost_usd > $1.0` 이면 진행 전 사용자 확인
- 드라이런 모드 (`--dry-run`)
- Iter `max_iterations: 3` + 수렴 불가 감지 시 escalate

---

## 로드맵

### Week 1: PoC + Phase 1

**PoC 4개 (실측 필수)**:
- PoC-1: 백그라운드 `claude -p` spawn + 메인 세션 대화형 유지
- PoC-2: stream-json 이벤트 실측 및 파싱
- PoC-3: AskUserQuestion 다중 연속 호출 ★ Plan 구현 결정
- PoC-4: worktree + `claude -p` + `.worktreeinclude` 격리

**Phase 1**:
- `/built:init`, `/built:plan`, `/built:do` (포그라운드)
- `runs/<name>/state.json`, `progress.json`, `do-result.md`

### Week 2: 자동화 연결

- `/built:check`, Iter 루프, `/built:run`
- 백그라운드 + 폴링, Notification hook

### Week 3: 안정화

- `/built:status`, `/built:resume`, `/built:abort`
- Sanitize + pre-commit hook, 수동 스키마 검증 (Node 표준, deps 0), 비용 경고

### Week 4+: 팀 확장

- 멀티 피처 (lock, registry)
- 모델 변형
- 훅 시스템 도입
- 마켓플레이스 배포 자동화

### YAGNI (지금은 하지 않음)

- 웹 대시보드
- 프로필 시스템
- Agent Teams 연동
- `/built:plan-quick` 같은 단축 모드

---

## 플러그인 / 마켓플레이스

### MVP: Plugin-first

MVP부터 플러그인 구조로 시작합니다. 명령어 네임스페이스(`/built:*`)와 팀 배포 방식을 초기부터 고정해 문서와 실제 사용법이 갈라지지 않게 합니다.

로컬 개발 중에는 `claude --plugin-dir <path>`로 직접 로드해 검증하고, 팀 배포 시점에는 marketplace에 올립니다. 프로젝트에는 `.built/`와 `.claude/`만 생성됩니다.

### 마켓플레이스 배포

팀 `.claude/settings.json`에 marketplace를 선언해 설치 프롬프트와 기본 활성화를 유도할 수 있습니다:

```json
{
  "extraKnownMarketplaces": {
    "built-tools": {
      "source": { "source": "github", "repo": "ride/built-marketplace" }
    }
  },
  "enabledPlugins": { "built@built-tools": true }
}
```

이 설정은 프로젝트를 trust한 팀원에게 marketplace 설치를 안내하고, 설치 후 `built@built-tools`를 기본 활성화하는 용도입니다.

Claude Code가 설치된 plugin의 실제 저장 경로를 관리하므로, built는 특정 사용자 홈 경로에 의존하지 않습니다. 프로젝트 레포에는 여전히 실행 스크립트를 추가하지 않습니다.

---

## 위험 요소

### Critical

- **C1** 백그라운드 `claude -p` 패턴 미검증 → PoC-1
- **C2** Plan 대화 세션 종료 지점 불명확 → PoC-3
- **C3** Iter 루프 수렴 보장 약함 → 정량 지표 + 비용 상한

### Major

- **M1** Worktree 생성 타이밍 (Plan 메인 / Do worktree 경로 매핑)
- **M2** feature-spec 추상화 수준
- **M3** progress-writer 신뢰성 (atomic write)
- **M4** 멀티 피처 동시성 (초기 `max_parallel: 1`)
- **M5** 훅 시스템 복잡도 (MVP 유예)

---

## 참고 자료

- [BUILT-DESIGN.md](./BUILT-DESIGN.md) — 전체 설계 문서
- [Claude Code Plugins](https://code.claude.com/docs/en/plugins)
- [Claude Code Plugin Marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [Claude Code Common Workflows](https://code.claude.com/docs/en/common-workflows)
- [impeccable craft SKILL](https://impeccable.style/skills/impeccable)
- [impeccable shape SKILL](https://impeccable.style/skills/shape)

---

## 상태

**설계 단계** (MVP 착수 전). 최종 업데이트: 2026-04-23.

구현 중 바뀌는 결정 사항은 별도 `CHANGELOG.md`로 추적.

**도움말**: `#engineering-tools` 채널
