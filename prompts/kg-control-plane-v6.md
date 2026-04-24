목표는 새로운 철학 문서를 쓰는 것이 아니라,
현재 `built`가 이미 가지고 있는 KG(knowledge layer) 사용 방식을 더 강하게 만드는 것이다.

### 가장 중요한 제약
- **현재 코드가 SSOT다.** 현재 구현을 무시하고 이상적인 새 시스템을 처음부터 설계하지 마라.
- **구현되지 않은 구조를 현재 구조인 것처럼 설명하지 마라.**
- 현재 MVP를 유지한 채, KG가 실제 실행 제어에 더 큰 영향을 주도록 강화해야 한다.
- 필요하면 **Current MVP**와 **Next Step**을 분리해서 제안하라.
- **`kg/*` KG와 `.built/*` knowledge layer를 혼동하지 마라.** 둘은 다른 레이어다. 통합해서 설명하고 싶다면 현재 구조가 아니라 **Next Step**으로 분리해라.

---

### 0. 선행 조건 — 지시문 먼저 검증하라

이 지시문은 실제 코드를 일부만 확인하고 쓰였다. 본론에 들어가기 전에 먼저:

1. 아래 파일들을 먼저 읽어라.
   - `kg/_schema.md`, `kg/_index.md`
   - `kg/issues/`, `kg/decisions/` 중 대표 파일 1~2개씩
   - `kg/agents/`, `kg/workflows/` — **스키마나 인덱스상 언급은 있으나 실제 엔트리는 없을 수 있다.** 정확히:
     - `_schema.md`에는 `issue / decision / workflow` 엔트리만 정의되어 있고, `agent`는 별도 엔트리 정의 없이 `issue`의 frontmatter 필드로만 등장.
     - `_index.md`에는 `agents/` 폴더가 나열됨.
     - 즉 agents는 폴더 언급만 있고 스키마 정의 자체가 비대칭이다.
     - **workflow는 스키마에는 정의되어 있으나, 현재 리포에 실제 엔트리가 있는지는 직접 `kg/workflows/`를 확인한 뒤 판단하라.** 비어있다고 단정하지 말고, 비어있다면 그 사실을 진단 대상으로 올려라.
     - agents도 같은 방식으로 실제 엔트리 유무를 확인한 뒤 기술하라.
     - **"디렉토리가 아예 없는 경우"와 "디렉토리는 있으나 엔트리가 비어 있는 경우"를 구분해서 기록하라.** 둘은 의미가 다르다 — 전자는 스키마 선언과 리포 상태의 괴리(정의조차 안 된 상태), 후자는 스키마-인덱스 선언 대비 실사용 공백이다.
   - `skills/plan/SKILL.md`, `skills/do/SKILL.md`, `skills/check/SKILL.md`, `skills/iter/SKILL.md`, `skills/report/SKILL.md`, `skills/run/SKILL.md`
   - `scripts/do.js`, `scripts/check.js`, `scripts/iter.js`, `scripts/report.js`, `scripts/run.js`
   - `src/pipeline-runner.js`, `src/frontmatter.js`, `src/state.js`, `src/progress-writer.js`, `src/result-to-markdown.js`, `src/update-index.js`
   - `README.md`, `BUILT-DESIGN.md`
2. **이 지시문에서 현재 코드와 어긋난 전제가 있으면 먼저 지적한 뒤 본론으로 가라.**
3. 현재 스키마에 없는 개념(예: feature/entity/pattern)을 **있는 것처럼 쓰지 마라.** 쓰고 싶으면 "Next Step으로 스키마 확장을 제안"으로 분리해라.
4. **`kg/*`(지식 그래프 영역)와 `.built/*`(runtime/artifact knowledge layer)를 같은 것처럼 묶어 설명하지 마라.** 둘의 통합이 바람직하다고 판단되면 그건 Next Step 제안이다.

### 0-1. 용어 정리 — 헷갈리지 말 것

