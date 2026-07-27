#!/usr/bin/env node
/**
 * install-hooks.js
 *
 * Git pre-commit hook 설치 스크립트.
 * .built/runs/와 .built/features/ 하위 public 산출물에 대해
 * 커밋 전 staged content를 자동 sanitize한다.
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
 *   3. hook은 staged .built/runs/, .built/features/ 하위 .md/.json/.jsonl만 대상
 *   4. 변경된 index blob만 갱신해 unstaged content를 함께 stage하지 않음
 *
 * Exit codes:
 *   0 — 성공
 *   1 — 오류
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const childProcess = require('child_process');
const {
  isPathInside,
  sanitizeMarkdown,
  sanitizeText,
} = require('./sanitize');

const HOOK_MARKER = '# built-sanitize-hook';

const HOOK_CONTENT = `#!/bin/sh
${HOOK_MARKER}
# built pre-commit hook: 현재 public artifact의 staged content 자동 sanitize
#
# 이 파일은 scripts/install-hooks.js로 생성되었습니다.
# 수동으로 수정하지 마세요.

SCRIPT_DIR="$(git rev-parse --show-toplevel)"
HOOK_RUNNER="$SCRIPT_DIR/scripts/install-hooks.js"

if [ ! -f "$HOOK_RUNNER" ]; then
  echo "[built] install-hooks.js not found, skipping sanitize."
  exit 0
fi

echo "[built] Sanitizing output files before commit..."
node "$HOOK_RUNNER" --run-staged-sanitize
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "[built] Sanitize failed. Commit aborted."
  exit 1
fi

echo "[built] Sanitize complete."
exit 0
`;

function runGit(projectRoot, args, options) {
  const opts = options || {};
  const result = childProcess.spawnSync('git', ['-C', projectRoot, ...args], {
    encoding: opts.encoding === undefined ? 'utf8' : opts.encoding,
    input: opts.input,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8')
      : String(result.stderr || '');
    throw new Error(`git ${args[0]} 실패: ${stderr.trim() || `exit ${result.status}`}`);
  }
  return result.stdout;
}

function isStagedArtifactPath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  if (!normalized || normalized.split('/').includes('..')) return false;
  return /^\.built\/(?:runs|features)\/.+\.(?:md|json|jsonl)$/i.test(normalized);
}

function listStagedArtifactPaths(projectRoot) {
  const output = runGit(
    projectRoot,
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
    { encoding: null }
  );
  return output.toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter(isStagedArtifactPath);
}

function readIndexEntry(projectRoot, filePath) {
  const output = runGit(
    projectRoot,
    ['ls-files', '--stage', '-z', '--', filePath],
    { encoding: null }
  );
  const record = output.toString('utf8').split('\0').find(Boolean);
  if (!record) return null;

  const separator = record.indexOf('\t');
  if (separator === -1) return null;
  const [mode, objectId, stage] = record.slice(0, separator).split(/\s+/);
  if (stage !== '0') return null;
  return { mode, objectId };
}

function sanitizeStagedContent(filePath, content) {
  const text = content.toString('utf8');
  return path.extname(filePath).toLowerCase() === '.md'
    ? sanitizeMarkdown(text, { maskSession: true })
    : sanitizeText(text, { maskSession: true });
}

function runStagedSanitize(projectRoot) {
  const gitRoot = findGitRoot(projectRoot);
  if (!gitRoot) {
    throw new Error('Git repository not found.');
  }

  const stagedFiles = listStagedArtifactPaths(gitRoot);
  const changedFiles = [];

  for (const filePath of stagedFiles) {
    const entry = readIndexEntry(gitRoot, filePath);
    if (!entry || (entry.mode !== '100644' && entry.mode !== '100755')) {
      continue;
    }

    const original = runGit(gitRoot, ['cat-file', 'blob', entry.objectId], { encoding: null });
    const sanitized = sanitizeStagedContent(filePath, original);
    if (sanitized === original.toString('utf8')) {
      continue;
    }

    const workingPath = path.resolve(gitRoot, filePath);
    const realGitRoot = fs.realpathSync(gitRoot);
    let workingContent = null;
    if (fs.existsSync(workingPath) && fs.lstatSync(workingPath).isFile()) {
      const realParent = fs.realpathSync(path.dirname(workingPath));
      if (isPathInside(realGitRoot, realParent)) {
        workingContent = fs.readFileSync(workingPath);
      }
    }
    const objectId = String(runGit(
      gitRoot,
      ['hash-object', '-w', '--stdin'],
      { input: sanitized, encoding: 'utf8' }
    )).trim();

    runGit(gitRoot, ['update-index', '--add', '--cacheinfo', entry.mode, objectId, filePath]);

    if (workingContent && workingContent.equals(original)) {
      fs.writeFileSync(workingPath, sanitized, 'utf8');
    }
    changedFiles.push(filePath);
  }

  const output = stagedFiles.length === 0
    ? 'No staged artifact files found.'
    : `Sanitized staged artifacts: ${changedFiles.length}/${stagedFiles.length} file(s) changed.`;
  return { output, stagedFiles, changedFiles };
}

/**
 * Git 루트 디렉토리를 찾는다.
 * @param {string} startDir
 * @returns {string|null}
 */
function findGitRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveGitHooksDir(gitRoot) {
  const hooksPath = String(runGit(gitRoot, ['rev-parse', '--git-path', 'hooks'])).trim();
  return path.isAbsolute(hooksPath) ? hooksPath : path.resolve(gitRoot, hooksPath);
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

  const hooksDir = resolveGitHooksDir(gitRoot);
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

  const hookFile = path.join(resolveGitHooksDir(gitRoot), 'pre-commit');
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
  const runStaged = args.includes('--run-staged-sanitize');

  const projectRoot = process.cwd();

  try {
    let result;
    if (runStaged) {
      result = runStagedSanitize(projectRoot);
    } else if (uninstall) {
      result = uninstallHook(projectRoot);
    } else {
      result = installHook(projectRoot, { force });
    }
    process.stdout.write(result.output + '\n');
  } catch (err) {
    process.stderr.write(`[built] ${err.message}\n`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// 모듈 exports
// ---------------------------------------------------------------------------

module.exports = {
  findGitRoot,
  installHook,
  uninstallHook,
  runStagedSanitize,
  listStagedArtifactPaths,
  isStagedArtifactPath,
  resolveGitHooksDir,
  HOOK_CONTENT,
  HOOK_MARKER,
};
