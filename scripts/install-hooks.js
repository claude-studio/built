#!/usr/bin/env node
/**
 * install-hooks.js
 *
 * Git pre-commit hook 설치 스크립트.
 * .built/runs/ 하위 산출물 파일에 대해 커밋 전 자동 sanitize를 실행한다.
 *
 * 사용법:
 *   node scripts/install-hooks.js [--uninstall] [--force]
 *
 *   --uninstall  hook 제거
 *   --force      기존 hook을 덮어쓰기
 *
 * 동작:
 *   1. .git/hooks/ 디렉토리 확인
 *   2. .git/hooks/pre-commit 파일 생성 (실행 권한 포함)
 *   3. hook은 git staged 파일 중 .built/runs/ 하위 .md/.json만 대상
 *
 * Exit codes:
 *   0 — 성공
 *   1 — 오류
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const HOOK_MARKER = '# built-sanitize-hook';

const HOOK_CONTENT = `#!/bin/sh
${HOOK_MARKER}
# built pre-commit hook: .built/runs/ 하위 산출물 자동 sanitize
#
# 이 파일은 scripts/install-hooks.js로 생성되었습니다.
# 수동으로 수정하지 마세요.

SCRIPT_DIR="$(git rev-parse --show-toplevel)"
SANITIZE_SCRIPT="$SCRIPT_DIR/scripts/sanitize.js"

if [ ! -f "$SANITIZE_SCRIPT" ]; then
  echo "[built] sanitize.js not found, skipping sanitize."
  exit 0
fi

# staged 파일 중 .built/runs/ 하위 .md/.json 파일 필터링
STAGED_RUNS=$(git diff --cached --name-only --diff-filter=ACM | grep -E '^\\.built/runs/.*\\.(md|json)$')

if [ -z "$STAGED_RUNS" ]; then
  exit 0
fi

echo "[built] Sanitizing output files before commit..."
node "$SANITIZE_SCRIPT"
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "[built] Sanitize failed. Commit aborted."
  exit 1
fi

# sanitize로 변경된 파일을 다시 stage
for FILE in $STAGED_RUNS; do
  if [ -f "$SCRIPT_DIR/$FILE" ]; then
    git add "$SCRIPT_DIR/$FILE"
  fi
done

echo "[built] Sanitize complete."
exit 0
`;

/**
 * Git 루트 디렉토리를 찾는다.
 * @param {string} startDir
 * @returns {string|null}
 */
function findGitRoot(startDir) {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * pre-commit hook을 설치한다.
 * @param {string} projectRoot
 * @param {{ force?: boolean }} opts
 * @returns {{ output: string, installed: boolean }}
 */
function installHook(projectRoot, opts) {
  const options = opts || {};
  const gitRoot = findGitRoot(projectRoot);
  if (!gitRoot) {
    return { output: 'Git repository not found.', installed: false };
  }

  const hooksDir = path.join(gitRoot, '.git', 'hooks');
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  const hookFile = path.join(hooksDir, 'pre-commit');

  // 기존 hook 확인
  if (fs.existsSync(hookFile) && !options.force) {
    const existing = fs.readFileSync(hookFile, 'utf8');
    if (existing.includes(HOOK_MARKER)) {
      return { output: 'pre-commit hook already installed.', installed: false };
    }
    return {
      output: 'pre-commit hook already exists (not by built). Use --force to overwrite.',
      installed: false,
    };
  }

  fs.writeFileSync(hookFile, HOOK_CONTENT, { encoding: 'utf8', mode: 0o755 });
  return { output: 'pre-commit hook installed: .git/hooks/pre-commit', installed: true };
}

/**
 * pre-commit hook을 제거한다.
 * @param {string} projectRoot
 * @returns {{ output: string, uninstalled: boolean }}
 */
function uninstallHook(projectRoot) {
  const gitRoot = findGitRoot(projectRoot);
  if (!gitRoot) {
    return { output: 'Git repository not found.', uninstalled: false };
  }

  const hookFile = path.join(gitRoot, '.git', 'hooks', 'pre-commit');
  if (!fs.existsSync(hookFile)) {
    return { output: 'pre-commit hook not found.', uninstalled: false };
  }

  const content = fs.readFileSync(hookFile, 'utf8');
  if (!content.includes(HOOK_MARKER)) {
    return {
      output: 'pre-commit hook was not installed by built. Skipping.',
      uninstalled: false,
    };
  }

  fs.unlinkSync(hookFile);
  return { output: 'pre-commit hook removed.', uninstalled: true };
}

// ---------------------------------------------------------------------------
// CLI 진입점
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  const uninstall = args.includes('--uninstall');
  const force = args.includes('--force');

  const projectRoot = process.cwd();

  let result;
  if (uninstall) {
    result = uninstallHook(projectRoot);
  } else {
    result = installHook(projectRoot, { force });
  }

  process.stdout.write(result.output + '\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 모듈 exports
// ---------------------------------------------------------------------------

module.exports = {
  findGitRoot,
  installHook,
  uninstallHook,
  HOOK_CONTENT,
  HOOK_MARKER,
};