- **"approved"** 는 `check-result.md`의 **판정 상태**다. (check가 내리는 판단)
- **"completed"** 는 `state.json.status == completed` 로 표현되는 **최종 종료 상태**다. (run 라이프사이클 종결)
- 이 둘은 다른 레이어다. "approved된 작업은 KG 갱신까지 이어져야 한다"를 볼 때,
  - check가 approved를 찍는 시점과
  - state가 completed로 닫히는 시점을
  **분리해서 다뤄라.** KG 갱신이 둘 중 어느 쪽에 훅으로 걸려야 하는지, 혹은 둘 다여야 하는지를 제안에 명시하라.

### 0-2. 경로 책임 분리 — 진단 대상에 반드시 포함할 것

현재 코드에서 경로 책임이 두 갈래로 나뉘어 있고, 그 사이에 불일치가 있다:

- **Runtime 경로**: `state.json`, `run-request.json`, 그 외 실행 제어용 상태
- **Artifact 경로**: `do-result.md`, `check-result.md`, `report.md`, **`progress.json`** (주의: `.md`가 아니라 `.json`이다. atomic write snapshot), `logs/`

이 둘이 현재 어느 모듈(`src/state.js` vs `src/progress-writer.js`/`src/result-to-markdown.js` 등)에서 관리되는지, **경계가 어디서 흐려지는지**를 진단 항목에 반드시 포함시켜라. KG 강화 제안이 이 경로 계약과 충돌하면 안 된다.

**특히 `progress.json`에 대해:** 이름만 맞추는 것으로 끝내지 말고, **실제 저장 위치**(예: `.built/runtime/runs/<feature>/progress.json` 인지, `.built/features/<feature>/progress.json` 인지, 혹은 그 외 경로인지)와 그것을 **읽는 모듈들(`scripts/run.js`, `scripts/status.js`, `scripts/do.js` 등)이 참조하는 경로가 서로 일치하는지** 직접 검증하라. 어긋나면 그 불일치 자체가 진단 대상이다. `run-request.json`에 대해서도 동일하게, 쓰는 쪽(`src/state.js` 등)과 읽는 쪽(`scripts/run.js`, `scripts/check.js`, `scripts/iter.js`, `scripts/report.js`, `scripts/do.js` 등)의 경로가 일치하는지 확인하라.

### 0-3. `kg/*`와 `.built/*`의 구분

- `kg/` = 프로젝트의 **지식 그래프**(issue/decision/workflow, + index/schema). 장기 축적.
- `.built/` = **runtime & artifact knowledge layer**(runs, features, state/progress/logs/result 등). 실행 단위 산출물.
- 이 지시문이 말하는 "KG"는 기본적으로 `kg/`를 가리킨다. `.built/` 쪽 데이터가 `kg/`로 흘러들어가는 경로를 제안하는 건 좋지만, 둘을 **하나의 레이어로 묶어서 리디자인하지 마라.** 그 방향은 Next Step.

### 0-4. "run이 KG를 읽는다"의 해석 범위

"모든 `run`은 KG를 읽고 시작해야 한다"는 목표는 **`scripts/run.js` 단독**이 아니라, **run이 호출하는 각 phase(plan / do / check / report)의 실제 입력 계약**까지 포함해서 해석하라. 즉:

- `run.js` 진입점에서 KG를 한 번 읽는 것만으로는 이 목표를 충족하지 않는다.
- 각 phase가 claude 서브세션을 띄울 때 **해당 phase의 프롬프트/입력 계약**(예: `skills/{plan,do,check,report}/SKILL.md`, `pipeline-runner.js`가 phase별로 넘기는 prompt/resultOutputPath, 각 `scripts/*.js`가 구성하는 입력)이 **어떤 KG 노드를 어떤 형태로 참조하는지**가 핵심이다.
- 따라서 "KG가 phase 통과 조건에 영향을 준다"는 요구는 **phase별 입력 계약 단위로** 진단·설계되어야 한다.

