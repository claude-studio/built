# built

> PDCA 오케스트레이션 도구. Plan/Design은 사람과 interactive하게, Do -> Check -> Iter -> Report는 headless Claude 서브프로세스로 자동 실행.

> 🔁 이 프로젝트는 [Multica](https://multica.ai/)로 자동화되어 있습니다.
> 일일 방향성 점검(`kg/reviews/`)이 스케줄로 돌며 북극성 목표 대비
> drift를 스스로 감지합니다.

Claude Code 위에서 feature를 "built 상태"까지 밀어 올리기 위한 워크플로우 레이어입니다.  
현재 기준 아키텍처는 다음과 같습니다.

- **Plan**: 오케스트레이터 interactive 세션에서 진행
- **Run**: `/built:run`이 `node scripts/run.js`를 통해 파이프라인을 오케스트레이션
- **Plan -> Run handoff**: `.built/runtime/runs/<feature>/run-request.json`에 저장
- **Do / Check / Iter / Report**: 각 phase가 headless Claude 서브프로세스를 호출
- **결과 문서**: `.built/features/<feature>/`에 저장
- **문서층**: Tolaria 기준 Markdown/Git knowledge layer
- **실행 상태**: `.built/runtime/runs/<feature>/state.json` 중심으로 추적

---

## 특징

- **사람은 Plan/Design까지만**: 의도, 범위, anti-goals, 설계 방향을 interactive하게 확정
- **Run은 완전 자동화**: 로컬 오케스트레이터가 Do -> Check -> Iter -> Report 수행
- **파일이 계약이다**: orchestrator와 worker는 Markdown/JSON 파일로 handoff
- **feature별 산출물 분리**: feature마다 결과 문서와 runtime 상태가 분리됨
- **상태는 중앙화**: orchestrator는 `.built/runtime/` 상태 파일을 기준으로 진행 상황을 판단
- **Tolaria 친화적**: `.built/` 문서층은 Markdown + frontmatter + wikilink 기반으로 Tolaria에서 바로 다루기 좋음
- **Obsidian도 호환**: Tolaria 전용 포맷이 아니라 Markdown/Git 문서층이므로 Obsidian에서도 열 수 있음
- **프로젝트 영향 최소화**: built 본체는 플러그인/스크립트 쪽에 있고, 프로젝트에는 `.built/`, `.claude/`만 생성

## 요구사항

- **시스템**: Node.js 20+ 권장
- **Claude Code**: plugin/skill 실행 가능한 환경
- **프로젝트**: 언어/프레임워크 무관

---

## 빠른 시작

```bash
# 1. 프로젝트 bootstrap (최초 1회)
/built:init

# 2. feature 계획
/built:plan user-auth

# 3. headless worker 실행
/built:run user-auth

# 4. 상태 확인
/built:status user-auth
```

---

## 명령어

### 핵심

| 명령어                      | 용도                                                    |
| --------------------------- | ------------------------------------------------------- |
| `/built:init`               | 프로젝트 bootstrap, `.built/`/`.claude/` 기본 구조 준비 |
| `/built:plan <feature>`     | orchestrator interactive Plan/Design                    |
| `/built:run <feature>`      | headless 파이프라인 실행 (`node scripts/run.js`)        |
| `/built:status [feature]`   | 진행 상황 조회                                          |
| `/built:list`               | 활성 feature 목록                                       |
| `/built:abort <feature>`    | worker 중단                                             |
| `/built:resume <feature>`   | 재개 또는 재시도                                        |
| `/built:sanitize <feature>` | 산출물 민감 정보 마스킹                                 |

### 모델 변형

| 명령어                        | 용도            |
| ----------------------------- | --------------- |
| `/built:run-opus <feature>`   | Opus로 실행     |
| `/built:run-sonnet <feature>` | Sonnet으로 실행 |

### 유틸리티

| 명령어            | 용도           |
| ----------------- | -------------- |
| `/built:validate` | 설정 파일 검증 |

> `Do`, `Check`, `Iter`, `Report`는 내부 phase입니다. 현재 MVP 표면 명령으로 `/built:do`, `/built:check`, `/built:hooks-inspect`를 노출하지 않습니다.

---

## 동작 방식

```text
Project bootstrap
  └─ /built:init

Plan (interactive orchestrator)
  └─ /built:plan <feature>
       ├─ Prior Art 탐색
       ├─ Intent / Scope / Anti-goals 정리
       ├─ Architecture Direction 선택
       ├─ Build Plan 작성
       ├─ Spec Review
       └─ Save
            ├─ .built/features/<feature>.md
            └─ .built/runtime/runs/<feature>/run-request.json

Run (local orchestrator + headless Claude subprocesses)
  └─ /built:run <feature>
       └─ node scripts/run.js <feature>
            ├─ scripts/do.js
            │    └─ claude -p --output-format stream-json --verbose
            ├─ scripts/check.js
            │    └─ claude --bare -p --output-format json --json-schema <schema>
            ├─ scripts/iter.js
            │    └─ check-result.md.status == needs_changes 이면 Do + Check 반복
            └─ scripts/report.js
                 └─ 저비용 모델로 report.md 생성
```

핵심 구분:

- **Plan은 interactive**라서 `claude -p`로 하지 않음
- **Run은 headless**지만 현재는 `scripts/run.js`가 phase별 Claude 프로세스를 순차 호출
- **상태 파일**은 `.built/runtime/runs/<feature>/state.json`이 기준
- **결과 문서**는 `.built/features/<feature>/` 아래에 쌓임

### Next Step

기존 문서에 있던 `claude -p --worktree` 기반 방향은 장기적으로 더 깔끔한 구조입니다. 현재 MVP가 안정화되면 다음 순서로 확장하는 것이 좋습니다.

- `/built:run` 시작 시 `claude --bare -p --worktree <feature-runner>`를 1회 실행해 execution worktree 확보
- Do / Check / Iter / Report를 같은 worktree 컨텍스트에서 재사용
- runtime 상태는 `.built/runtime/runs/<feature>/`로 통합하고, 결과 문서는 execution worktree 쪽으로 분리
- `.worktreeinclude`, sanitize, worktree lifecycle을 핵심 경로에 연결

### stream-json -> Markdown 변환

현재 Do 단계는 `stream-json` 이벤트를 받아 progress/log와 결과 문서를 분리 저장합니다.

```text
claude -p --output-format stream-json --verbose
  ├─ .built/features/<feature>/logs/do.jsonl
  ├─ .built/features/<feature>/progress.json
  └─ .built/features/<feature>/do-result.md
```

Check 단계는 구조화 출력이 목적이므로 다음 계약을 사용합니다.

```text
claude --bare -p --output-format json --json-schema <schema>
  ├─ structured_output
  ├─ .built/runtime/runs/<feature>/state.json
  └─ .built/features/<feature>/check-result.md
```

Report 단계는 저비용 모델을 기본값으로 사용해 최종 Markdown 보고서를 생성합니다.

```text
claude -p --output-format stream-json --verbose --model claude-haiku-4-5-20251001
  ├─ .built/features/<feature>/logs/report.jsonl
  └─ .built/features/<feature>/report.md
```

### Phase 감지

오케스트레이터는 worktree 내부 파일 변경을 직접 감시하지 않습니다.  
현재는 `scripts/run.js`가 phase 전환마다 `.built/runtime/runs/<feature>/state.json`을 갱신하고, 필요 시 progress 파일을 함께 읽습니다.

| 조건                                                   | 현재 상태   |
| ------------------------------------------------------ | ----------- |
| `run-request.json`과 `state.json` 없음                 | not_started |
| `state.json.status == "planned"`                       | planned     |
| `state.json.status == "running"` + `phase == "do"`     | do          |
| `state.json.status == "running"` + `phase == "check"`  | check       |
| `state.json.status == "running"` + `phase == "iter"`   | iter        |
| `state.json.status == "running"` + `phase == "report"` | report      |
| `state.json.status == "failed"`                        | failed      |
| `state.json.status == "aborted"`                       | aborted     |
| `state.json.status == "completed"` + `report.md` 존재  | completed   |

Iter 진입 조건은 `state.json.status == "needs_iteration"`이 아니라 `.built/features/<feature>/check-result.md` frontmatter의 `status: needs_changes` 입니다.

---

## 디렉토리 구조

built는 현재 두 개의 핵심 공간과 하나의 예약 공간으로 나뉩니다.

1. **플러그인 소스 측**: skill, script, MCP, marketplace 소스
2. **프로젝트 원본 레포 측**: canonical spec / knowledge docs / runtime / 결과 문서
3. **execution worktree 측**: 향후 `--worktree` 기반 확장을 위한 예약 공간

### 플러그인 소스 측

```text
built-marketplace/
├── .claude-plugin/
│   └── marketplace.json
└── plugins/
    └── built/
        ├── .claude-plugin/plugin.json
        ├── skills/
        ├── hooks/
        ├── scripts/
        ├── src/
        ├── kg/                   # built 플러그인 자체의 knowledge graph
        │   ├── goals/            # 북극성 목표 (거의 불변)
        │   ├── reviews/          # 일일 방향성 점검 (시계열)
        │   ├── issues/           # 이슈 이력
        │   └── decisions/        # 아키텍처 결정
        └── settings.json
```

`kg/` 는 built 자체의 개발 방향이 북극성에서 벗어나지 않는지를 점검하는 자기 점검 레이어입니다. 사용자 프로젝트의 `.built/` 와는 완전히 독립이고 서로 읽지 않습니다.

### 프로젝트 측

```text
프로젝트 루트/
├── .claude/
│   ├── settings.json
│   ├── settings.local.json
│   └── worktrees/             # 현재는 예약 공간
│
├── .built/
│   ├── context.md
│   ├── features-index.md
│   ├── config.json
│   ├── config.local.json
│   ├── hooks.json
│   ├── hooks.local.json
│   ├── features/
│   ├── decisions/
│   ├── entities/
│   ├── patterns/
│   ├── runs/
│   │   └── <feature>/
│   │       ├── plan-draft.md
│   │       ├── plan-summary.md
│   │       └── notes.md
│   ├── features/
│   │   ├── <feature>.md
│   │   └── <feature>/
│   │       ├── do-result.md
│   │       ├── check-result.md
│   │       ├── report.md
│   │       ├── progress.json
│   │       └── logs/
│   └── runtime/
│       ├── registry.json
│       ├── locks/
│       └── runs/
│           └── <feature>/
│               ├── run-request.json
│               ├── state.json
│               └── last_error.json
└── .worktreeinclude
```

### execution worktree 측 (Next Step)

```text
프로젝트/.claude/worktrees/<feature-runner>/
└── .built/
    └── runs/
        └── <feature>/
            ├── do-result.md
            ├── check-result.md
            └── report.md
```

중요:

- `.built/runtime/`은 **shared handoff + 상태 저장소**
- `.built/features/*.md`는 **canonical Plan 산출물**
- `.built/features/<feature>/`는 **현재 MVP 실행 결과 문서 + progress/log 저장 위치**
- execution worktree의 `.built/runs/*` 구조는 **Next Step 목표 구조**

---

## feature-spec.md

Plan 단계의 핵심 산출물은 `.built/features/<feature>.md` 입니다.  
frontmatter에는 구조화 메타데이터를, 본문에는 서술과 링크를 담습니다.

```markdown
---
feature: user-auth
version: 1
status: planned
tags: [auth, onboarding]
primary_user_action: "첫 로그인 후 5분 이내 팀 레포 clone + 필수 도구 설치 완료"
success_criteria:
  - "첫날 퇴근 전 첫 PR open"
includes: ["OAuth2", "팀 repo 권한 부여"]
excludes: ["SSO", "2FA 강제"]
anti_goals: ["복잡한 권한 체계", "관리자 개입 필요"]
architecture_decision: "[[decisions/nextauth-v5-wrapping]]"
build_files: ["src/lib/auth.ts", "src/app/login/page.tsx"]
---

# user-auth

## Intent

...

## Architecture

...

## Build Plan

...
```

연관 문서:

- `decisions/*.md`
- `entities/*.md`
- `patterns/*.md`
- `features-index.md`

Tolaria 기준으로 보면 이 레이어는 그대로 KG/문서층으로 사용할 수 있습니다.

---

## Hooks

Hooks는 built 파이프라인 확장 포인트지만, **현재 MVP에서는 후순위**입니다.

예상 위치:

- 팀 공통: `.built/hooks.json`
- 개인 오버라이드: `.built/hooks.local.json`

예상 용도:

- `after_do`: lint, typecheck, test
- `after_check`: 추가 검증
- `after_report`: 알림, 후처리

현재 기준:

- 훅 시스템 자체는 설계에 포함
- `/built:hooks-inspect` 같은 공개 명령은 아직 MVP 표면에서 제외
- WorktreeCreate hook을 핵심 경로 전제로 두지 않음

---

## 공식 Claude Code 기능 활용

전부 직접 구현하지 않고, 공식 기능 위에 built 레이어를 얹습니다.

| 기능                          | 활용처                         |
| ----------------------------- | ------------------------------ |
| `claude -p`                   | Do / Report 단계 headless 실행 |
| `claude --bare -p`            | Check 단계 구조화 실행         |
| `.worktreeinclude`            | gitignored 로컬 파일 자동 복사 |
| `--json-schema`               | Check 구조화 출력 강제         |
| `--output-format stream-json` | Do 진행 이벤트 수집            |
| Plugin marketplace 구조       | 팀 배포                        |
| Hooks / Notification          | 확장 포인트                    |

현재 핵심 경로 기준으로 보면:

- Plan은 `EnterWorktree` 중심이 아님
- Run은 `scripts/run.js`가 local orchestrator 역할을 수행
- `--resume`은 MVP 핵심 계약이 아니라 후순위
- `--worktree`는 현재 핵심 경로가 아니라 Next Step 후보

---

## Git 추적 정책

### 추적 (git)

- `.built/features/*.md`
- `.built/decisions/*.md`
- `.built/entities/*.md`
- `.built/patterns/*.md`
- `.built/features-index.md`
- `.built/context.md`
- `.built/features/<feature>/do-result.md`, `check-result.md`, `report.md` 중 sanitize 가능한 결과물
- `.claude/settings.json`
- `.built/config.json`
- `.built/hooks.json`
- `.worktreeinclude`

### gitignore

```gitignore
.claude/worktrees/
.claude/settings.local.json

.built/config.local.json
.built/hooks.local.json

.built/runtime/
.built/runs/*/plan-draft.md
```

### sanitize

커밋 대상 산출물에서는 다음을 마스킹하거나 제거합니다.

- 사용자 홈 경로
- 민감한 토큰/API 키 패턴
- 불필요한 세션 식별자
- 런타임 임시 메타데이터

---

## .worktreeinclude 보안 기본값

`.worktreeinclude`는 현재 핵심 경로는 아니지만, 향후 execution worktree 기반 확장 시 바로 영향이 생기는 파일입니다.  
기본 정책은 **deny-by-default** 입니다.

- `.env`, private key, 인증서 기본 제외
- 가능하면 `*.example` 또는 테스트 값 사용
- 필요한 예외만 팀 리뷰 후 추가

---

## 에디터 성능

worktree와 runtime 로그가 많아지면 에디터가 느려질 수 있습니다.

```json
{
  "files.watcherExclude": {
    "**/.claude/worktrees/**": true,
    "**/.built/runtime/**": true
  },
  "search.exclude": {
    "**/.claude/worktrees": true
  },
  "files.exclude": {
    "**/.claude/worktrees": true
  }
}
```

---

## 비용 관리

비용은 feature 복잡도와 iteration 수에 따라 달라집니다.  
특히 `Plan + Do + Check + Iter`가 모두 강한 모델을 쓰면 빠르게 커질 수 있습니다.

기본 원칙:

- iteration 상한 설정
- 실패 분류 후 무한 재시도 금지
- `needs_replan`, `needs_human`, `worker_crashed`를 구분
- built 자체 옵션으로 dry-run 성격의 검증 모드를 둘 수는 있지만, 이는 Claude CLI 기본 플래그가 아니라 built 레이어 옵션이어야 함

---

## 로드맵

### 1단계: bootstrap + Plan

- `/built:init`
- `/built:plan`
- `feature-spec.md` 스키마 확정
- `features-index.md` 갱신

### 2단계: headless Run pipeline

- `/built:run`
- `run-request.json`
- `state.json`, `progress.json`, `logs/`
- Do / Check / Iter / Report 연결

### 3단계: orchestration 안정화

- `/built:status`, `/built:list`, `/built:abort`, `/built:resume`
- registry / locks / heartbeat
- failure classification / retry policy

### 이후

- `claude -p --worktree` 기반 execution worktree 재사용
- hooks 실행 엔진
- sanitize 자동화
- marketplace 배포
- Tolaria 친화적인 KG 탐색/연결 강화
- built 플러그인 자체의 방향성 점검 KG (`kg/goals/`, `kg/reviews/`) — `/built:check` 시 북극성 목표 대비 drift 감지

---

## 플러그인 / 마켓플레이스

MVP부터 plugin-first 구조를 전제로 합니다.

- 로컬 개발: `claude --plugin-dir <path>`
- 팀 배포: marketplace
- 프로젝트에는 built 본체를 설치하지 않고 `.built/`, `.claude/`만 생성

예시:

```json
{
  "extraKnownMarketplaces": {
    "built-tools": {
      "source": { "source": "github", "repo": "ride/built-marketplace" }
    }
  },
  "enabledPlugins": {
    "built@built-tools": true
  }
}
```

---

## 위험 요소

### Critical

- Plan -> Run handoff 계약이 충분한지 검증 필요
- iteration 수렴 실패 판단 기준 정교화 필요

### Major

- progress/log/state 저장 위치 일관화 필요
- `claude -p --worktree` worker 재사용 흐름 실증 필요
- runtime polling / process event 조합 설계
- sanitize 범위와 결과물 버전 관리 정책
- hooks 도입 시점과 공개 표면 정리

---

## 참고 자료

- [BUILT-DESIGN.md](./BUILT-DESIGN.md)
- [Claude Code Plugins](https://code.claude.com/docs/en/plugins)
- [Claude Code Plugin Marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [Claude Code Common Workflows](https://code.claude.com/docs/en/common-workflows)
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks)
- [Tolaria](https://tolaria.md)

---

## 상태

**현재 상태: MVP 구현 완료.**  
`/built:init`, `/built:plan`, `/built:run`, `/built:status`, `/built:list`, `/built:abort`, `/built:resume`과 Do / Check / Iter / Report 파이프라인이 동작합니다. 현재 실행 구조는 local orchestrator 기반이며, `claude -p --worktree` 재사용 구조는 Next Step 입니다.
