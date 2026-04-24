#!/usr/bin/env node
/**
 * sanitize.js
 *
 * /built:sanitize 스킬 헬퍼 — 산출물에서 민감 정보를 자동 마스킹한다.
 * 외부 npm 패키지 없음 (Node.js fs/path/os만).
 *
 * 마스킹 대상:
 *   - session_id 값 (선택적)
 *   - 사용자 홈 경로 (/Users/xxx → ~/, /home/xxx → ~/)
 *   - API 키 패턴 (sk-ant-*, ghp_*, sk-proj-*)
 *   - SAFE_KEYS에 없는 환경변수 값
 *
 * 대상 파일:
 *   - .built/runs/ 하위 *.md, *.json
 *   - Markdown: frontmatter + 본문 양쪽 동일 규칙 적용
 *
 * 사용법:
 *   node scripts/sanitize.js [<runsDir>] [--dry-run]
 *
 *   runsDir  스캔할 디렉토리 (기본값: .built/runs)
 *   --dry-run  실제로 파일을 수정하지 않고 결과만 출력
 *
 * Exit codes:
 *   0 — 성공
 *   1 — 오류
 *
 * API (모듈로도 사용 가능):
 *   SAFE_KEYS                          — 환경변수 마스킹 제외 키 목록 (Set)
 *   maskHomePaths(text)               -> string
 *   maskApiKeys(text)                 -> string
 *   maskSessionId(text)               -> string
 *   maskEnvVars(text, safeKeys)       -> string
 *   sanitizeText(text, opts)          -> string
 *   sanitizeJson(obj, opts)           -> object
 *   sanitizeMarkdown(content, opts)   -> string
 *   sanitizeFile(filePath, opts)      -> { changed: boolean, content: string }
 *   sanitizeDir(dirPath, opts)        -> { files: string[], changed: string[] }
 *   sanitizeCommand(projectRoot, opts) -> { output: string, changedFiles: string[] }
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/**
 * 마스킹하지 않을 환경변수 키 목록.
 * BUILT_* 네임스페이스와 일반적으로 안전한 키를 기본 포함한다.
 */
const SAFE_KEYS = new Set([
  'NODE_ENV',
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'LANG',
  'LC_ALL',
  'TZ',
  'PWD',
  'OLDPWD',
  'TERM',
  'COLORTERM',
  'TMPDIR',
  'TEMP',
  'TMP',
  'EDITOR',
  'VISUAL',
  'PAGER',
  'MANPATH',
  'INFOPATH',
  'XDG_DATA_HOME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
]);

const REDACTED = '[REDACTED]';

// ---------------------------------------------------------------------------
// 마스킹 함수
// ---------------------------------------------------------------------------

/**
 * 사용자 홈 경로를 ~/로 치환한다.
 * /Users/<name>/... → ~/...
 * /home/<name>/...  → ~/...
 * @param {string} text
 * @returns {string}
 */