---

### 내가 원하는 방향

1. KG는 단순 참고 문서가 아니라 **control plane**이어야 한다.
2. 모든 `run`은 KG를 읽고 시작해야 한다. (0-4 해석 적용 — phase별 입력 계약 단위로)
3. `check`는 품질 검토뿐 아니라 **KG consistency 검사**까지 해야 한다.
4. approved(check 판정) 이후 completed(state 종료) 사이의 어느 시점에 **KG 갱신**이 기본 흐름으로 들어가야 한다. 정확히 어디에 거는 게 맞는지는 0-1, 0-2 확인 후 제안하라.
5. 병렬 실행을 하게 되더라도 task 분해와 결과 수렴이 KG 기준으로 일어나야 한다.
6. 이 플러그인을 쓰는 프로젝트는 시간이 갈수록 더 일관된 decision / workflow / (스키마에 추가된다면) agent 체계를 갖게 되어야 한다.

---

### 해야 할 일

**1. 현재 KG 사용 방식 진단**
- `kg/*`가 지금 실제로 어디에서 읽히고 있는지 (어느 skill/script/src에서)
- 어디서는 단순 참고자료 수준에 머무는지
- 어떤 phase(plan / do / check / iter / report / run)에서 KG 영향력이 약한지 — **phase별 입력 계약 단위로** 판단할 것 (0-4 참조)
- **스키마·인덱스 언급은 있지만 실제 엔트리가 없는 KG 타입**이 있는지 (workflow, agent 각각 실측으로 확인; 디렉토리 부재 vs 디렉토리 존재+엔트리 공백 구분)
- `_schema.md`와 `_index.md` 사이의 비대칭(예: agents는 인덱스에만 있고 스키마 엔트리 정의 없음) 자체도 진단 대상
- **runtime 경로와 artifact 경로 책임 분리가 깨지는 지점**이 있는지 (특히 `progress.json`, `run-request.json`의 쓰기/읽기 경로 일치 여부 실측)
- **`kg/*`와 `.built/*` 사이에 암묵적으로 흐려진 경계**가 있다면 그 지점도 지적

**2. KG 강화 포인트 도출**
- Plan 단계(skill)에서 `kg/*`를 더 강하게 강제할 방법
- Do 단계에서 spec + 연결된 KG 노드(issue/decision/workflow)를 **입력 계약**으로 고정하는 방법
- Check 단계에서 KG inconsistency를 검출하는 방법
  - frontmatter 필수 필드 누락
  - `_index.md`와 실제 파일 불일치
  - `context_issue` 같은 관계 필드의 dangling 참조
  - 스키마에 선언된 타입이 장기간 비어있는 상태 (workflow가 실제로 비어 있다면 포함)
  - 스키마와 인덱스 사이 엔트리 정의 비대칭
- approved(check) / completed(state) 중 어느 시점에 KG update 훅을 걸지
- drift detection 가능 지점 정리

**3. 현재 구조를 유지한 개선안**
- 큰 리라이트 말고 **현재 구조에서 바로 넣을 수 있는 변경 우선**
- 어떤 파일에 어떤 책임을 추가할지 구체적으로 (skill 프롬프트 수정인지, `scripts/*.js` 수정인지, `src/*` 유틸 추가인지 명시)
- runtime/artifact 경로 계약과 충돌하지 않게
- `kg/*`와 `.built/*`를 뒤섞지 말 것. 뒤섞어야 한다고 판단되면 Next Step으로 분리
- README / BUILT-DESIGN도 현재 구현 기준으로 맞출 수 있게

