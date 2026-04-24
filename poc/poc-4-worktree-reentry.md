# PoC-4: worktree 재진입 + claude -p 경로 일치 검증

**날짜**: 2026-04-24
**브랜치**: poc-4
**검증자**: 개발 에이전트

---

## 목표

feature worktree 재진입 시 .worktreeinclude 파일이 자동 복사되고,
claude -p 서브세션의 실행 경로가 worktree 내부와 일치하는지 검증.

---

## 완료 기준별 결과

### 기준 1: 기존 worktree 재진입 동작 확인

**결과: 성공**

`git worktree remove --force` 후 동일 브랜치명으로 `git worktree add <path> <branch>` 재진입.

```bash
# 제거
git -C ~/Desktop/jb/built worktree remove .claude/worktrees/poc-4 --force

# 브랜치 생존 확인
git -C ~/Desktop/jb/built branch -a | grep poc-4
# → poc-4 (로컬 브랜치 살아있음)

# 재진입
git -C ~/Desktop/jb/built worktree add .claude/worktrees/poc-4 poc-4
# → "작업 트리 준비 중 ('poc-4' 가져오는 중)" 성공
```

worktree 제거 시 **untracked 파일은 소실**됨 (--force 옵션으로 강제 제거 시).
브랜치 자체는 유지되므로 커밋된 변경사항은 보존됨.

---

### 기준 2: .worktreeinclude 파일 자동 복사 여부 확인

**결과: 신규 생성 시만 복사 / 재진입 시 미복사**

테스트 환경 구성:
- `.gitignore`에 `.env.test.local`, `config.test.local` 추가
- 해당 파일들을 레포 루트에 생성
- `.worktreeinclude`에 두 파일 패턴 명시

#### 2-1. claude -p --worktree (신규 이름) — 복사됨

```bash
cd ~/Desktop/jb/built
claude -p --worktree poc-4-claude-wti-test --output-format json "..."
```

결과:
- CWD: `/Users/mini32gb/Desktop/jb/built/.claude/worktrees/poc-4-claude-wti-test`
- `.env.test.local` 존재 (28 bytes) → 자동 복사됨
- `config.test.local` 존재 (16 bytes) → 자동 복사됨
- 브랜치명: `worktree-poc-4-claude-wti-test` (claude가 `worktree-` 접두사 붙여 자동 생성)
- 세션 종료 후 worktree 자동 정리됨 (git worktree list에서 사라짐)

#### 2-2. claude -p --worktree (기존 이름 재진입) — 복사 안 됨

```bash
cd ~/Desktop/jb/built
claude -p --worktree poc-4 --output-format json "..."
```

결과:
- CWD: `/Users/mini32gb/Desktop/jb/built/.claude/worktrees/poc-4`
- `.env.test.local` → `No such file or directory`
- `config.test.local` → `No such file or directory`

기존 worktree에 재진입할 때는 `.worktreeinclude` 복사가 **발생하지 않음**.

#### 2-3. git worktree add 직접 사용 — 복사 안 됨

```bash
git -C ~/Desktop/jb/built worktree add .claude/worktrees/poc-4-wti-test -b poc-4-wti-test
```

결과:
- `.env.test.local` → 존재하지 않음
- `config.test.local` → 존재하지 않음

`git worktree add` 는 Claude Code 기능이 아니므로 `.worktreeinclude` 처리가 없음.

#### BUILT-DESIGN.md §12 스펙 대조

| 스펙 항목 | 실측 결과 |
|---|---|
| 패턴 매칭 AND gitignored 파일만 복사 | 신규 생성 시 조건 충족 파일 복사됨 ✓ |
| `claude -p --worktree`로 생성한 worktree에 적용 | 신규 생성 시에만 적용됨 (재진입 제외) |
| WorktreeCreate hook 커스텀 시 무시됨 | 미검증 (범위 외) |

---

### 기준 3: claude -p 서브세션 실행 경로 일치 확인

**결과: 성공**

#### 3-1. CWD를 worktree로 직접 설정 후 실행

```bash
cd ~/Desktop/jb/built/.claude/worktrees/poc-4
claude -p --output-format json "현재 작업 디렉토리를 출력해줘."
```

결과:
```
result: "/Users/mini32gb/Desktop/jb/built/.claude/worktrees/poc-4"
```

세션 내 CWD = worktree 경로 → 일치 ✓

#### 3-2. --worktree 플래그로 기존 worktree 지정

```bash
cd ~/Desktop/jb/built
claude -p --worktree poc-4 --output-format json "현재 작업 디렉토리를 출력해줘."
```

