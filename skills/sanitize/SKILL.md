---
name: sanitize
description: .built/runs/와 .built/features/의 public 산출물에서 민감 정보를 자동 마스킹한다. session_id, 홈 경로, API 키, 환경변수 마스킹.
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# /built:sanitize

현재 project root의 `.built/runs/`와 `.built/features/` 하위 public 산출물에서 민감 정보를 자동 마스킹합니다.

## 사용법

```
/built:sanitize [targetPath] [--dry-run]
```

- `targetPath` (선택): 스캔할 project 내부 파일 또는 디렉토리
- 기본값: `.built/runs/`와 `.built/features/`를 함께 스캔
- `--dry-run`: 실제 파일을 수정하지 않고 변경 대상만 출력

## 실행 방법

```bash
node scripts/sanitize.js [targetPath] [--dry-run]
```

로컬 개발 (`--plugin-dir` 방식):

```bash
node scripts/sanitize.js
```

## 마스킹 대상

1. **session_id 값** (선택적) — `"session_id": "abc123"` → `"session_id": "[REDACTED]"`
2. **사용자 홈 경로** — `/Users/gin/projects` → `~/projects`, `/home/gin` → `~`
3. **API 키 패턴**
   - `sk-ant-api03-...` (Anthropic)
   - `sk-proj-...` (Anthropic project key)
   - `ghp_...` (GitHub personal access token)
   - `github_pat_...` (GitHub fine-grained token)
4. **환경변수 값** — `SECRET_KEY=abc123` → `SECRET_KEY=[REDACTED]` (SAFE_KEYS 제외)

## SAFE_KEYS (마스킹 제외)

`NODE_ENV`, `PATH`, `HOME`, `USER`, `SHELL`, `LANG`, `LC_ALL`, `TZ`, `PWD`, `TERM`, 기타 일반 시스템 변수.

## 대상 파일

- `.built/runs/` 하위 Plan draft, root context 등 기존 public artifact
- `.built/features/` 하위 phase result, `progress.json`, `logs/*.jsonl` 등 현재 public artifact
- 두 기본 경로를 project root에서 **재귀** 스캔
- `*.md` — frontmatter + 본문 양쪽 동일 규칙 적용
- `*.json` — 구조를 파싱해 값(value)만 마스킹하고 유효한 JSON을 유지
- `*.jsonl` — 각 비어 있지 않은 줄을 파싱해 마스킹하고 one-object-per-line 계약을 유지

execution worktree에서 실행하면 그 worktree가 project root입니다. 따라서 해당 worktree의 canonical `.built/features/<feature>/`만 처리하며, 다른 worktree나 project 밖 경로를 자동 탐색하지 않습니다. 명시 `targetPath`도 현재 project root 내부 경로만 허용합니다.

## 출력 예시

변경 없음:
```
Sanitized 3 file(s) — no changes needed.
```

변경 있음:
```
Sanitized: 2/3 file(s) changed.
  .built/runs/user-auth/do-result.md
  .built/features/user-auth/report.md
```

디렉토리 없음:
```
No artifact paths found: .built/runs, .built/features
```

## pre-commit hook 연동

```bash
node scripts/install-hooks.js
```

Git commit 전 staged `.built/runs/`, `.built/features/`의 Markdown/JSON/JSONL content를 자동으로 sanitize하는 hook을 설치합니다. hook은 실제로 변경된 index blob만 다시 stage하므로 부분 stage된 working tree 변경을 함께 커밋하지 않습니다.

hook 제거:
```bash
node scripts/install-hooks.js --uninstall
```

## 주의

- 외부 npm 패키지 없음. Node.js 20+ 필요.
- 대상 project 또는 execution worktree 루트에서 실행합니다.
- sanitize는 마지막 안전망입니다. 민감 파일을 Claude 세션에 노출하지 않는 것이 1차 방어선입니다.