**4. 실제 수정은 가장 작고 안전한 한 덩이만**
- 분석·제안은 필수. 실제 코드 수정은 **한 PR에 들어갈 수 있는 범위**로만.
- 우선순위: `scripts/check.js` 또는 `src/` 유틸에서 **KG consistency 검사 하나**를 실제로 추가하는 수준.
- 더 큰 변경(스키마 확장, agent 엔트리 정의 추가, 새 frontmatter 필드, plan/do 입력 계약 변경, KG update 훅 위치 변경, `kg/*`-`.built/*` 통합 등)은 **Next Step**으로 분리해서 제안만.
- 현재 리포는 BUI-## 단위로 이슈를 끊어 쓰는 스타일이다 — 이 톤에 맞춰라.

**5. 병렬 실행 대비 관점**
- 지금 당장 병렬 실행을 구현하지 않아도 된다.
- 대신 나중에 병렬 Claude 세션을 붙였을 때 **KG가 task scope와 merge 기준이 되도록**,
  현재 구조에 어떤 계약(frontmatter 필드, lockable 노드, scope 선언 등)을 먼저 심어야 하는지 정리하라.

---

### 응답 형식

0. **Corrections to the prompt** — 지시문에서 실제 코드와 어긋난 전제가 있었다면 먼저 밝혀라.
1. **Current KG Usage** — 현재 실제로 어디에서 어떻게 쓰이는지, 짧게.
   - runtime 경로(`state.json` / `run-request.json`)와 artifact 경로(`do-result.md` / `check-result.md` / `report.md` / `progress.json` / `logs/`) 기준으로 KG가 어디에 걸리는지 함께 표시.
   - `kg/*`와 `.built/*`를 구분해서 표시.
   - **run 진입점 vs 각 phase(plan/do/check/report) 입력 계약** 단위로 구분해서 표시.
2. **Problems** — KG 영향력이 약한 지점. 스키마-선언-되었지만-실측상-비어있는-타입(디렉토리 부재/공백 구분), 스키마-인덱스 비대칭, 경로 책임 불일치(특히 `progress.json`·`run-request.json` 경로 쓰기/읽기 일치 여부), `kg/*`-`.built/*` 경계 흐림, phase별 입력 계약에서 KG 참조가 없는 지점 포함.
3. **Recommended Changes** — Current MVP에 들어갈 것 / Next Step으로 분리할 것.
   - KG update 훅을 approved 시점에 걸지, completed 시점에 걸지, 둘 다인지 명시.
4. **Implementation Plan** — 파일 단위로.
5. **Changed Files** — 실제로 수정한 것만. (수정 없으면 생략.)
6. **README / BUILT-DESIGN 반영 문구** — 현재 구현 기준으로 고쳐야 할 부분이 있으면.

---

### 추가 제약
- 현재 구현을 깨는 과도한 재설계는 하지 마라.
- worktree 기반 미래 구조가 더 좋더라도, 현재 MVP 안에서 KG 영향력을 높이는 쪽을 우선하라.
- 가능한 한 "KG를 읽는다" 수준이 아니라 **"KG가 phase의 통과 조건에 영향을 준다"** 수준으로 끌어올려라.
- "run이 KG를 읽는다"는 `run.js` 단독이 아니라 **각 phase의 입력 계약**까지 포함해서 해석하라 (0-4).
- 현재 스키마에 없는 개념을 쓰려면 반드시 "Next Step: 스키마 확장 제안"으로 표시하라.
- 스키마·인덱스에는 언급되지만 실제 엔트리가 없는 타입은 "있는 것처럼" 쓰지 말고 "비어있다는 사실(실측 확인 후)" 혹은 "스키마-인덱스 비대칭"으로 다뤄라. **단정하지 말고 먼저 검증한 뒤 기술하라.** 그리고 **디렉토리 자체가 없는 경우와 디렉토리는 있으나 엔트리가 없는 경우를 구분해서 기록하라.**
- `kg/*` KG와 `.built/*` knowledge layer를 하나로 묶어 설명하지 마라. 통합이 필요하다고 판단되면 반드시 Next Step으로 분리.
- 파일명은 확장자까지 정확히 표기하라: `run-request.json`, `progress.json`, `state.json`, `do-result.md`, `check-result.md`, `report.md`.
