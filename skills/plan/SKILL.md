---
name: plan
description: Feature Plan & Design - 6단계 인터뷰 플로우로 feature spec을 생성한다
user-invocable: true
allowed-tools:
  - AskUserQuestion
  - Read
  - Write
  - Bash
---

# /built:plan — Feature Plan & Design

Feature 이름을 인자로 받아 6단계 인터뷰 플로우(Phase 0~5)를 진행한다.
산출물: `.built/features/<name>.md`, `.built/runtime/runs/<name>/run-request.json`, `.built/runtime/runs/<name>/state.json`, `.built/features-index.md` 갱신.

## 인자

`$ARGUMENTS` = feature 이름 (예: `user-auth`, `payment-flow`)

feature 이름이 없으면 AskUserQuestion으로 물어본다.

---

## 사전 확인

시작 전 다음을 확인한다:

> `scripts/plan-draft.js`, `scripts/plan-save.js`, `src/state.js`, `src/update-index.js`는 target project가 아니라 built plugin/repo 안에 있다. 대상 프로젝트 루트 cwd는 유지하고 `BUILT_PLUGIN_DIR`로 plugin/repo 절대 경로를 분리한다. Claude Bash tool, zsh, bash, interactive shell 모두에서 `BASH_SOURCE[0]`로 skill 파일 위치를 추정하지 않는다.

```bash
: "${BUILT_PLUGIN_DIR:?BUILT_PLUGIN_DIR must point to the installed built plugin/repo path}"
SCRIPT_DIR="$(cd "$BUILT_PLUGIN_DIR/scripts" && pwd -P)"
SRC_DIR="$(cd "$BUILT_PLUGIN_DIR/src" && pwd -P)"
```

`plan-draft.js`는 target project root를 기준으로 `.built/runs/<FEATURE>/plan-draft.md`를 읽고 쓴다. 기본 target project root는 현재 작업 디렉토리다. plugin script를 절대 경로로 require하는 환경에서도 반드시 target project cwd에서 실행하고, cwd를 보장할 수 없으면 `BUILT_PROJECT_ROOT` 또는 `{ projectRoot }` 옵션을 명시한다. `node -e`에서 argv로 root를 넘길 때는 Node 옵션과 script argv를 구분하기 위해 `--` separator를 사용한다.

1. **feature 이름 확정**: `$ARGUMENTS`를 `FEATURE` 변수로 저장한다. 공백이나 대문자가 있으면 kebab-case로 정규화한다 (예: `User Auth` → `user-auth`).

2. **`.built/context.md` 존재 여부**: 없으면 다음과 같이 알린다.
   > "`.built/context.md`가 없습니다. `/built:init`을 먼저 실행하거나, 프로젝트 컨텍스트를 `.built/context.md`에 작성해주세요."
   그리고 중단한다.

3. **plan-draft.md 확인**: `.built/runs/<FEATURE>/plan-draft.md`가 존재하면 이전 세션의 중간 저장 파일이 있다는 의미다. AskUserQuestion으로 묻는다:
   - "이전에 시작한 `<FEATURE>` plan 세션의 중간 저장 파일이 있습니다. 이어서 진행하시겠습니까?"
   - options: ["이어서 진행", "처음부터 다시 (draft 삭제)"]
   - **"이어서 진행" 선택 시**: draft를 읽어 `INTENT_PURPOSE`, `INTENT_SCOPE`, `INTENT_DATA`, `INTENT_CONSTRAINTS`, `ARCH_DECISION`, `BUILD_PLAN`을 복원한다. frontmatter의 `phase_completed` 값을 확인해 그 다음 Phase부터 재개한다 (예: `phase_completed: 2`이면 Phase 3부터 시작).
   - **"처음부터 다시" 선택 시**: target project cwd에서 `node -e "require(process.env.BUILT_PLUGIN_DIR + '/scripts/plan-draft.js').remove('<FEATURE>')"` 를 실행해 draft를 삭제하고 Phase 0부터 시작한다.

4. **중복 feature 체크**: `.built/features/<FEATURE>.md`가 이미 존재하면 AskUserQuestion으로 묻는다:
   - "이 feature는 이미 spec이 있습니다. 덮어쓰거나 이어서 작업할 수 있습니다. 어떻게 할까요?"
   - options: ["덮어쓰기 (처음부터 다시)", "취소"]

---

## Phase 0: Prior Art (Obsidian vault 탐색)

**사용자에게 알리지 않고 자동 실행.**

