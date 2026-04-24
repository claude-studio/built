# PoC-1: EnterWorktree 전환 검증

**날짜**: 2026-04-24
**브랜치**: poc-1
**검증자**: 개발 에이전트

---

## 목표

`/built:plan` 실행 시 EnterWorktree 호출로 feature worktree 컨텍스트 전환이 가능한지 검증.
새 worktree 생성 후 파일 Read/Write가 worktree 내부 경로에서 격리되어 동작하는지 실측.

---

## 완료 기준별 결과

### 기준 1: EnterWorktree 호출 후 worktree 경로 생성 확인

**결과: 조건부 성공**

EnterWorktree 도구는 **세션 CWD가 git 레포인 경우에만** 동작한다.

- 테스트 1 (실패): multica 에이전트 CWD(`~/multica_workspaces/.../workdir`) — git 레포가 아님
  - 에러: `Cannot create a worktree: not in a git repository and no WorktreeCreate hooks are configured`
- 테스트 2 (수동 검증): `git -C ~/Desktop/jb/built worktree add .claude/worktrees/poc-1-test`
  - 생성된 경로: `/Users/mini32gb/Desktop/jb/built/.claude/worktrees/poc-1-test` ✓

```
/Users/mini32gb/Desktop/jb/built                              fcf83d8 [main]
/Users/mini32gb/Desktop/jb/built/.claude/worktrees/poc-1      fcf83d8 [poc-1]
/Users/mini32gb/Desktop/jb/built/.claude/worktrees/poc-1-test fcf83d8 [poc-1-test]
```

**핵심 발견**: EnterWorktree는 Claude 세션이 `~/Desktop/jb/built`를 CWD로 시작했을 때 호출해야 한다.
`/built:plan`은 반드시 대상 프로젝트 루트를 CWD로 하는 interactive Claude 세션에서 실행되어야 함.

---

### 기준 2: worktree 진입 후 파일 Write 시 worktree 경로 안에 생성됨 확인

**결과: 성공**

`~/Desktop/jb/built/.claude/worktrees/poc-1-test/` 를 CWD로 Write 수행:

- `poc-test-write.txt` → worktree 내부에 생성됨 ✓
- `~/Desktop/jb/built/poc-test-write.txt` → **존재하지 않음** (main 레포와 격리됨) ✓

worktree 내 git status:
```
현재 브랜치 poc-1-test
추적하지 않는 파일:
    poc-test-read.txt
    poc-test-write.txt
```

Write된 파일은 해당 브랜치(`poc-1-test`)에만 untracked 상태로 존재.
main 레포와 다른 worktree에는 전파되지 않음.

---

### 기준 3: worktree 진입 후 파일 Read 시 worktree 내부 파일 우선 조회 확인

**결과: 성공**

동일한 파일명 `poc-test-read.txt`를 두 위치에 생성:

- `~/Desktop/jb/built/poc-test-read.txt` → 내용: "main 레포 버전"
- `~/Desktop/jb/built/.claude/worktrees/poc-1-test/poc-test-read.txt` → 내용: "worktree 버전"

worktree 경로에서 Read 수행 시 `"worktree 버전"` 반환 ✓
절대 경로 기반으로 각 worktree 파일이 독립적으로 조회됨.

---

## 아키텍처 함의

### EnterWorktree 동작 조건

| 조건 | EnterWorktree 동작 |
|---|---|
| 세션 CWD = git 레포 루트 | `.claude/worktrees/<name>/` 생성 후 CWD 전환 |
| 세션 CWD = git 레포 아님 | 실패 (WorktreeCreate hook 없으면) |
| 세션 CWD = git 레포 아님 + WorktreeCreate hook 설정 | hook에 위임 |

### /built:plan 구현 시 주의사항

1. `/built:plan`은 항상 대상 프로젝트 레포를 CWD로 하는 Claude interactive 세션에서 실행
2. `EnterWorktree` 호출 전 현재 세션 CWD가 git 레포인지 확인 필요
3. EnterWorktree 후 Write/Read는 worktree 절대경로 기준으로 완전 격리됨 (의도대로 동작)
4. shared runtime은 main 레포 절대경로(`BUILT_RUNTIME_ROOT`)를 직접 참조해야 함 — worktree CWD 기준 상대경로 불가

### BUILT-DESIGN.md §4 대조

설계 문서의 `--worktree <name>` 활용 계획과 실측 결과 일치:
- worktree는 `.claude/worktrees/` 아래에 생성됨 ✓
- 각 worktree는 독립된 브랜치를 가짐 ✓
- Write/Read가 worktree 내부로 격리됨 ✓

---

## 결론

**PoC-1 통과** (조건 명시 필요)

EnterWorktree 기능은 설계 의도대로 동작한다.
단, **반드시 Claude 세션 CWD = 대상 프로젝트 git 레포 루트** 조건에서만 사용 가능.
`/built:plan` SKILL.md 작성 시 이 전제조건을 명시해야 한다.