결과:
```
result: "현재 작업 디렉토리는 `/Users/mini32gb/Desktop/jb/built/.claude/worktrees/poc-4` 입니다."
```

레포 루트에서 실행해도 --worktree 플래그가 CWD를 worktree 경로로 전환 → 일치 ✓

#### 3-3. --worktree 플래그 브랜치 명명 규칙

`claude -p --worktree <name>` 실행 시:
- 기존 worktree 이름 → 해당 worktree 재사용
- 신규 이름 → `worktree-<name>` 브랜치 자동 생성, `.claude/worktrees/<name>` 경로에 worktree 생성, 세션 종료 후 자동 정리

---

### 기준 4: 재진입 + 서브세션 경로 일치 결론 (Week 2 구현 방향)

**결론: 재진입은 가능하나 .worktreeinclude 수동 복사 필요**

| 시나리오 | 가능 여부 | 비고 |
|---|---|---|
| git worktree add로 기존 브랜치 재진입 | 가능 ✓ | untracked 파일 소실 주의 |
| claude -p --worktree로 기존 worktree 재진입 | 가능 ✓ | .worktreeinclude 미복사 |
| 재진입 시 .worktreeinclude 자동 복사 | 불가 ✗ | 신규 생성 시에만 동작 |
| claude -p 서브세션 CWD = worktree 경로 | 일치 ✓ | --worktree 또는 CWD 직접 지정 모두 동작 |

#### Week 2 pipeline-runner.js 구현 방향

1. **worktree 재사용 전략**:
   - `claude -p --worktree <feature-name>` 플래그 사용 권장
   - 기존 worktree가 있으면 자동 재사용, 없으면 신규 생성
   - Do → Check → Iter 반복 시 동일 worktree 명 지정으로 상태 유지

2. **.worktreeinclude 처리**:
   - 최초 worktree 생성 시: `claude -p --worktree <name>` 이용 → 자동 복사됨
   - 재진입 시: `.worktreeinclude` 파일을 읽어 수동 복사하는 setup 스크립트 필요
   - 또는: 매 실행마다 신규 worktree 생성 후 제거 전략 (비용: worktree 생성/삭제 오버헤드)
   - 권장: 최초 생성(자동) + 재진입 시 setup 스크립트로 수동 복사

3. **CWD 전달 방식**:
   - `claude -p --worktree <feature-name>` 플래그가 가장 안정적
   - CWD를 직접 변경하는 방식도 동작하지만 관리 복잡도 증가

---

## 아키텍처 함의

### .worktreeinclude 복사 트리거 조건

| 트리거 | .worktreeinclude 복사 |
|---|---|
| `claude -p --worktree <신규명>` | 복사됨 ✓ |
| `claude -p --worktree <기존명>` | 복사 안 됨 ✗ |
| `git worktree add` 직접 | 복사 안 됨 ✗ |
| `EnterWorktree` 도구 | 미검증 (PoC-1 결과로 Multica 환경에서 사용 불가) |

### claude -p --worktree 브랜치 명명

- 사용자가 `--worktree <name>` 지정 시 → Claude가 `worktree-<name>` 브랜치 자동 생성
- 기존 worktree 재사용 시 → 기존 브랜치 유지
- 세션 종료 후 자동 생성된 worktree는 정리됨 (기존 worktree는 유지됨)

### pipeline-runner.js 설계 시 주의사항

1. 최초 feature 실행: `claude -p --worktree <feature-name>` → .worktreeinclude 자동 복사 활용
2. 재실행(Iter/Check): 동일 `--worktree <feature-name>` 지정 → 기존 worktree 재사용
3. 재실행 시 .worktreeinclude 파일 필요하다면: pipeline-runner에서 파싱 후 수동 복사 step 추가
4. `git worktree add` 직접 사용하는 경우 (Multica 에이전트 팀): .worktreeinclude 처리 없음 → 수동 복사 필수

---

## 결론

**PoC-4 통과** (제약 조건 명시 필요)

- worktree 재진입: `claude -p --worktree <existing-name>` 또는 `git worktree add <path> <branch>` 모두 가능
- .worktreeinclude 자동 복사: `claude -p --worktree` **신규 생성 시에만** 동작, 재진입 시는 수동 처리 필요
- claude -p 서브세션 CWD: worktree 경로와 완전 일치 (--worktree 플래그 또는 CWD 직접 지정 모두)
- Week 2 pipeline-runner.js: `claude -p --worktree <feature-name>` 플래그 기반으로 구현 권장