function maskHomePaths(text) {
  const homeDir = os.homedir();
  if (homeDir && homeDir.length > 1) {
    // 실제 홈 디렉토리 먼저 치환 (가장 정확)
    const escaped = homeDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(escaped, 'g'), '~');
  }
  // /Users/<name> 패턴
  text = text.replace(/\/Users\/[^/\s"'`]+/g, '~');
  // /home/<name> 패턴
  text = text.replace(/\/home\/[^/\s"'`]+/g, '~');
  return text;
}

/**
 * API 키 패턴을 마스킹한다.
 * sk-ant-*, ghp_*, sk-proj-*, sk-* (OpenAI 스타일)
 * @param {string} text
 * @returns {string}
 */
function maskApiKeys(text) {
  // sk-ant-api03-... (Anthropic)
  text = text.replace(/sk-ant-[A-Za-z0-9_-]+/g, REDACTED);
  // sk-proj-... (Anthropic project key)
  text = text.replace(/sk-proj-[A-Za-z0-9_-]+/g, REDACTED);
  // sk-... (OpenAI 스타일, 최소 20자)
  text = text.replace(/\bsk-[A-Za-z0-9]{20,}\b/g, REDACTED);
  // ghp_... (GitHub personal access token)
  text = text.replace(/ghp_[A-Za-z0-9]{36}/g, REDACTED);
  // github_pat_... (GitHub fine-grained token)
  text = text.replace(/github_pat_[A-Za-z0-9_]{82}/g, REDACTED);
  return text;
}

/**
 * session_id 값을 마스킹한다.
 * "session_id": "xxx" 또는 session_id=xxx 패턴
 * @param {string} text
 * @returns {string}
 */
function maskSessionId(text) {
  // JSON 스타일: "session_id": "value"
  text = text.replace(
    /("session_id"\s*:\s*)"[^"]+"/g,
    `$1"${REDACTED}"`
  );
  // YAML/frontmatter 스타일: session_id: value
  text = text.replace(
    /^(session_id\s*:\s*)(.+)$/gm,
    `$1${REDACTED}`
  );
  // key=value 스타일: session_id=value
  text = text.replace(
    /\bsession_id=\S+/g,
    `session_id=${REDACTED}`
  );
  return text;
}

/**
 * SAFE_KEYS에 없는 환경변수 값을 마스킹한다.
 * KEY=VALUE 패턴에서 VALUE를 마스킹.
 * export KEY=VALUE 또는 KEY=VALUE 형식 지원.
 * @param {string} text
 * @param {Set<string>} safeKeys
 * @returns {string}
 */
function maskEnvVars(text, safeKeys) {
  const safe = safeKeys || SAFE_KEYS;
  // export KEY=VALUE 또는 KEY=VALUE 패턴 (라인 단위)
  return text.replace(
    /^(export\s+)?([A-Z][A-Z0-9_]*)=(.+)$/gm,
    (match, exportPrefix, key, value) => {
      if (safe.has(key)) return match;
      // 이미 마스킹된 경우 무시
      if (value === REDACTED || value === `"${REDACTED}"` || value === `'${REDACTED}'`) {
        return match;
      }
      const prefix = exportPrefix || '';
      return `${prefix}${key}=${REDACTED}`;
    }
  );
}

/**
 * 텍스트에 모든 마스킹 규칙을 적용한다.
 * @param {string} text
 * @param {{ maskSession?: boolean, safeKeys?: Set<string> }} opts
 * @returns {string}
 */
function sanitizeText(text, opts) {
  const options = opts || {};
  let result = text;
  result = maskHomePaths(result);
  result = maskApiKeys(result);
  if (options.maskSession !== false) {
    result = maskSessionId(result);
  }
  result = maskEnvVars(result, options.safeKeys);
  return result;
}

// ---------------------------------------------------------------------------
// JSON 처리
// ---------------------------------------------------------------------------

/**
 * JSON 객체의 문자열 값을 재귀적으로 마스킹한다.
 * @param {*} obj
 * @param {{ maskSession?: boolean, safeKeys?: Set<string> }} opts
 * @returns {*}
 */
function sanitizeJson(obj, opts) {
  if (typeof obj === 'string') {
    return sanitizeText(obj, opts);
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeJson(item, opts));
  }
  if (obj !== null && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = sanitizeJson(value, opts);
    }
    return result;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Markdown 처리 (frontmatter + 본문)
// ---------------------------------------------------------------------------

/**
 * YAML frontmatter를 파싱해 { frontmatter, body }로 분리한다.
 * frontmatter가 없으면 { frontmatter: null, body: content } 반환.
 * @param {string} content
 * @returns {{ frontmatter: string|null, body: string, hasFrontmatter: boolean }}
 */
function parseFrontmatter(content) {
  if (!content.startsWith('---')) {
    return { frontmatter: null, body: content, hasFrontmatter: false };
  }
  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { frontmatter: null, body: content, hasFrontmatter: false };
  }
  const frontmatter = content.slice(3, endIndex).trim();
  const body = content.slice(endIndex + 4); // '\n---' 이후
  return { frontmatter, body, hasFrontmatter: true };
}

/**
 * Markdown 파일 내용을 sanitize한다.
 * frontmatter와 본문 양쪽에 동일한 규칙 적용.
 * @param {string} content
 * @param {{ maskSession?: boolean, safeKeys?: Set<string> }} opts
 * @returns {string}
 */
function sanitizeMarkdown(content, opts) {
  const { frontmatter, body, hasFrontmatter } = parseFrontmatter(content);
  if (!hasFrontmatter) {
    return sanitizeText(content, opts);
  }
  const sanitizedFrontmatter = sanitizeText(frontmatter, opts);
  const sanitizedBody = sanitizeText(body, opts);
  return `---\n${sanitizedFrontmatter}\n---${sanitizedBody}`;
}

// ---------------------------------------------------------------------------
// 파일/디렉토리 처리
// ---------------------------------------------------------------------------

/**
 * 단일 파일을 sanitize한다.
 * @param {string} filePath
 * @param {{ maskSession?: boolean, safeKeys?: Set<string>, dryRun?: boolean }} opts
 * @returns {{ changed: boolean, content: string }}
 */
function sanitizeFile(filePath, opts) {
  const options = opts || {};
  let original;
  try {
    original = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`파일 읽기 실패: ${filePath} — ${err.message}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  let sanitized;

  if (ext === '.md') {
    sanitized = sanitizeMarkdown(original, options);
  } else {
    // JSON 포함 나머지 파일은 텍스트 기반 처리.
    // JSON을 parse+serialize하면 포매팅이 달라져 false positive가 생기므로
    // 원본 텍스트에 직접 regex 적용한다.
    sanitized = sanitizeText(original, options);
  }

  const changed = sanitized !== original;
  if (changed && !options.dryRun) {
    fs.writeFileSync(filePath, sanitized, 'utf8');
  }
  return { changed, content: sanitized };
}

/**
 * 디렉토리를 재귀적으로 스캔해 *.md, *.json 파일을 sanitize한다.
 * @param {string} dirPath
 * @param {{ maskSession?: boolean, safeKeys?: Set<string>, dryRun?: boolean }} opts
 * @returns {{ files: string[], changed: string[] }}
 */
function sanitizeDir(dirPath, opts) {
  const files = [];
  const changed = [];

  if (!fs.existsSync(dirPath)) {
    return { files, changed };
  }

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.md' || ext === '.json') {
          files.push(fullPath);
          try {
            const result = sanitizeFile(fullPath, opts);
            if (result.changed) {
              changed.push(fullPath);
            }
          } catch (err) {
            // 오류가 있어도 계속 진행
            process.stderr.write(`경고: ${err.message}\n`);
          }
        }
      }
    }
  }

  walk(dirPath);
  return { files, changed };
}

// ---------------------------------------------------------------------------
// 커맨드 엔트리
// ---------------------------------------------------------------------------

/**
 * sanitize 커맨드 실행.
 * @param {string} projectRoot  프로젝트 루트 절대경로
 * @param {{ runsDir?: string, maskSession?: boolean, safeKeys?: Set<string>, dryRun?: boolean }} opts
 * @returns {{ output: string, changedFiles: string[] }}
 */
function sanitizeCommand(projectRoot, opts) {
  const options = opts || {};
  const runsDir = options.runsDir
    ? path.resolve(projectRoot, options.runsDir)
    : path.join(projectRoot, '.built', 'runs');

  if (!fs.existsSync(runsDir)) {
    return {
      output: `No runs directory found: ${runsDir}`,
      changedFiles: [],
    };
  }

  const { files, changed } = sanitizeDir(runsDir, options);

  const lines = [];
  if (files.length === 0) {
    lines.push(`No files found in: ${runsDir}`);
  } else if (changed.length === 0) {
    lines.push(`Sanitized ${files.length} file(s) — no changes needed.`);
  } else {
    const dryRun = options.dryRun ? ' (dry-run)' : '';
    lines.push(`Sanitized${dryRun}: ${changed.length}/${files.length} file(s) changed.`);
    for (const f of changed) {
      lines.push(`  ${path.relative(projectRoot, f)}`);
    }
  }

  return {
    output: lines.join('\n'),
    changedFiles: changed,
  };
}

// ---------------------------------------------------------------------------
// CLI 진입점
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const runsArg = args.find(a => !a.startsWith('--'));

  const projectRoot = process.cwd();
  const opts = {
    dryRun,
    maskSession: true,
    runsDir: runsArg || undefined,
  };

  const { output } = sanitizeCommand(projectRoot, opts);
  process.stdout.write(output + '\n');
}

// ---------------------------------------------------------------------------
// 모듈 exports
// ---------------------------------------------------------------------------

module.exports = {
  SAFE_KEYS,
  maskHomePaths,
  maskApiKeys,
  maskSessionId,
  maskEnvVars,
  sanitizeText,
  sanitizeJson,
  sanitizeMarkdown,
  parseFrontmatter,
  sanitizeFile,
  sanitizeDir,
  sanitizeCommand,
};
