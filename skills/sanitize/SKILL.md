---
name: sanitize
description: .built/runs/ 하위 산출물 파일에서 민감 정보를 자동 마스킹한다. session_id, 홈 경로, API 키, 환경변수 마스킹.
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# /built:sanitize

`.built/runs/` 하위 산출물 파일에서 민감 정보를 자동 마스킹합니다.

## 사용법

```
/built:sanitize [runsDir] [--dry-run]
```

- `runsDir` (선택): 스캔할 디렉토리 경로 (기본값: `.built/runs`)
- `--dry-run`: 실제 파일을 수정하지 않고 변경 대상만 출력

## 실행 방법

```bash
node scripts/sanitize.js [runsDir] [--dry-run]
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

- `.built/runs/` 하위 **재귀** 스캔
- `*.md` — frontmatter + 본문 양쪽 동일 규칙 적용
- `*.json` — 값(value)만 마스킹, 키(key)는 유지

## 출력 예시

변경 없음:
```
Sanitized 3 file(s) — no changes needed.
```

변경 있음:
```
Sanitized: 2/3 file(s) changed.
  .built/runs/user-auth/do-result.md
  .built/runs/user-auth/report.md
```

디렉토리 없음:
```
No runs directory found: .built/runs
```

## pre-commit hook 연동

```bash
node scripts/install-hooks.js
```

Git commit 전 자동으로 sanitize를 실행하는 hook을 `.git/hooks/pre-commit`에 설치합니다.

hook 제거:
```bash
node scripts/install-hooks.js --uninstall
```

## 주의

- 외부 npm 패키지 없음. Node.js 20+ 필요.
- 대상 프로젝트 루트에서 실행합니다.
- sanitize는 마지막 안전망입니다. 민감 파일을 Claude 세션에 노출하지 않는 것이 1차 방어선입니다.
