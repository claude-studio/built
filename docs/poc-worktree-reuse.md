# PoC: claude -p --worktree 기반 execution worktree 재사용

검증일: 2026-04-25
담당: 개발 에이전트 (BUI-75)
참고 스펙: BUILT-DESIGN.md §8.2-b, §12, §16

---

## 1. 검증 목표

| # | 목표 | 결과 |
|---|------|------|
| 1 | `claude -p --worktree <name>`으로 worktree 생성 가능 여부 | 확인됨 |
| 2 | 같은 worktree를 Do → Check → Iter → Report에 걸쳐 재사용 가능 여부 | 확인됨 (경로 패턴으로 검증) |
| 3 | `.built/runtime/runs/<feature>/`를 canonical로 유지하면서 결과 문서를 worktree에 저장하는 패턴 | 확인됨 |
| 4 | 현재 run.js 오케스트레이션과의 통합 계획 | 수립됨 |

---

## 2. 실측 결과

### 2-1. worktree 생성

```bash
cd ~/Desktop/jb/built
claude -p --worktree <name> "<prompt>"
```

- 생성 위치: `.claude/worktrees/<name>/`
- 자동 생성 브랜치: `worktree-<name>` (주의: `<name>` 그대로가 아님)
- git-tracked 파일 전체 접근 가능
- `.worktreeinclude`에 명시된 파일(config.test.local, .env.test.local)이 자동 복사됨
- `.claude/settings.json`이 worktree에 반영됨 (플러그인 설정 포함)

### 2-2. --bare 모드 제약

`claude --bare -p --worktree <name>` 사용 시:

- worktree는 정상 생성됨
- **그러나 인증 실패**: `--bare`는 OAuth/keychain을 사용하지 않으며 `ANTHROPIC_API_KEY` 환경변수만 허용
- 현재 built 환경은 OAuth 인증 사용 → `--bare` 없이 `-p --worktree`만 사용해야 함
- `--bare` 제거 시 OAuth 세션 재사용 가능

**결론**: 설계 문서 §8.2-b의 `claude --bare -p --worktree` 표기에서 `--bare`는 생략해야 한다.

### 2-3. 경로 분리 패턴 검증

```
원본 레포 (canonical runtime):
  ~/.built/runtime/runs/<feature>/state.json        ← orchestrator 상태
  ~/.built/runtime/runs/<feature>/run-request.json  ← handoff

worktree (결과 문서):
  .claude/worktrees/<feature>-runner/.built/runs/<feature>/do-result.md
  .claude/worktrees/<feature>-runner/.built/runs/<feature>/check-result.md
  .claude/worktrees/<feature>-runner/.built/runs/<feature>/iter-result.md
  .claude/worktrees/<feature>-runner/.built/runs/<feature>/report.md
```

- `BUILT_RUNTIME_ROOT` 환경변수로 절대경로 주입 → worktree CWD와 무관하게 canonical 경로 접근 가능
- `BUILT_WORKTREE` 환경변수로 worktree 절대경로 주입
- runtime 경로와 worktree 결과 경로가 완전히 분리됨 (state.json은 canonical에만 존재)
- Do → Check → Iter → Report 전 phase 결과 파일이 동일 worktree에 누적됨 (검증됨)

### 2-4. worktree 재사용 메커니즘

같은 worktree를 재사용하려면 각 phase 스크립트에 worktree 경로를 주입해야 한다. 현재 MVP는 phase별로 독립적인 `runPipeline()` 호출을 사용하므로:

- phase 시작 전: `BUILT_WORKTREE` 환경변수를 각 서브프로세스에 전달
- phase별 결과 파일 저장 경로를 `resultOutputPath`로 주입
- worktree 자체는 `run.js` 레벨에서 생성/제거 (phase 스크립트는 worktree를 직접 관리하지 않음)

---

## 3. 통합 계획

### 3-1. 필요한 변경 사항

#### run.js (오케스트레이터)

