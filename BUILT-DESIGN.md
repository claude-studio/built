# built — PDCA 오케스트레이션 도구 설계 문서

> Ride 엔지니어링팀의 AI 개발 워크플로우 도구.
> Plan/Design은 사람이, Do → Check → Iter → Report는 Claude 서브프로세스가 자동으로.

**최종 업데이트**: 2026-04-24
**작성자**: 지니
**상태**: MVP 구현 완료, next-step 아키텍처 정리 중

---

## 목차

1. [프로젝트 정체성](#1-프로젝트-정체성)
2. [핵심 철학](#2-핵심-철학)
3. [이름 결정 근거](#3-이름-결정-근거)
4. [공식 Claude Code 기능 활용 매핑](#4-공식-claude-code-기능-활용-매핑)
5. [디렉토리 구조](#5-디렉토리-구조)
6. [Plan 단계 — impeccable craft 방식](#6-plan-단계--impeccable-craft-방식)
7. [feature-spec.md 스키마 (frontmatter + 본문)](#7-feature-specmd-스키마-frontmatter--본문)
8. [자동화 단계 (Do → Check → Iter → Report)](#8-자동화-단계-do--check--iter--report)
9. [Hooks 시스템](#9-hooks-시스템)
10. [Git 추적 정책](#10-git-추적-정책)
11. [에디터 성능 대응](#11-에디터-성능-대응)
12. [.worktreeinclude 동작](#12-worktreeinclude-동작)
13. [플러그인 / 마켓플레이스](#13-플러그인--마켓플레이스)
14. [위험 요소 및 대응](#14-위험-요소-및-대응)
15. [구현 로드맵](#15-구현-로드맵)
16. [다음 액션](#16-다음-액션)

---

## 1. 프로젝트 정체성

**이름**: `built`

**포지션**: bkit 대체. Claude Code 위에서 Plan-Do-Check-Act 워크플로우를 자동화하는 오케스트레이션 레이어.

**대상**: Ride 엔지니어링팀 (프론트엔드 개발자 중심). **대상 프로젝트 스택 무관** — built 자체는 Node.js 표준 라이브러리로 구현되어 Python/Go/Rust/JS 등 어떤 언어/런타임의 프로젝트에서도 동작한다.

**구현 언어**: Node.js 20+ 권장. 외부 npm 의존성 0. bkit의 `bkit-pdca-server` 패턴 채택 — 플러그인 디렉토리에만 설치되며 대상 프로젝트의 `package.json`/`node_modules`를 건드리지 않는다.

**핵심 명령어**:

```bash
/built:init                 # 프로젝트 1회 bootstrap
/built:plan <feature>       # orchestrator interactive Plan/Design
/built:run <feature>        # headless pipeline 실행 (node scripts/run.js)
/built:status [feature]     # 진행 상황 조회
/built:list                 # 활성 feature 목록
/built:abort <feature>      # 중단
/built:resume <feature>     # 재개

# 모델 변형
/built:run-opus <feature>
/built:run-sonnet <feature>

# 유틸
/built:validate             # 설정 파일 검증
```

---

## 2. 핵심 철학

### 원칙

- **사용자는 Plan/Design까지만** 개입 (대화형으로 의도와 청사진 확정)
- **Do/Check/Iter/Report는 완전 자동화** (`claude` 서브프로세스)
- **파일 시스템이 SSOT** — 메인 세션과 서브세션의 유일한 통신 수단
- **Init은 프로젝트 bootstrap 1회**, feature lifecycle은 `/built:plan <feature>` 부터 시작
- **Plan은 orchestrator interactive 세션에서 수행**
- **현재 Run은 `scripts/run.js` 오케스트레이터**가 Do → Check → Iter → Report를 순차 실행
- **shared runtime은 handoff + 상태 저장소**다. 현재는 `state.json`이 핵심 SSOT이고, progress/log/result는 일부가 feature 결과 디렉토리에 저장된다.
- **`--worktree` 재사용 구조는 Next Step** 으로 유지한다.

### bkit와 차이

| 항목 | bkit | built |
|---|---|---|
| 실행 격리 | 같은 세션 내 skill 전환 | `claude -p` 프로세스 분리 |
| 상태 관리 | `.bkit-memory.json` 단일 파일 | shared runtime (`run-request/state/progress/logs`) |
| 병렬성 | Agent Teams | feature별 pipeline 실행, 장기적으로 worktree 병렬 확장 |
| 컨텍스트 | 메인에 누적 | 서브세션에 격리 |

---

## 3. 이름 결정 근거

### 왜 `built`?

**기준 우선순위** (지니님 선택):
1. 의미 즉시 이해 (직관성)
2. 짧고 기억 잘 됨
3. 충돌 없음
4. 브랜딩/미적 감각
5. 게임 감성과 맞음

**`built`가 1~3위를 모두 충족**:

- **의미 즉시 이해**: "빌드하는 도구" 1초 안에 감 옴
- **5글자 1음절**: 입에 붙음, 타이핑 부담 최소
- **충돌 낮음**: `builder`와 달리 과거분사형은 프로덕트 이름으로 드뭄

**PDCA 철학과 미묘한 매칭**:
- `builder`: 짓는 주체 (진행형)
- `built`: **이미 완성된 결과** (완료형)
- built의 목표 = "feature를 built 상태까지 끌고 가기"

### 검토했지만 탈락한 후보

- **craft**: impeccable의 `/impeccable craft` 와 인지적 충돌
- **builder**: 이름 충돌 과다 (React Builder, Webflow Builder, Builder.io 등)
- **pipeline**: 8글자로 김, 너무 일반적 용어
- **wright, valve, chisel, kiln, anvil**: 모두 고려됐으나 `built`가 직관성 기준에서 우위

---

## 4. 공식 Claude Code 기능 활용 매핑

bkit처럼 전부 직접 만드는 게 아니라, **공식 기능 위에 built 레이어만 올림**.

### 공식 기능 사용

| 기능 | 활용처 |
|---|---|
| `claude -p` | Do / Report 단계 headless 실행 |
| `claude --bare -p` | Check 단계 구조화 실행 |
| `--worktree <name>` | Next Step: execution worktree 생성 |
| `.worktreeinclude` | `.env` 등 gitignored 파일 자동 복사 |
| `--permission-mode plan` | Plan Mode (read-only) |
| `--json-schema <schema>` | Check 단계 구조화 출력 강제 |
| WorktreeCreate/Remove hooks | worktree 라이프사이클 커스텀 |
| Notification hook | macOS/Linux/Windows 알림 |
| Skills + `disable-model-invocation` | Claude의 자동 skill invocation 차단. 사용자가 `/built:*`로만 실행해야 하는 workflow에 사용 |
| Skills + `user-invocable: false` | `/` 메뉴에서 숨기는 내부 지식용 skill. 접근 제어가 아니라 노출 제어 |
| `--output-format stream-json --verbose` | 진행 상황 모니터링 |
| Plugin marketplace 구조 | 팀 배포 |

### 직접 구현 (built 레이어)

| 요소 | 이유 |
|---|---|
| PDCA state machine (phase 감지) | 공식 기능 없음 |
| `feature-spec.md` 스키마 (frontmatter + 본문) + 워크플로우 | built 고유, Tolaria/Markdown knowledge layer 호환 |
| shared runtime / handoff store (`run-request.json`, `state.json`) | Plan과 Run 사이 handoff와 상태 추적에 필요 |
| 일관성 검색 (Prior Art) — 이전 산출물 마크다운 탐색 | 공식 기능 없음 |
| `progress-writer.js` — stream-json → feature-local `progress.json` 실시간 파이프 | 공식 기능 없음 |
| `result-to-markdown.js` — result 이벤트 → `do/report-result.md` 포매팅 | 공식 기능 없음 |
| Iter 루프 + max_iterations + failure classification | 공식 기능 없음 |
| registry, locks, heartbeat polling (멀티 피처) | 공식 기능 없음 |
| `hooks.json` 팀/개인 병합 | 플러그인 이상의 커스터마이징 |

### 구현 제약 (프로젝트 영향 0)

- **언어**: Node.js (CommonJS 또는 ESM). built 스크립트 실행을 위해 Node.js 20+를 권장한다. Claude Code 설치 방식에 따라 Node가 이미 있을 수도 있지만, built의 런타임 요구사항으로 별도 명시한다.
- **외부 패키지**: **0**. Zod/yaml 같은 패키지 대신 Node 표준 라이브러리 사용.
  - JSON 검증 → 수동 타입 체크 (`typeof`, `Array.isArray`, `in` 연산자)
  - YAML 파싱 → frontmatter 전용 최소 subset 파서를 built 내부에 인라인. 예시 스키마가 중첩 객체/배열을 쓰므로 정규식 한 줄 파싱은 금지
  - 파일 I/O, 프로세스, JSON-RPC → `fs`, `child_process`, `readline` 내장 모듈
- **배포 방식**: MVP부터 Claude Code 플러그인으로 배포한다. 로컬 개발은 `claude --plugin-dir <plugin-dir>`로 검증하고, 팀 배포는 marketplace를 사용한다. Claude Code가 실제 설치 위치를 관리하므로 built 구현은 특정 사용자 홈 경로에 의존하지 않는다. 대상 프로젝트 레포에는 `.built/` (상태 파일) + `.claude/` (설정)만 생성.
- **참고 구현**: [bkit-pdca-server](https://github.com/popup-studio-ai/bkit-claude-code) `servers/bkit-pdca-server/index.js` — `"Lightweight JSON-RPC 2.0 over stdio — no external dependencies"` 주석이 박혀있는 것과 동일 철학.

---

## 5. 디렉토리 구조

built은 현재 두 개의 핵심 공간과 하나의 예약 공간으로 나뉜다:

1. **플러그인 소스 측** (`built-marketplace/` 레포) — marketplace manifest, plugin manifest, skill 정의, hook/MCP 스크립트. 로컬 개발과 팀 배포의 기준이 되는 소스 구조.
2. **오케스트레이터 프로젝트 측** (`원본 레포/.built`, `.claude/`) — interactive Plan이 쓰는 canonical spec / 지식 문서 / runtime / 결과 문서.
3. **execution worktree 측** (`.claude/worktrees/<feature-runner>/`) — Next Step에서 연결할 예약 작업 공간.

### 플러그인 소스 측 (배포 레포 기준, 프로젝트 영향 0)

```
built-marketplace/
├── .claude-plugin/
│   └── marketplace.json
└── plugins/
    └── built/
        ├── .claude-plugin/
        │   └── plugin.json
        ├── skills/
        │   ├── init/SKILL.md           # /built:init
        │   ├── plan/SKILL.md           # /built:plan
        │   ├── run/SKILL.md            # /built:run
        │   ├── status/SKILL.md
        │   └── ...
        ├── hooks/
        │   └── hooks.json              # plugin lifecycle hooks (선택)
        ├── .mcp.json                   # plugin MCP server wiring (선택)
        ├── scripts/                    # Node.js, deps 0
        │   ├── pipeline-runner.js
        │   ├── progress-writer.js
        │   ├── result-to-markdown.js
        │   ├── update-index.js
        │   ├── hooks-parser.js
        │   └── mcp/built-pdca-server.js
        └── settings.json               # plugin default settings (선택)
```

> Claude Code가 설치 후 내부적으로 plugin을 어디에 풀어두는지는 구현 세부사항으로 보고, built 문서에서는 배포 레포 구조와 `--plugin-dir` 테스트 경로만 설계 기준으로 삼는다.

### 오케스트레이터 프로젝트 측 (레포에 속함 — Tolaria/Markdown knowledge layer)

`.built/` 폴더는 **Tolaria 기준의 Markdown/Git knowledge layer** 로 설계한다. 모든 feature / decision / entity / pattern 문서는 Markdown + frontmatter로 저장되며, 문서 간 관계는 `[[wikilink]]` 로 표현된다. 즉 built는 특정 에디터 전용 포맷을 만들지 않고, Tolaria처럼 Markdown + Git + 관계 모델을 쓰는 도구에서 바로 다룰 수 있는 문서층을 유지한다. Obsidian으로 열어도 읽히지만, 설계 기준은 Obsidian 전용이 아니다.

```
프로젝트 루트/
├── .claude/
│   ├── settings.json                    # git 추적 (팀 공통)
│   ├── settings.local.json              # gitignore
│   └── worktrees/                       # gitignore (현재는 예약 공간)
│
├── .built/                              # ← knowledge layer 루트
│   ├── context.md                       # 프로젝트 전역 컨텍스트 (git)
│   ├── features-index.md                # ★ 허브 — 전체 feature 목록 (git, 자동 생성)
│   ├── config.json                      # 팀 설정 (git, 기계 전용)
│   ├── config.local.json                # 개인 (gitignore)
│   ├── hooks.json                       # 팀 파이프라인 훅 (git)
│   ├── hooks.local.json                 # 개인 훅 (gitignore)
│   ├── hooks.local.json.example         # 온보딩 예시 (git)
│   │
│   ├── features/                        # feature 단위 스펙 + 실행 결과 (git 일부)
│   │   ├── user-auth.md                 # ★ feature-spec (frontmatter + 본문)
│   │   ├── payment.md
│   │   ├── onboarding.md
│   │   └── user-auth/
│   │       ├── do-result.md
│   │       ├── check-result.md
│   │       ├── report.md
│   │       ├── progress.json
│   │       └── logs/
│   │
│   ├── decisions/                       # 재사용되는 아키텍처 결정 (git)
│   │   ├── nextauth-v5-wrapping.md
│   │   ├── prisma-postgres.md
│   │   └── rejected-auth0.md
│   │
│   ├── entities/                        # 도메인 엔티티 (git)
│   │   ├── user.md
│   │   └── team-membership.md
│   │
│   ├── patterns/                        # 참조 패턴 / 컨벤션 (git)
│   │   ├── api-route-convention.md
│   │   └── button-primitive.md
│   │
│   ├── runtime/                         # shared handoff + 상태 저장소 (gitignore)
│   │   ├── registry.json
│   │   ├── locks/
│   │   │   └── user-auth.lock
│   │   └── runs/
│   │       └── user-auth/
│   │           ├── run-request.json     # Plan → Run handoff
│   │           ├── state.json           # phase / status / heartbeat / pid
│   │           ├── last_error.json      # 실패 요약
│   │           └── notes.json           # 선택적 보조 메타데이터
│   │
│   └── runs/                            # 실행 산출물 (feature별, 일부 gitignore)
│       └── user-auth/
│           ├── plan-draft.md            # gitignore (인터뷰 중간 저장)
│           ├── plan-summary.md          # 선택, 사람용 요약
│           └── notes.md                 # 선택, 사람용 보조 메모
│
├── .worktreeinclude                     # git 추적
└── .gitignore
```

### execution worktree 측 (Next Step)

장기적으로는 feature당 **execution worktree 1개**를 사용해 Do → Check → Iter → Report를 같은 worktree에서 재사용하는 방향이 더 좋다. 다만 현재 MVP 핵심 경로는 이 구조를 아직 사용하지 않는다.

예시:

```
프로젝트 루트/.claude/worktrees/user-auth-runner/
├── src/...                              # 실제 코드 변경
├── prisma/...
└── .built/
    └── runs/
        └── user-auth/
            ├── do-result.md             # git diff / review 대상
            ├── check-result.md
            └── report.md
```

**현재 기준**:
- 결과 문서는 `.built/features/<feature>/` 아래에 저장된다.
- `state.json`, `run-request.json` 같은 handoff/상태는 `.built/runtime/runs/<feature>/` 아래에 저장된다.

**Next Step 기준**:
- shared runtime은 `원본 레포/.built/runtime/` 을 canonical 경로로 사용한다.
- worker는 자기 cwd가 worktree 안에 있어도, `BUILT_RUNTIME_ROOT` 같은 절대경로를 통해 **원본 레포의 runtime 파일**을 갱신한다.
- 즉 "worktree가 상위 폴더를 자동 동기화"하는 것이 아니라, built가 **같은 runtime 경로를 모두에게 주입**해서 상태를 공유하는 구조다.

**주의**: 프로젝트 레포에 `node_modules`, `package.json`, `.ts` 파일이 **추가되지 않는다**. 실행 스크립트는 모두 플러그인 측에 있음.

### 파일 형식 결정 (옵션 C — Markdown + frontmatter)

**두 가지 형식만 사용한다**:

| 종류 | 예시 | 이유 |
|---|---|---|
| **Markdown + YAML frontmatter** | `features/*.md`, `decisions/*.md`, `runs/*/do-result.md` | 사람이 읽고 Tolaria 같은 문서 도구가 해석하며, Claude가 읽고, frontmatter는 기계 파싱 가능 |
| **JSON** | `config.json`, `hooks.json`, `state.json`, `progress.json`, `registry.json` | 기계 전용 상태 파일. 사람이 직접 편집 안 함 |

**원칙**:

- **산출 문서는 Markdown** — feature-spec / decision / entity / pattern / do / check / report 결과는 전부 `.md`. frontmatter에 구조화 메타데이터, 본문에 서술 + `[[wikilink]]`.
- **기계 전용 상태 파일만 JSON** — 사람이 편집할 일이 없고 파싱이 `JSON.parse` 하나로 끝남.
- **frontmatter 파싱** — YAML 호환 최소 subset만 사용 (문자열/숫자/boolean/null, inline 배열, block 배열, 최대 2단계 객체). `gray-matter` 같은 외부 패키지는 쓰지 않되, 들여쓰기 기반 최소 파서를 구현한다. 정규식 한 줄 파싱은 중첩 필드(`persona`, `constraints.technical`) 때문에 금지.
- **frontmatter 스키마 제한** — anchor, alias, multiline scalar(`|`, `>`), 복합 키, 깊은 중첩은 사용하지 않는다. 복잡한 구조가 필요하면 본문 Markdown에 쓰고 frontmatter에는 인덱싱용 요약만 둔다.
- **wikilink 파싱** — `/\[\[([^\]]+)\]\]/g` 정규식 한 줄.
- **Tolaria 우선, Obsidian 호환** — `.built/` 는 특정 앱 전용이 아니라 Markdown/Git 문서층이다. Tolaria에서 바로 활용하기 좋고, Obsidian에서도 열 수 있다.

### Prior Art 탐색 (일관성 검색)

Plan 단계 진입 시, 이전 feature들의 spec을 **knowledge-layer 문서 탐색 방식**으로 읽어 일관성을 확보한다:

1. `features-index.md` 읽기 → 전체 feature 요약 파악
2. 현재 feature와 관련된 `[[features/*]]` 링크를 Claude가 고름
3. 해당 `.md` 파일을 Read로 읽기
4. 파일 내부의 `[[decisions/*]]`, `[[entities/*]]`, `[[patterns/*]]` 링크를 재귀적으로 따라감
5. Phase 2 (Architecture), Phase 3 (Build Plan)에서 "이전 채택 X를 이번에도?", "이전 anti-goal 위반 경고" 등의 프롬프트에 활용

별도 KG DB, 벡터 인덱스, 리랭커 없음. **문서 + wikilink + Claude의 읽기 능력**이 전부.

---

## 6. Plan 단계 — impeccable craft 방식

### 설계 결정

**Plan과 Design은 합쳐서 하나의 skill**. 이유:

1. impeccable craft 자체가 shape(의도) + build order(청사진)를 하나로 묶은 검증된 구조
2. 중간 결과물 불안정 문제 해결
3. 대화 맥락 끊김 방지
4. 사용자 확인이 한 번에 끝남

### 6단계 플로우

```
/built:plan user-auth
  │
  ├─ Orchestrator context
  │    - 이 명령은 항상 원본 레포 checkout의 interactive 세션에서 수행
  │    - worktree 진입 없이 사용자와 Plan/Design 핑퐁을 계속한다
  │    - 아직 headless worker는 생성하지 않는다
  │
  ├─ Phase 0: Prior Art (knowledge layer 탐색)
  │    - .built/features-index.md 읽기
  │    - 현재 feature 이름/키워드와 관련된 [[features/*]] 링크 선별
  │    - 선별된 .md 파일을 Read로 읽음
  │    - 파일 내 [[decisions/*]], [[entities/*]], [[patterns/*]] 재귀 탐색
  │    - 다음 Phase에서 참고할 컨텍스트 확보
  │
  ├─ Phase 1: Intent (의도 캡처)
  │    - Purpose & Context (누가, 왜, 성공 기준)
  │    - Scope & Anti-Goals (포함/제외/리스크)
  │    - Content & Data (엔티티, 엣지 케이스)
  │    - Constraints (기술/일정/접근성)
  │    [AskUserQuestion으로 한 번에 하나씩]
  │
  ├─ Phase 2: Architecture Direction
  │    - 2~3개 접근 제안 + 트레이드오프
  │    - ★ Phase 0에서 읽은 [[decisions/*]] 기반으로 "이전 채택 X를 이번에도?" 질문
  │    - 사용자 선택 + "왜 다른 것들 아닌가" 기록
  │
  ├─ Phase 3: Build Plan
  │    [순서 엄격: Schema → Core → Structure → States → Integration → Polish]
  │    - 각 step: what/files/phase
  │    - Reference patterns (기존 코드) — ★ Phase 0에서 읽은 [[patterns/*]]을 기본 후보로
  │    - ★ [[entities/*]] 중복 감지 → 재정의 대신 확장 제안
  │    - Test strategy
  │
  ├─ Phase 4: Spec Review (섹션별 confirmation)
  │    - Intent / Architecture / Build Plan / Risks
  │    - 수정 요청 → 해당 Phase로 back
  │
  └─ Phase 5: Save
       - features/<name>.md 저장 (frontmatter + 본문, wikilink 포함)
       - 새로 도입된 결정/엔티티/패턴이 있으면 decisions/*.md, entities/*.md, patterns/*.md 신규 생성
       - features-index.md 재생성 (허브 갱신)
       - `.built/runtime/runs/<name>/run-request.json` 생성
       - `.built/runtime/runs/<name>/state.json` 초기화 (`status: planned`)
```

### craft에서 가져온 핵심 원칙

1. **한 번에 하나씩 질문** (form dumping 금지)
2. **"standard/normal" 답변 거부** — 구체화 강제
3. **Anti-goals 명시 필수** — NOT 이어야 할 것
4. **Intent 단계에서 솔루션 금지** — 이해 먼저
5. **Build order 엄격** (Schema → Core → Structure → States → Integration → Polish)
6. **Brief는 checklist 아니라 compass** — 의도 포착
7. **Mandatory preparation** — `.built/context.md` 없으면 먼저 생성

---

## 7. feature-spec.md 스키마 (frontmatter + 본문)

Plan 단계의 **핵심 산출물**. `.built/features/<name>.md` 한 파일로 저장되며, frontmatter에 구조화 메타데이터, 본문에 서술 + `[[wikilink]]` 관계를 담는다.

### 설계 원칙

- **frontmatter** — 기계가 파싱 (인덱스 생성, 링크 추적, 태그 필터)
- **본문** — Claude가 해석하고 사용자가 읽음
- **wikilink** — 문서 간 관계 (Tolaria/Markdown graph 도구에서 활용 가능)
- **동일 파일 하나**가 SSOT. JSON 파생물 없음.

### 예시: `.built/features/user-auth.md`

```markdown
---
feature: user-auth
version: 1
created_at: 2026-04-23
confirmed_by_user: true
status: planned
tags: [auth, onboarding]
primary_user_action: "첫 로그인 후 5분 이내에 팀 레포 clone + 필수 도구 설치 완료"
persona:
  role: "주니어 FE (신입~1년차)"
  context: "입사 첫날, 온보딩 문서 읽으면서"
  frequency: "1회 (재설치 시 재사용)"
  state_of_mind: "긴장, 실수하기 싫음, 빠르게 기여하고 싶음"
success_criteria:
  - "첫날 퇴근 전 첫 PR open"
  - "설정 관련 슬랙 질문 주 1건 이하"
  - "2주 차에 동일 사용자가 다시 이 feature 쓰지 않음 (학습됨)"
includes:
  - "OAuth2 (GitHub, Google)"
  - "팀 repo 자동 권한 부여"
  - "필수 도구 체크리스트 UI"
excludes:
  - "SSO (SAML) — 다음 분기"
  - "2FA 강제 — v2에서"
  - "권한 관리 어드민 UI — 별도 feature"
anti_goals:
  - "복잡한 권한 체계 (역할 5개 넘으면 설계 실패로 간주)"
  - "관리자 개입 필요한 플로우"
  - "모바일 앱 지원"
architecture_decision: "[[decisions/nextauth-v5-wrapping]]"
build_files:
  - "prisma/schema.prisma"
  - "src/lib/auth.ts"
  - "src/app/api/auth/[...nextauth]/route.ts"
  - "src/app/login/page.tsx"
  - "src/components/onboarding/Checklist.tsx"
  - "src/middleware.ts"
constraints:
  technical:
    - "Next.js 15 + NextAuth v5"
    - "Postgres (기존 스키마 유지)"
    - "초기 로그인 응답 < 1.5s"
  timeline: "2주"
  accessibility: "WCAG AA, 키보드 only 완주 가능"
---

# user-auth

## Intent

신규 온보딩 중인 주니어 FE가 첫 반나절 내 PR을 올릴 수 있도록, 팀 레포 접속 권한과 기본 세팅을 한번에 끝내는 auth 시스템.

- **사용자**: [[entities/junior-fe]]
- **주요 액션**: 첫 로그인 후 5분 이내 팀 레포 clone + 필수 도구 설치 완료

## Scope

### Includes
- OAuth2 (GitHub, Google)
- 팀 repo 자동 권한 부여
- 필수 도구 체크리스트 UI

### Excludes
- SSO (SAML) — 다음 분기
- 2FA 강제 — v2에서
- 권한 관리 어드민 UI — 별도 feature

### Anti-Goals
- 복잡한 권한 체계 (역할 5개 넘으면 설계 실패로 간주)
- 관리자 개입 필요한 플로우
- 모바일 앱 지원

## Content & Data

### Entities
- [[entities/user]] — 500명, 연 20% 성장
- [[entities/team-membership]] — User × 2.3팀 평균

### Edge Cases
- 이미 다른 org에 속한 GitHub 계정
- 이메일이 여러 도메인에 중복
- 첫 로그인 실패 (2FA 걸린 경우)

## Architecture

채택: [[decisions/nextauth-v5-wrapping]]

### 선택하지 않은 대안
- 완전 자체 JWT 구현 — 유지보수 부담
- Auth0 도입 — 비용 + 벤더 락인

### Tradeoffs
- NextAuth 버전 업데이트에 따라가야 함
- 커스터마이징은 adapter 통해서만

## Build Plan

순서: Schema → Core → Structure → States → Integration → Polish

1. **schema**: [[entities/user]] 테이블에 `provider_id`, `onboarded_at` 컬럼 추가
   - `prisma/schema.prisma`, `prisma/migrations/...`
2. **core**: NextAuth 설정 + Provider 등록
   - `src/lib/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`
3. **structure**: 로그인 페이지 골격, 온보딩 체크리스트 컴포넌트
   - `src/app/login/page.tsx`, `src/components/onboarding/Checklist.tsx`
4. **states**: 로딩, 에러, 이미 로그인됨, 권한 없음 상태
   - `src/app/login/loading.tsx`, `src/app/login/error.tsx`
5. **integration**: 기존 `/dashboard` 보호, middleware 적용
   - `src/middleware.ts`, `src/app/dashboard/layout.tsx`
6. **polish**: 접근성, 키보드 네비게이션, 에러 메시지 개선

### Reference Patterns
- [[patterns/api-route-convention]] — 기존 API route 컨벤션 (`src/app/api/users/route.ts`)
- [[patterns/button-primitive]] — UI primitive 스타일 통일 (`src/components/Button.tsx`)

### Test Strategy
- **unit**: `auth.ts`의 callback 함수들
- **integration**: NextAuth route handler + DB
- **e2e**: 로그인 플로우 전체 (Playwright)

## Risks & Open Questions

### Risks
- NextAuth v5 beta 상태 — breaking changes 가능
- GitHub API rate limit — 팀 권한 조회 시
- 기존 사용자 마이그레이션 — 세션 깨짐 가능

### Open Questions
- 이메일 중복 시 merge 정책?
- 세션 만료 시간?

## Related

- [[features/payment]] — 같은 [[entities/user]] 확장
- [[features/onboarding]] — 같은 [[decisions/nextauth-v5-wrapping]] 채택 가능성
```

### 보조 문서 스키마

feature-spec 외에도 **4가지 문서 타입**이 `.built/` 내에 마크다운으로 저장되어 Tolaria 같은 knowledge layer 도구가 관계를 따라갈 수 있게 한다:

#### `decisions/<slug>.md` — 아키텍처 결정

```markdown
---
type: decision
slug: nextauth-v5-wrapping
adopted_count: 2
tags: [auth, architecture]
---

# NextAuth v5 래핑

서버 컴포넌트 기반 NextAuth 래핑 + 기존 users 테이블 확장.

## Tradeoffs
- 장점: NextAuth 생태계 활용, 빠른 구현
- 단점: 버전 업데이트 추적 필요

## 채택된 feature
- [[features/user-auth]]
- [[features/onboarding]]

## 거부된 대안
- [[decisions/rejected-custom-jwt]]
- [[decisions/rejected-auth0]]
```

#### `entities/<slug>.md` — 도메인 엔티티

```markdown
---
type: entity
slug: user
size_estimate: "500명"
growth: "연 20%"
defined_in:
  - "prisma/schema.prisma"
  - "src/lib/types.ts"
---

# User

팀 멤버 엔티티. 모든 auth/payment 연산의 중심.

## 사용하는 feature
- [[features/user-auth]] — 생성, 로그인
- [[features/payment]] — 결제 연결
- [[features/onboarding]] — 프로필 초기화
```

#### `patterns/<slug>.md` — 참조 패턴 / 컨벤션

```markdown
---
type: pattern
slug: api-route-convention
reference_file: "src/app/api/users/route.ts"
tags: [convention, api]
---

# API Route Convention

Next.js App Router의 route handler는 항상 다음 구조를 따른다:
1. Zod schema 검증 (입력)
2. 비즈니스 로직 호출
3. 응답 포매팅

## 이 패턴을 쓰는 feature
- [[features/user-auth]]
- [[features/payment]]
```

#### `features-index.md` — 허브 파일 (자동 생성)

```markdown
# Features Index

자동 생성 파일. Plan 완료 시마다 갱신된다.

## Active
- [[features/user-auth]] — planned — #auth #onboarding
- [[features/payment]] — in-progress — #payment

## Completed
- [[features/onboarding]] — completed — #onboarding

## By Tag
- **#auth**: [[features/user-auth]], [[features/onboarding]]
- **#payment**: [[features/payment]]
```

---

## 8. 자동화 단계 (Do → Check → Iter → Report)

### 8.0 실행 모델

built의 자동화는 **interactive Plan** 과 **headless Run pipeline** 을 분리한다.

```
/built:plan <feature>             # orchestrator interactive
  └─ writes
     - .built/features/<feature>.md
     - .built/runtime/runs/<feature>/run-request.json
     - .built/runtime/runs/<feature>/state.json

/built:run <feature>              # orchestrator가 pipeline 실행
  └─ node scripts/run.js <feature>
      ├─ scripts/do.js
      │   └─ claude -p --output-format stream-json --verbose
      ├─ scripts/check.js
      │   └─ claude --bare -p --output-format json --json-schema <schema>
      ├─ scripts/iter.js
      │   └─ check-result.md.status == needs_changes 이면 Do + Check 반복
      └─ scripts/report.js
          └─ 기본 저비용 모델로 report.md 생성
```

핵심 원칙:
- Plan은 사용자와 핑퐁해야 하므로 **interactive**
- Run은 현재 `scripts/run.js` 가 **headless local orchestrator** 역할을 수행
- phase 상태의 SSOT는 `.built/runtime/runs/<feature>/state.json`
- 결과 문서는 현재 `.built/features/<feature>/` 아래에 저장
- `--worktree` 재사용 구조는 **Next Step**

### 8.1 shared runtime / handoff

shared runtime은 "worktree 자동 동기화" 장치가 아니다. 현재는 orchestrator와 phase 스크립트가 handoff와 상태를 공유하기 위해 사용한다.

예시:

```
.built/runtime/runs/user-auth/
├── run-request.json
├── state.json
├── last_error.json
└── notes.json
```

역할 분리:

| 경로 | 역할 |
|---|---|
| `.built/features/<feature>.md` | canonical Plan spec |
| `.built/runtime/runs/<feature>/run-request.json` | Plan -> Run handoff snapshot |
| `.built/runtime/runs/<feature>/state.json` | 현재 phase / status / heartbeat / pid |
| `.built/features/<feature>/progress.json` | 현재 Do/Report 진행 snapshot |
| `.built/features/<feature>/logs/*.jsonl` | 현재 Do/Report 이벤트 로그 |
| `.built/features/<feature>/*.md` | 현재 결과 문서 (`do/check/report`) |

### 8.2 Current MVP lifecycle

#### Run start

- `scripts/run.js` 가 `run-request.json` 을 읽고 비용 경고를 확인
- `.built/runtime/runs/<feature>/state.json` 을 `running` 으로 초기화
- 이후 `do.js -> check.js -> iter.js -> report.js` 를 순차 실행

#### Do

- `claude -p --output-format stream-json --verbose` 사용
- stdout 이벤트는 `.built/features/<feature>/logs/do.jsonl` 에 append
- `.built/features/<feature>/progress.json` 을 갱신
- 성공 시 `.built/features/<feature>/do-result.md` 생성

#### Check

- `claude --bare -p --output-format json --json-schema '<schema>'`
- 구조화 출력의 `structured_output` 으로 `.built/features/<feature>/check-result.md` 생성
- Iter 진입 판단은 `check-result.md` frontmatter `status: approved | needs_changes`

#### Iter

- `check-result.md` 가 `needs_changes` 면 진입
- 이전 산출물(`do-result.md`, `check-result.md`)과 handoff spec을 다시 주입
- MVP에서는 `--resume` 보다 **산출물 재주입**을 우선 사용
- 기본 상한은 3회

#### Report

- 기본 모델은 저비용 모델(`claude-haiku-4-5-20251001`)
- `do-result.md + check-result.md` 기반으로 report 생성
- `.built/features/<feature>/report.md` 저장

### 8.2-b Next Step lifecycle

- `/built:run` 시작 시 `claude --bare -p --worktree <feature-runner>` 를 1회 실행
- Do / Check / Iter / Report를 같은 execution worktree에서 재사용
- runtime 상태는 `.built/runtime/runs/<feature>/` 로 통합
- 결과 문서는 execution worktree 쪽으로 분리

### 8.3 상태 추적 — SSOT 계약

두 파일이 각자 다른 계층을 담당한다. 중복 없이 역할이 분리된다.

| 파일 | 경로 | 관리 주체 | 담당 필드 |
|---|---|---|---|
| `state.json` | `.built/runtime/runs/<feature>/` | `src/state.js` + `scripts/run.js` | phase, status, pid, attempt, last_error, heartbeat (orchestrator 생명주기) |
| `progress.json` | `.built/features/<feature>/` | `src/progress-writer.js` | session_id, turn, tool_calls, cost_usd, input_tokens, output_tokens, last_text, status (pipeline 실행 관찰) |

**규칙:**
- `state.js` / `run.js` 는 `state.json` 만 쓴다. `progress.json` 을 읽거나 쓰지 않는다.
- `progress-writer.js` 는 `progress.json` 만 쓴다. `state.json` 을 건드리지 않는다.
- `/built:status` (`scripts/status.js`) 는 두 파일을 단일 기준으로 읽는다:
  - `state.json` → `.built/runtime/runs/<feature>/state.json`
  - `progress.json` → `.built/features/<feature>/progress.json`

`state.json` 예시:

```json
{
  "feature": "user-auth",
  "phase": "check",
  "status": "running",
  "pid": 12345,
  "heartbeat": "2026-04-24T12:31:22Z",
  "startedAt": "2026-04-24T12:00:00Z",
  "updatedAt": "2026-04-24T12:31:22Z",
  "attempt": 2,
  "last_error": null
}
```

`progress.json` 예시:

```json
{
  "feature": "user-auth",
  "phase": "do",
  "session_id": "sess_abc",
  "turn": 5,
  "tool_calls": 12,
  "cost_usd": 0.042,
  "input_tokens": 8500,
  "output_tokens": 1200,
  "status": "completed",
  "started_at": "2026-04-24T12:00:00Z",
  "updated_at": "2026-04-24T12:31:22Z"
}
```

판단 규칙:
- `state.status == running` + heartbeat 최근: 정상 진행 중
- `state.status == failed`: 명시적 실패
- `check-result.md.status == needs_changes`: Iter 필요
- `report.md` 생성 + `state.status == completed`: 완료
- `progress.status == crashed`: pipeline 비정상 종료 (stdin 닫힘)

### 8.4 실패 처리

실패는 하나로 보지 않고 분류한다.

| failure_kind | 예시 | 대응 |
|---|---|---|
| `retryable` | schema parse 실패, timeout, 일시적 CLI 실패 | 같은 phase 재실행 또는 수동 재시도 |
| `needs_iteration` | spec mismatch, test failure, anti-goal 위반 | `check-result.md.status == needs_changes` 로 Iter 진입 |
| `non_converging` | 같은 실패 반복, pass rate 변화 없음 | 실패 종료 후 수동 개입 |
| `worker_crashed` | 프로세스 비정상 종료 | 현재는 pipeline 실패 처리, Next Step에서 worker 재기동 검토 |
| `needs_replan` | spec 자체가 모호하거나 범위 과다 | Run 중단 후 Plan 복귀 |

### 8.5 Phase 감지

MVP에서도 phase는 파일 존재보다 **runtime state** 를 우선 SSOT 로 둔다.

| 조건 | 현재 Phase |
|---|---|
| `run-request.json` 과 `state.json` 없음 | not_started |
| `state.status == "planned"` | planned |
| `state.status == "running"` + `phase == "do"` | do |
| `state.status == "running"` + `phase == "check"` | check |
| `state.status == "running"` + `phase == "iter"` | iter |
| `state.status == "running"` + `phase == "report"` | report |
| `state.status == "aborted"` | aborted |
| `state.status == "failed"` | failed |
| `state.status == "completed"` | done |

---

## 9. Hooks 시스템

### 설계 원칙

`before_do`, `after_do` 등은 **built이 정의하는 가상 훅 포인트**. 공식 Claude Code hook 이벤트(PreToolUse, SessionStart 등)와 다름. pipeline-runner가 파이프라인 실행 중에 직접 발화.

### 두 가지 타입 지원

**타입 자동 감지**: `run` 필드 있으면 command, `skill` 필드 있으면 skill.

`.built/hooks.json` (팀 공통, git):

```json
{
  "pipeline": {
    "before_do": [
      { "run": "./.built/scripts/validate-spec.sh", "halt_on_fail": true, "timeout": 10000 }
    ],
    "after_do": [
      { "run": "npm run format", "halt_on_fail": false },
      { "run": "npm run lint -- --fix", "halt_on_fail": false },
      { "run": "npm run typecheck", "halt_on_fail": true, "timeout": 60000 },
      { "run": "npm test", "halt_on_fail": true },
      { "run": "npm run build", "halt_on_fail": true, "timeout": 180000 },
      {
        "skill": "built-security-audit",
        "condition": "feature.touches_auth == true",
        "halt_on_fail": true,
        "model": "sonnet"
      }
    ],
    "after_check": [
      { "run": "npm run coverage", "capture_output": true, "condition": "check.status == 'approved'" },
      { "run": "npm run test:e2e", "timeout": 600000, "condition": "check.status == 'approved'" }
    ],
    "after_report": [
      { "run": "git add . && git status", "capture_output": true },
      { "skill": "built-pr-draft", "halt_on_fail": false }
    ]
  }
}
```

`.built/hooks.local.json` (개인, gitignore):

```json
{
  "pipeline": {
    "after_do": [
      { "run": "terminal-notifier -title \"built\" -message \"$BUILT_FEATURE done\"" },
      { "run": "echo \"$(date): $BUILT_FEATURE do completed\" >> ~/built-log.txt" }
    ],
    "after_report": [
      {
        "skill": "built-gin-slack-notify",
        "env": { "SLACK_CHANNEL": "#gin-dev-log" }
      }
    ]
  }
}
```

> 훅 명령 예시는 `npm run` 기준. 팀 프로젝트가 pnpm/yarn을 쓰면 각자 `hooks.json`에 해당 명령으로 기재. built 자체는 패키지 매니저를 강제하지 않음.

### 타입 비교

| 타입 | 용도 | 비용 | 속도 |
|---|---|---|---|
| `command` | 린트, 타입체크, 테스트 (80%) | 거의 없음 | 수 ms |
| `skill` | 보안 감사, 아키텍처 검토, PR 초안 (20%) | 토큰 + 시간 | 수 초~수십 초 |

### 스키마 검증 (Node 표준 라이브러리, deps 0)

외부 패키지(Zod 등) 없이 수동 타입 가드로 검증. bkit의 패턴을 따름. 검증 대상이 단순해 수동 체크로 충분하며, 한 파일에 인라인 가능.

```javascript
// scripts/hooks-parser.js
'use strict';

const MODEL_VALUES = new Set(['opus', 'sonnet', 'haiku']);
const EFFORT_VALUES = new Set(['low', 'medium', 'high']);

function fail(path, msg) {
  throw new Error(`hooks config: ${path} — ${msg}`);
}

function validateCommandHook(h, path) {
  if (typeof h.run !== 'string' || h.run.length === 0) fail(path, "'run' must be non-empty string");
  if ('halt_on_fail' in h && typeof h.halt_on_fail !== 'boolean') fail(path, "'halt_on_fail' must be boolean");
  if ('condition' in h && typeof h.condition !== 'string') fail(path, "'condition' must be string");
  if ('timeout' in h && (typeof h.timeout !== 'number' || h.timeout <= 0)) fail(path, "'timeout' must be positive number");
  if ('capture_output' in h && typeof h.capture_output !== 'boolean') fail(path, "'capture_output' must be boolean");
  if ('expect_exit_code' in h && !Number.isInteger(h.expect_exit_code)) fail(path, "'expect_exit_code' must be integer");
  return { type: 'command', halt_on_fail: false, capture_output: false, expect_exit_code: 0, ...h };
}

function validateSkillHook(h, path) {
  if (typeof h.skill !== 'string' || h.skill.length === 0) fail(path, "'skill' must be non-empty string");
  if ('halt_on_fail' in h && typeof h.halt_on_fail !== 'boolean') fail(path, "'halt_on_fail' must be boolean");
  if ('model' in h && !MODEL_VALUES.has(h.model)) fail(path, `'model' must be one of ${[...MODEL_VALUES]}`);
  if ('effort' in h && !EFFORT_VALUES.has(h.effort)) fail(path, `'effort' must be one of ${[...EFFORT_VALUES]}`);
  return { type: 'skill', halt_on_fail: false, ...h };
}

function validateHook(h, path) {
  if (h === null || typeof h !== 'object') fail(path, 'must be object');
  const hasRun = 'run' in h;
  const hasSkill = 'skill' in h;
  if (hasRun && hasSkill) fail(path, "cannot have both 'run' and 'skill'");
  if (!hasRun && !hasSkill) fail(path, "must have either 'run' or 'skill'");
  return hasRun ? validateCommandHook(h, path) : validateSkillHook(h, path);
}

module.exports = { validateHook };
```

- **의존성 0**: `z.object`, `z.union` 대신 `typeof`, `in`, `Set.has` 로 동등한 검증 수행
- **에러 메시지**: 수동으로 구성하지만 경로(`path`)를 포함해 Zod 수준의 진단 가능
- **타입 힌트 필요 시**: JSDoc `@typedef` 사용. `.d.ts`는 플러그인 측에서만 제공하고, 프로젝트는 영향받지 않음

### 환경변수 (명령 실행 시 주입)

- `BUILT_HOOK_POINT` — 현재 훅 포인트 (before_do 등)
- `BUILT_FEATURE` — feature 이름
- `BUILT_PREVIOUS_RESULT` — 이전 phase 결과 파일 경로 (Markdown 또는 JSON)
- `BUILT_WORKTREE` — Next Step에서 execution worktree 절대 경로로 사용
- `BUILT_PROJECT_ROOT` — 메인 프로젝트 경로

### 병합 규칙

- local은 team에 **추가만**, 덮어쓰지 않음
- 같은 hookpoint 배열은 concat (team 먼저, local 뒤)
- 각 hook에 `source: 'team' | 'local'` 메타데이터

### MVP에서는 유예

훅 시스템은 복잡도 폭탄. **v1.0 팀 확장 단계에서 도입**.

---

## 10. Git 추적 정책

### 추적 (git)

**Markdown 산출물 (knowledge layer)**:
- `features/*.md` ★ feature spec, 팀 공유 자산
- `decisions/*.md` ★ 재사용되는 아키텍처 결정
- `entities/*.md` ★ 도메인 엔티티
- `patterns/*.md` ★ 참조 패턴 / 컨벤션
- `features-index.md` ★ 허브 (자동 생성)
- `context.md` — 프로젝트 전역 컨텍스트
- `runs/<name>/plan-summary.md` (선택)
- `.built/features/<name>/do-result.md`, `check-result.md`, `report.md` (sanitize 후)

**기계 전용 상태**:
- `.claude/settings.json`
- `.built/config.json`, `hooks.json`
- `.worktreeinclude`

**shared runtime 상태 (gitignore)**:
- `.built/runtime/locks/`
- `.built/runtime/registry.json`
- `.built/runtime/runs/<name>/run-request.json`
- `.built/runtime/runs/<name>/state.json`, `last_error.json`
- `.built/features/<name>/progress.json`, `logs/`

### Gitignore

```gitignore
# Claude Code 공식
.claude/worktrees/
.claude/settings.local.json

# built 개인 설정
.built/config.local.json
.built/hooks.local.json

# built shared runtime
.built/runtime/

# built 실행 산출물 (runs 하위)
.built/runs/*/plan-draft.md

# 문서 도구 개인 설정 예시 (Obsidian으로 여는 경우)
.built/.obsidian/workspace.json
.built/.obsidian/workspace-mobile.json
```

> `.built/.obsidian/` 아래 설정은 Obsidian을 함께 쓰는 팀에서만 선택적으로 추적한다. built 자체는 Tolaria 기준 Markdown/Git 문서층을 전제로 하며, 특정 앱 설정 파일을 핵심 계약으로 보지 않는다.

### Sanitize 로직

추적되는 **Markdown 및 JSON** 산출물에서 커밋 전 자동 마스킹:
- `session_id` (선택적)
- 사용자 홈 경로 (`/Users/gin/...` → `~/...`)
- API 키 패턴 (`sk-ant-*`, `ghp_*`)
- 환경변수 (`SAFE_KEYS` 외 전부 제거)

Markdown의 경우 frontmatter와 본문 양쪽에 동일 규칙 적용. pre-commit hook으로 안전망.

---

## 11. 에디터 성능 대응

**문제**: worktree 여러 개와 runtime 로그가 쌓이면 에디터가 버벅일 수 있다. VSCode/JetBrains 공통 이슈다.

### 기본 해결 (권장)

`.vscode/settings.json` (팀 공유, git 추적):

```json
{
  "files.watcherExclude": {
    "**/.claude/worktrees/**": true,
    "**/node_modules/**": true,
    "**/.built/features/**/logs/**": true,
    "**/.built/runtime/**": true
  },
  "search.exclude": {
    "**/.claude/worktrees": true
  },
  "files.exclude": {
    "**/.claude/worktrees": true
  },
  "typescript.tsserver.maxTsServerMemory": 4096,
  "git.scanRepositories": []
}
```

프로젝트가 TypeScript 레포인 경우 `tsconfig.json`도 조정:
```json
{
  "exclude": ["node_modules", "dist", ".claude/worktrees"]
}
```

> 이 설정은 **대상 프로젝트가 TS인 경우**에만 해당. built 자체는 TS/bun을 쓰지 않으므로, Python/Go 프로젝트 등은 각자 해당 도구 설정으로 worktree 경로를 제외하면 됨.

### 성능 이슈 지속 시

Next Step에서 worktree를 연결하면, 개인이 `config.local.json`에서 worktree 위치를 override할 수 있다:
```json
{ "worktree_location": "sibling" }
```
(프로젝트 바깥 sibling 디렉토리에 worktree 생성)

---

## 12. .worktreeinclude 동작

**공식 기능**. `.gitignore` 문법 사용. 현재 MVP 핵심 경로에서는 직접 사용하지 않지만, Next Step에서 `--worktree` 기반 실행을 연결할 때 중요해진다.

### 동작 규칙

- 패턴에 매칭 **AND** `.gitignore` 처리된 파일만 복사 (AND 조건)
- 이미 tracked된 파일은 중복 복사 안 함
- `claude -p --worktree` 로 생성한 execution worktree, subagent worktree, desktop 병렬 세션에 적용
- WorktreeCreate hook 커스텀 시 무시됨

### 예시

```
# .worktreeinclude
.env.example.local
config/local.example.json
```

### node_modules 주의

`node_modules`는 `.worktreeinclude` 에 **넣지 말기 권장**:
- 크기가 수 GB — 복사 시간만 1분+
- worktree마다 독립 의존성이 더 안전

Next Step 기본 경로는 worker가 execution worktree 생성 후 별도 setup step에서 패키지 설치를 수행하는 것이다. `WorktreeCreate` hook은 **기본 생성 동작을 완전히 대체**해야 할 때만 선택적으로 사용한다.

### 보안

`.worktreeinclude`에 포함된 파일은 worktree 안에서 Claude가 읽을 수 있다. 따라서 기본 정책은 **민감 파일 deny-by-default**:

- `.env`, `.env.local`, `.env.production`, 인증서, private key는 기본 템플릿에 넣지 않는다.
- 필요한 경우 `.worktreeinclude.local` 같은 개인 파일이 아니라, 팀 리뷰를 거친 `.worktreeinclude`에 예외를 명시한다.
- 실제 secret 대신 테스트 토큰/로컬 전용 값/예시 파일(`*.example.*`)을 우선 사용한다.
- sanitize는 마지막 안전망일 뿐이다. secret이 포함된 파일을 Claude 세션에 노출하지 않는 것을 1차 방어선으로 둔다.

---

## 13. 플러그인 / 마켓플레이스

### MVP: Plugin-first

MVP부터 플러그인 구조로 시작한다. 이유는 명령어 네임스페이스(`/built:*`)와 팀 배포 방식을 초기부터 고정해 문서/사용법/스킬 경로가 갈라지지 않게 하기 위함이다.

로컬 개발 중에는 `claude --plugin-dir <plugin-dir>`로 플러그인을 직접 로드해 검증하고, 팀 배포 시점에는 marketplace에 올린다. 대상 프로젝트에는 `.built/`와 `.claude/` 설정만 생성한다.

### 마켓플레이스 전환

**공식 마켓플레이스 구조**:

```
built-marketplace/                   # 별도 레포
├── .claude-plugin/
│   └── marketplace.json             # 카탈로그
└── plugins/
    ├── built/                       # 메인 플러그인
    │   ├── .claude-plugin/plugin.json
    │   └── skills/
    │       ├── init/SKILL.md        # /built:init
    │       ├── plan/SKILL.md        # /built:plan
    │       └── ...
    ├── built-quality/               # 품질 훅 번들
    │   └── skills/
    │       ├── lint-fix/
    │       └── type-check/
    ├── built-security/              # 보안 훅
    └── built-notify/                # 알림
```

### marketplace.json

```json
{
  "name": "built-tools",
  "owner": {
    "name": "Ride Engineering",
    "email": "eng@ride.example"
  },
  "metadata": {
    "description": "built — PDCA workflow orchestration for Ride",
    "pluginRoot": "./plugins"
  },
  "plugins": [
    {
      "name": "built",
      "source": "built",
      "description": "Core PDCA orchestration (init, plan, run, status)"
    },
    {
      "name": "built-quality",
      "source": "built-quality",
      "description": "Quality hooks (lint, type-check, coverage)"
    }
  ]
}
```

### 팀 배포 설정

`.claude/settings.json` (프로젝트 내, git 추적):
```json
{
  "extraKnownMarketplaces": {
    "built-tools": {
      "source": {
        "source": "github",
        "repo": "ride/built-marketplace"
      }
    }
  },
  "enabledPlugins": {
    "built@built-tools": true
  }
}
```

이 설정은 팀원이 프로젝트를 trust할 때 marketplace 설치 프롬프트를 띄우고, 설치된 뒤에는 `enabledPlugins`에 적힌 plugin을 기본 활성화하는 용도다. 즉 "자동 배포"라기보다 **팀 공통 marketplace 발견 + 기본 활성화 설정**에 가깝다.

### 명령어 네임스페이스

플러그인 이름이 `built` 이므로:
- `/built:init` (plugin:skill)
- `/built:plan`
- `/built:run`
- `/built:status`

모델 변형용 명령은 skill 이름으로 구분:
- `/built:run` (기본, config 따름)
- `/built:run-opus`
- `/built:run-sonnet`

### plugin 구현 메모

- built 본체는 plugin `plugins/built/` 아래에 둔다.
- MCP 서버를 쓸 경우 plugin 루트의 `.mcp.json`이 `scripts/mcp/...`를 참조하도록 연결한다. `servers/`라는 별도 최상위 디렉토리를 Claude Code plugin 규약으로 가정하지 않는다.
- plugin hooks를 쓸 경우 공식 위치는 `hooks/hooks.json`이다. built의 `.built/hooks.json`은 이와 별개인 built 고유 파이프라인 설정 파일이다.

---

## 14. 위험 요소 및 대응

### Critical (필수 선결)

**C1. Plan -> Run handoff 계약 지속 검증 필요**

- interactive Plan 종료 후 `run-request.json` 만으로 후속 phase가 충분한 컨텍스트를 재구성할 수 있는지 지속 검증 필요
- spec 원본(`features/<name>.md`)과 handoff snapshot의 일관성 규칙이 필요
- 현재 MVP는 기본 구현 완료. 이후 회귀 없이 유지되는지 검증 필요

**C2. Plan 대화 세션 종료 지점 관리**

- AskUserQuestion 다중 호출 → 언제 "확정" 선언?
- 대안: `runs/<name>/plan-draft.md`에 snapshot 저장 + 명시적 `/built:plan-confirm`
- 현재 `/built:plan` 구현이 있으므로 운영 중 UX 개선 대상으로 관리

**C3. 상태 파일 저장 위치 일관성 보강 필요**

- 현재 `state.json` 은 runtime, `progress/log/result` 는 feature 디렉토리에 분산되어 있음
- `/built:status`, 비용 집계, 장애 분석 기준으로 어떤 파일이 SSOT 인지 더 명확히 정리할 필요가 있음
- 장기적으로 runtime 하위로 통합하거나 명시적 분리를 설계해야 함

**C4. Iter 루프 수렴 보장 약함**

- 같은 에러 2회 감지 우회 가능
- 정량 지표 (test_pass_rate, coverage) 변화 없으면 중단
- 예산 상한 (`max_cost_usd`)

### Major (설계 조정)

- **M1**: Worktree 생성 타이밍 — Plan이 아니라 Run 시작 시 execution worktree 생성
- **M2**: feature-spec 추상화 수준 — 너무 추상적이면 Do 일관성 깨짐
- **M3**: progress-writer 신뢰성 — 별도 프로세스 + atomic write
- **M4**: 멀티 피처 동시성 — 초기엔 `max_parallel: 1`
- **M5**: 훅 시스템 복잡도 — MVP 유예

### Minor (운영)

- m1: SDK vs CLI 혼재
- m2: settings.json 충돌 관리
- m3: worktree 연결 후 `/built:status` 호출 위치 정의
- m4: 절대 경로 하드코딩
- m5: Sanitize 놓치는 케이스

### 비용 위험

Plan (Opus) + Do (Opus) + Check (Opus) + Iter 3회 (Opus) = feature 당 $5~15.
첫 달 10개 feature 돌리면 $100+ 예상.

**대응**:
- `total_cost_usd > $1.0` 이면 진행 전 사용자 확인
- worker별 비용 누적을 runtime state에 기록

---

## 15. 구현 로드맵

### Week 1: PoC + 초기 구현

**PoC 4개 (실측)**:
- **PoC-1**: Plan 산출물 -> `run-request.json` handoff만으로 worker가 실행 가능한지
- **PoC-2**: stream-json 이벤트 실측 + shared runtime(progress/state/logs) 갱신
- **PoC-3**: AskUserQuestion 다중 연속 호출 ★ Plan 구현 결정적
- **PoC-4**: `claude -p --worktree` worker 생성 후 same worktree 재사용이 가능한지

**현재 완료된 범위**:
- `/built:init` — 프로젝트 bootstrap
- `/built:plan <feature>` (interactive Plan + handoff 저장)
- `/built:run <feature>` (headless pipeline 실행)
- `.built/runtime/runs/<name>/run-request.json`, `state.json`
- `.built/features/<name>/do-result.md`, `check-result.md`, `report.md`, `progress.json`

**당시 빠졌던 것 중 현재 채워진 것**: 자동 Check/Iter/Report 연결, 백그라운드 실행, 모델 변형 일부

**성공 기준**: user-auth 하나 완주, feature-spec 따라 파일 생성, do-result 저장

### Week 2: 자동화 연결

- internal Check / Iter / Report phase 연결
- Iter 루프 (max 3, 정량 지표 기반 수렴 감지)
- `/built:run` 연결 (Do → Check → Iter)
- 백그라운드 + 폴링
- Notification hook

**성공 기준**: 5개 feature 자동 완주

### Week 3: 안정화

- `/built:status`, `/built:resume`, `/built:abort`
- Sanitize + pre-commit hook
- Report 자동 생성
- 수동 스키마 검증 (Node 표준 라이브러리, deps 0)
- 비용 경고 (`total_cost_usd > $1.0` 사용자 확인)

**성공 기준**: 20개 feature + 실패 복구 시나리오

### Week 4+: 팀 확장 / Next Step

- `claude -p --worktree` 기반 execution worktree 재사용
- 멀티 피처 (lock, registry)
- 모델 변형 (`/built:run-opus`)
- 훅 시스템 도입

### 이후: 마켓플레이스 배포

- 로컬 `--plugin-dir` 검증 → 마켓플레이스 등록
- 팀 `extraKnownMarketplaces` 설정
- CODEOWNERS로 hooks.json 보호

### YAGNI (지금은 하지 않음)

- 웹 대시보드
- 프로필 시스템
- Agent Teams 연동
- `/built:plan-quick` 같은 단축 모드

---

## 16. 다음 액션

### 즉시 착수

**Current MVP 기준 즉시 액션**:
- runtime state와 feature-local progress/log/result 저장 위치를 하나의 계약으로 정리
- `/built:status`, 비용 집계, 실패 분석이 같은 기준을 보도록 정렬
- README와 설계 문서 간 불일치가 다시 생기지 않도록 기준 문서 지정

**Next Step 액션**:
- interactive Plan 종료 후 `run-request.json` handoff만으로 worktree worker가 충분한지 재검증
- `claude -p --worktree` worker가 handoff만으로 Do를 시작하는지 검증
- Check / Iter / Report가 same execution worktree를 재사용하는지 검증

### 현재 기준 핵심 파일

**프로젝트 측** (Tolaria/Markdown knowledge layer 초기 구조):
1. `.built/context.md` — 프로젝트 전역 컨텍스트 (Plan의 mandatory preparation에서 읽음)
2. `.built/features-index.md` — 허브 파일 (초기엔 빈 상태, 첫 Plan 이후 자동 생성)
3. `.built/features/`, `.built/decisions/`, `.built/entities/`, `.built/patterns/`, `.built/runs/` — 빈 디렉토리 스캐폴드
4. `.built/runtime/` — `locks/`, `registry.json`, `runs/`

**플러그인 측**:
5. `plugins/built/skills/init/SKILL.md`
6. `plugins/built/skills/plan/SKILL.md` — interactive Plan + handoff 저장 흐름
7. `plugins/built/skills/run/SKILL.md`
8. `plugins/built/scripts/progress-writer.js` — stream-json 줄 단위 파서, feature-local `logs/<phase>.jsonl` append + `progress.json` atomic write (deps 0)
9. `plugins/built/scripts/result-to-markdown.js` — result 이벤트 → `do/report-result.md` 변환 (deps 0)
10. `plugins/built/scripts/pipeline-runner.js` — Claude subprocess 실행 / Do/Check/Iter/Report 지원 (deps 0)
11. `plugins/built/scripts/update-index.js` — `features-index.md` 자동 생성 (frontmatter 파싱, deps 0)
12. `plugins/built/scripts/frontmatter.js` — YAML 호환 최소 subset 파서 (들여쓰기 기반, deps 0)

> 로컬 개발 중에는 플러그인 레포를 marketplace에 올리기 전 `claude --plugin-dir ./plugins/built`로 직접 로드해 검증한다.

### 결정 보류 항목

- 비용 상한 기본값 (초기 $1.0 제안, 팀 쓰면서 조정)
- max_iterations 기본값 (초기 3 제안)
- Architecture Phase 옵션 제시 축을 Claude가 어떻게 동적으로 결정할지

---

## 부록 A. 팀 온보딩 가이드 (예시)

> **built**: Ride 엔지니어링팀의 AI 개발 워크플로우 도구
>
> feature를 "built 상태까지 자동으로 끌고 가는" 방식.
> Plan/Design만 사람이 짚고, 나머지는 Claude가 자동 실행.
>
> **시작**: `/built:init <feature-name>`
>
> **전체 플로우**:
> 1. `/built:init user-auth` — 작업 폴더 준비
> 2. `/built:plan user-auth` — 대화로 계획 확정
> 3. `/built:run user-auth` — 자동 실행 (Do → Check → Iter → Report)
> 4. `/built:status` — 진행 확인
>
> **도움말**: `#engineering-tools` 채널

---

## 부록 B. 참고 자료

- [Claude Code Plugins 공식 문서](https://code.claude.com/docs/en/plugins)
- [Claude Code Plugin Marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [Claude Code Common Workflows](https://code.claude.com/docs/en/common-workflows)
- [impeccable craft SKILL](https://impeccable.style/skills/impeccable)
- [impeccable shape SKILL](https://impeccable.style/skills/shape)

---

**끝.**

이 문서는 built 현재 구현과 next-step 아키텍처를 함께 정리한 설계 문서다.
현재 운영 기준은 구현 코드와 README이며, 여기의 worktree 관련 내용은 별도 표기가 없으면 Next Step 제안으로 해석한다.