1. `.built/features-index.md`가 있으면 읽는다. 없으면 건너뛴다.
2. feature 이름·키워드와 관련된 `[[features/*]]` 링크를 선별한다.
3. 선별된 `.built/features/*.md` 파일을 읽는다 (최대 5개).
4. 각 파일 내 `[[decisions/*]]`, `[[entities/*]]`, `[[patterns/*]]` wikilink를 추출한다.
5. 해당 `.built/decisions/*.md`, `.built/entities/*.md`, `.built/patterns/*.md` 파일을 읽는다.
6. 탐색 결과를 내부적으로 `PRIOR_ART` 컨텍스트로 보관한다. 이후 Phase 2, 3에서 활용.

---

## Phase 1: Intent (의도 캡처)

**AskUserQuestion을 사용해 한 번에 하나씩 질문한다.**

### 1-1. Purpose & Context

```
질문: "이 feature의 목적을 구체적으로 설명해주세요.
누가 (어떤 페르소나가), 왜 이 기능을 필요로 하나요?
그리고 이 기능이 성공했다고 판단할 수 있는 기준은 무엇인가요?"
```

- "모두를 위해" / "편의를 위해" 같은 추상적인 답변은 받아들이지 않는다. 구체적인 페르소나와 행동 기반 성공 기준을 강제한다.
- 응답을 `INTENT_PURPOSE`로 저장한다.

### 1-2. Scope & Anti-Goals

```
질문: "이 feature에 포함되는 것과 포함되지 않는 것을 명확히 해주세요.
특히 Anti-goal — 절대로 이 feature가 되어서는 안 되는 것이 무엇인지 최소 1개 이상 말해주세요."
```

- Anti-goal이 없거나 "없음"이면 받아들이지 않고 재질문한다: "Anti-goal은 설계 실패를 막는 안전장치입니다. 하나라도 꼭 정해주세요."
- 응답을 `INTENT_SCOPE`로 저장한다.

### 1-3. Content & Data

```
질문: "이 feature가 다루는 핵심 데이터 엔티티는 무엇인가요?
(예: User, Order, Product 등)
예상 데이터 규모나 주목할 엣지 케이스가 있으면 함께 알려주세요."
```

- 응답을 `INTENT_DATA`로 저장한다.

### 1-4. Constraints

```
질문: "기술적 제약조건과 일정을 알려주세요.
(예: 사용 중인 프레임워크/언어, 마감일, 접근성 요구사항 등)"
```

- 응답을 `INTENT_CONSTRAINTS`로 저장한다.

### 1-5. Draft 저장

Phase 1의 모든 응답 수집 후 target project cwd에서 다음 코드를 실행해 중간 저장한다:

```bash
node -e "
const d = require(process.env.BUILT_PLUGIN_DIR + '/scripts/plan-draft.js');
d.write('<FEATURE>', d.buildContent({
  feature: '<FEATURE>',
  phase: 1,
  intentPurpose: \`<INTENT_PURPOSE 내용>\`,
  intentScope: \`<INTENT_SCOPE 내용>\`,
  intentData: \`<INTENT_DATA 내용>\`,
  intentConstraints: \`<INTENT_CONSTRAINTS 내용>\`,
}));
"
```

`<FEATURE>` 및 각 필드는 실제 수집한 값으로 치환한다.

---

## Phase 2: Architecture Direction

**PRIOR_ART의 decisions를 참고해 2~3개 접근법을 제안한다.**

1. Phase 1 응답을 분석해 기술 스택과 요구사항을 파악한다.
2. 2~3개 접근법을 정리한다. 각 접근법에 대해:
   - 이름과 핵심 아이디어
   - 장점 / 단점 (trade-off)
   - PRIOR_ART에서 이전에 채택된 결정이 있으면 "이전에 X 방식을 채택했습니다 — 이번에도 같은 방향?" 식으로 명시한다.
3. AskUserQuestion으로 묻는다:
   ```
   질문: "[접근법 요약 제시 후] 어떤 방향으로 가시겠습니까? 이유도 함께 말씀해주세요."
   options: [접근법 A 이름, 접근법 B 이름, 접근법 C 이름 (있는 경우), "다른 방향 (직접 입력)"]
   ```
4. 선택 결과와 이유를 `ARCH_DECISION`으로 저장한다.

5. target project cwd에서 Draft를 갱신한다:

```bash
node -e "
const d = require(process.env.BUILT_PLUGIN_DIR + '/scripts/plan-draft.js');
d.write('<FEATURE>', d.buildContent({
  feature: '<FEATURE>',
  phase: 2,
  intentPurpose: \`<INTENT_PURPOSE>\`,
  intentScope: \`<INTENT_SCOPE>\`,
  intentData: \`<INTENT_DATA>\`,
  intentConstraints: \`<INTENT_CONSTRAINTS>\`,
  archDecision: \`<ARCH_DECISION>\`,
}));
"
```

---

## Phase 3: Build Plan 생성

**자동 생성. 사용자 질문 없음.**

다음 순서를 엄격히 따른다: **Schema → Core → Structure → States → Integration → Polish**

각 step마다 작성:
- `what`: 이 step에서 무엇을 만드는가
- `files`: 영향받는 파일 목록 (구체적 경로)
- `phase`: schema / core / structure / states / integration / polish

PRIOR_ART에서 `[[patterns/*]]`를 발견했으면 해당 패턴을 Reference Patterns로 포함한다.
`[[entities/*]]`와 중복되는 엔티티가 있으면 "재정의 대신 확장" 제안을 추가한다.

Test strategy도 포함한다: 단위 테스트 대상, 통합 테스트 시나리오.

결과를 `BUILD_PLAN`으로 저장한다.

target project cwd에서 Draft를 갱신한다:

```bash
node -e "
const d = require(process.env.BUILT_PLUGIN_DIR + '/scripts/plan-draft.js');
d.write('<FEATURE>', d.buildContent({
  feature: '<FEATURE>',
  phase: 3,
  intentPurpose: \`<INTENT_PURPOSE>\`,
  intentScope: \`<INTENT_SCOPE>\`,
  intentData: \`<INTENT_DATA>\`,
  intentConstraints: \`<INTENT_CONSTRAINTS>\`,
  archDecision: \`<ARCH_DECISION>\`,
  buildPlan: \`<BUILD_PLAN>\`,
}));
"
```

---

## Phase 4: Spec Review

**전체 spec을 요약해 제시하고 확인을 받는다.**

1. 지금까지 수집한 내용으로 spec 전체를 마크다운으로 정리해 보여준다.
   - Intent (목적, 스코프, 데이터, 제약)
   - Architecture (선택한 방향, 이유, 채택하지 않은 대안)
   - Build Plan (step별 요약)
   - Risks (자동 도출: Anti-goal 위반 가능성, 기술 부채, 스코프 크리프 징후)

2. AskUserQuestion으로 묻는다:
   ```
   질문: "Spec을 확인해주세요. 수정이 필요한 섹션이 있으면 선택해주세요."
   options: ["모두 승인 — 저장 진행", "Intent 수정", "Architecture 수정", "Build Plan 수정", "처음부터 다시"]
   ```

3. "모두 승인" 외의 선택이면 해당 Phase로 돌아가 재진행한다.
   - "처음부터 다시" 선택 시 Phase 1부터 재시작한다.

4. 수정이 완료되거나 "모두 승인" 전 target project cwd에서 draft를 최종 갱신한다:

```bash
node -e "
const d = require(process.env.BUILT_PLUGIN_DIR + '/scripts/plan-draft.js');
d.write('<FEATURE>', d.buildContent({
  feature: '<FEATURE>',
  phase: 4,
  intentPurpose: \`<INTENT_PURPOSE>\`,
  intentScope: \`<INTENT_SCOPE>\`,
  intentData: \`<INTENT_DATA>\`,
  intentConstraints: \`<INTENT_CONSTRAINTS>\`,
  archDecision: \`<ARCH_DECISION>\`,
  buildPlan: \`<BUILD_PLAN>\`,
}));
"
```

---

## Phase 5: Save

**사용자 승인 후 자동 저장.**

### 5-1. feature-spec.md 생성

`.built/features/<FEATURE>.md`를 다음 형식으로 저장한다:

```markdown
---
feature: <FEATURE>
version: 1
created_at: <YYYY-MM-DD>
confirmed_by_user: true
status: planned
tags: [<Phase 1에서 추출한 태그>]
primary_user_action: "<페르소나의 핵심 행동>"
persona:
  role: "<역할>"
  context: "<상황>"
  frequency: "<사용 빈도>"
  state_of_mind: "<상태>"
success_criteria:
  - "<기준 1>"
  - "<기준 2>"
includes:
  - "<포함 항목>"
excludes:
  - "<제외 항목>"
anti_goals:
  - "<Anti-goal>"
architecture_decision: "[[decisions/<결정-파일명>]]"
build_files:
  - "<파일 경로>"
constraints:
  technical:
    - "<기술 제약>"
  timeline: "<일정>"
  accessibility: "<접근성 요구사항 또는 null>"
---

# <FEATURE>

## Intent

<목적 서술>

- **사용자**: [[entities/<entity-name>]]
- **주요 액션**: <primary_user_action>

## Scope

### Includes
<포함 항목>

### Excludes
<제외 항목>

### Anti-Goals
<Anti-goal 목록>

## Content & Data

### Entities
<엔티티 목록, [[entities/*]] wikilink 포함>

### Edge Cases
<엣지 케이스>

## Architecture

채택: [[decisions/<결정-파일명>]]

### 선택하지 않은 대안
<대안 목록>

### Tradeoffs
<trade-off 요약>

## Build Plan

순서: Schema → Core → Structure → States → Integration → Polish

<step별 목록>

### Reference Patterns
<[[patterns/*]] wikilink 목록>

### Test Strategy
<테스트 전략>

## Risks
<Risk 목록>
```

### 5-2. decisions / entities / patterns 신규 생성

저장된 `.built/features/<FEATURE>.md`에서 wikilink를 파싱해 파일이 없는 항목만 신규 생성한다.
프로젝트 루트에서 다음을 실행한다:

```bash
node "$SCRIPT_DIR/plan-save.js" .built/features/<FEATURE>.md .built
```

`<FEATURE>`는 실제 feature 이름으로 치환한다.

- `[[decisions/<slug>]]` 중 `.built/decisions/<slug>.md`가 없는 항목 → 신규 생성
- `[[entities/<slug>]]` 중 `.built/entities/<slug>.md`가 없는 항목 → 신규 생성
- `[[patterns/<slug>]]` 중 `.built/patterns/<slug>.md`가 없는 항목 → 신규 생성
- 이미 파일이 있으면 skip (멱등성 보장)

생성되는 파일은 §7 스키마 frontmatter(`type`, `slug`, 관계 필드) + 본문 초안으로 구성된다.

### 5-3. run-request.json 및 state.json 생성

프로젝트 루트에서 다음 Node.js 코드를 실행한다:

```javascript
const path = require('path');
const state = require(process.env.BUILT_PLUGIN_DIR + '/src/state.js');
const projectRoot = process.cwd();
const runDir = path.join(projectRoot, '.built', 'runtime', 'runs', '<FEATURE>');

state.initRunRequest(runDir, {
  featureId: '<FEATURE>',
  planPath: path.join(projectRoot, '.built', 'features', '<FEATURE>.md'),
  model: 'claude-opus-4-5',
});

state.initState(runDir, '<FEATURE>');
```

`<FEATURE>`는 실제 feature 이름으로 치환한다.
`state.initRunRequest`는 대상 프로젝트의 `.built/config.json.default_run_profile.providers`를 읽어
`run-request.json`의 `providers` ProviderSpec snapshot으로 정규화한다.

### 5-4. features-index.md 갱신

프로젝트 루트에서 `node "$SRC_DIR/update-index.js"`를 실행한다.

### 5-5. plan-draft.md 삭제

모든 저장이 완료된 후 target project cwd에서 중간 저장 파일을 삭제한다:

```bash
node -e "require(process.env.BUILT_PLUGIN_DIR + '/scripts/plan-draft.js').remove('<FEATURE>')"
```

### 5-6. 완료 안내

```
Plan 완료!

저장된 파일:
- .built/features/<FEATURE>.md
- .built/runtime/runs/<FEATURE>/run-request.json
- .built/runtime/runs/<FEATURE>/state.json
- .built/features-index.md (갱신)

다음 단계: /built:run <FEATURE>
```

---

## 핵심 원칙

1. **한 번에 하나씩 질문** — AskUserQuestion은 Phase당 1~2회씩, 순차적으로 호출한다.
2. **"standard/normal" 답변 거부** — 추상적인 답변은 재질문으로 구체화를 강제한다.
3. **Anti-goals 필수** — 없으면 받아들이지 않는다.
4. **Intent에서 솔루션 금지** — Phase 1은 이해 단계, 솔루션 제안은 Phase 2부터.
5. **Build order 엄격** — Schema → Core → Structure → States → Integration → Polish.
6. **PRIOR_ART 활용** — Phase 0에서 읽은 맥락을 Phase 2, 3에서 반드시 참조한다.