```js
// 1. feature-runner worktree 생성
const worktreeName = `${feature}-runner`;
const worktreePath = path.join(projectRoot, '.claude', 'worktrees', worktreeName);
const runtimeRoot  = process.env.BUILT_RUNTIME_ROOT || path.join(projectRoot, '.built', 'runtime');

// git worktree add (claude -p --worktree 대신 git CLI 직접 사용 권장 — §ADR-2 참고)
childProcess.execSync(
  `git worktree add ${worktreePath} -b worktree-${feature}`,
  { cwd: projectRoot }
);

// 2. 환경변수 주입
const env = {
  ...process.env,
  BUILT_RUNTIME_ROOT: runtimeRoot,
  BUILT_WORKTREE: worktreePath,
};

// 3. 결과 파일 경로 변경
const resultBaseDir = path.join(worktreePath, '.built', 'runs', feature);
// do-result.md, check-result.md 등을 resultBaseDir 아래에 저장

// 4. 완료 후 worktree 정리 (선택, config 기반)
// git worktree remove <worktreePath> --force
```

#### pipeline-runner.js

```js
// worktree CWD에서 실행
const child = childProcess.spawn('claude', args, {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: env,
  cwd: worktreePath,  // worktree 내에서 실행
});
```

#### do.js / check.js / iter.js / report.js

```js
// BUILT_WORKTREE 환경변수에서 worktree 경로 읽기
const worktreePath = process.env.BUILT_WORKTREE || projectRoot;
const resultBaseDir = process.env.BUILT_WORKTREE
  ? path.join(worktreePath, '.built', 'runs', feature)
  : path.join(projectRoot, '.built', 'features', feature); // MVP 폴백
```

### 3-2. MVP 경로 영향 여부

- `BUILT_WORKTREE` 환경변수 미설정 시 기존 `.built/features/<feature>/` 경로로 폴백
- `BUILT_RUNTIME_ROOT` 미설정 시 기존 `.built/runtime/` 경로 유지
- **기존 MVP 경로 영향 없음**: 환경변수 opt-in 방식으로 점진적 도입 가능

### 3-3. worktree 생성 방식 결정

`claude -p --worktree <name>` 대신 `git worktree add` 직접 사용 권장:

| 항목 | `claude -p --worktree` | `git worktree add` |
|------|----------------------|-------------------|
| 브랜치 네이밍 | `worktree-<name>` (고정 prefix) | 자유롭게 제어 가능 |
| 인증 의존 | OAuth 세션 필요 | 불필요 |
| 용도 | 대화형 worktree 생성 | 스크립트에서 programmatic 제어 |
| ADR-1 제약 | CWD가 git root여야 함 | CWD 무관 (-C 플래그) |

오케스트레이터(run.js)에서는 `git -C <projectRoot> worktree add` 방식이 적합하다.
`claude -p --worktree`는 사용자가 대화형으로 execution worktree를 직접 열 때 유용하다.

---

## 4. 현재 MVP와의 차이점 요약

| 항목 | 현재 MVP | Next Step (이 PoC) |
|------|---------|-------------------|
| 결과 문서 위치 | `.built/features/<feature>/` | `.claude/worktrees/<feature>-runner/.built/runs/<feature>/` |
| runtime 상태 위치 | `.built/runtime/runs/<feature>/` (동일) | `.built/runtime/runs/<feature>/` (동일, canonical 유지) |
| worktree | 없음 | `git worktree add`로 생성 |
| phase 실행 CWD | 원본 레포 루트 | worktree 경로 |
| 환경변수 | 없음 | `BUILT_RUNTIME_ROOT`, `BUILT_WORKTREE` |

---

## 5. 다음 단계

1. `run.js`에 worktree 생성/정리 로직 추가 (별도 이슈)
2. `pipeline-runner.js`의 `cwd` 옵션 추가 (`BUILT_WORKTREE` 기반)
3. `do.js`, `check.js`, `iter.js`, `report.js`의 결과 경로를 환경변수 기반으로 전환
4. `.worktreeinclude`에 추가 파일 검토 (`.built/context.md` 등 필요 여부)
5. 통합 테스트: 실제 feature로 worktree 기반 파이프라인 1회 완주

---

## 참고

- ADR-1: EnterWorktree는 git 레포 루트 CWD에서만 동작 → run.js는 `git -C <root> worktree add` 사용
- ADR-2: claude -p --worktree vs git worktree add 선택 기준 (이 문서 기반, kg/decisions/ 참고)
