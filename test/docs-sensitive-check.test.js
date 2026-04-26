#!/usr/bin/env node
/**
 * test/docs-sensitive-check.test.js
 *
 * docs/ 와 kg/ 공개 파일에 private identifier 후보가 없는지 점검한다.
 *
 * 검사 대상:
 *   - docs/**\/*.md
 *   - kg/**\/*.md
 *
 * 검사 패턴:
 *   - sk-ant-*, sk-proj-*, sk- 형식 API 키
 *   - ghp_ GitHub 토큰
 *   - ANTHROPIC_API_KEY=<실제값>, OPENAI_API_KEY=<실제값> (플레이스홀더/[REDACTED]는 허용)
 *   - /Users/<name>/ 또는 /home/<name>/ 실제 홈 경로
 *   - Telegram bot token 형식 (숫자:문자열)
 *
 * 외부 npm 패키지 없음. Node.js fs/path만 사용.
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// 테스트 러너
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// 파일 수집
// ---------------------------------------------------------------------------

/**
 * 디렉토리를 재귀적으로 스캔해 .md 파일 목록을 반환한다.
 * @param {string} dir
 * @returns {string[]}
 */
function collectMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        result.push(full);
      }
    }
  }
  walk(dir);
  return result;
}

// ---------------------------------------------------------------------------
// 민감 패턴 정의
// ---------------------------------------------------------------------------

const SENSITIVE_PATTERNS = [
  {
    name: 'API 키 (sk-ant-*, sk-proj-*, sk- 형식)',
    // [REDACTED_KEY] 또는 플레이스홀더(<...>, xxx, ***) 형태는 제외
    regex: /\b(sk-ant-[A-Za-z0-9_-]{10,}|sk-proj-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{20,})\b/,
    // 예시/플레이스홀더로 보이는 경우 제외
    isPlaceholder: (match) => /x{3,}|\*{3,}|<[^>]+>|\[REDACTED/.test(match),
  },
  {
    name: 'GitHub 토큰 (ghp_)',
    regex: /ghp_[A-Za-z0-9]{36}/,
    isPlaceholder: (match) => /x{3,}|\*{3,}|<[^>]+>|\[REDACTED/.test(match),
  },
  {
    name: '민감 환경변수 실제 값 (ANTHROPIC_API_KEY=, OPENAI_API_KEY= 등)',
    // 값이 [REDACTED], <...>, xxx, 또는 $VAR 형태가 아닌 경우만 감지
    regex: /\b(ANTHROPIC_API_KEY|OPENAI_API_KEY|CLAUDE_API_KEY|OPENAI_SECRET_KEY)\s*[=:]\s*(?!\[REDACTED\]|<[^>]+>|xxx|\$\{?[A-Z_]+\}?)\S{8,}/i,
    isPlaceholder: () => false,
  },
  {
    name: '실제 홈 경로 (/Users/<name>/ 또는 /home/<name>/)',
    // 예시/테스트 fixture 이름은 허용 (alice, ubuntu, gin 등 테스트용 이름)
    regex: /\/(?:Users|home)\/(?!alice|ubuntu|user|username|your-name|example|gin|bob|john|test|demo|<[^/]+>)[^/\s"'`]{3,}\//,
    isPlaceholder: (match) => /<[^>]+>/.test(match),
  },
  {
    name: 'Telegram bot token (숫자:문자35자)',
    regex: /\b\d{7,12}:[A-Za-z0-9_-]{35,36}\b/,
    isPlaceholder: (match) => /x{3,}|\*{3,}|\[REDACTED/.test(match),
  },
];

// ---------------------------------------------------------------------------
// 스캔 함수
// ---------------------------------------------------------------------------

/**
 * 파일 내용에서 민감 패턴을 탐지한다.
 * @param {string} filePath
 * @returns {{ pattern: string, line: number, snippet: string }[]}
 */
function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines   = content.split('\n');
  const findings = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pat of SENSITIVE_PATTERNS) {
      const match = pat.regex.exec(line);
      if (!match) continue;
      if (pat.isPlaceholder && pat.isPlaceholder(match[0])) continue;
      findings.push({
        pattern: pat.name,
        line:    i + 1,
        snippet: line.trim().slice(0, 120),
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// 테스트 실행
// ---------------------------------------------------------------------------

const docsDir = path.join(ROOT, 'docs');
const kgDir   = path.join(ROOT, 'kg');

const docsFiles = collectMarkdownFiles(docsDir);
const kgFiles   = collectMarkdownFiles(kgDir);
const allFiles  = [...docsFiles, ...kgFiles];

console.log(`\n[docs/kg 민감정보 점검]`);
console.log(`  대상 파일 수: ${allFiles.length} (docs: ${docsFiles.length}, kg: ${kgFiles.length})`);

test(`대상 파일이 존재한다 (docs + kg 최소 1개 이상)`, () => {
  assert.ok(allFiles.length > 0, '검사 대상 파일이 없습니다');
});

const allFindings = [];

for (const filePath of allFiles) {
  const relPath  = path.relative(ROOT, filePath);
  const findings = scanFile(filePath);
  if (findings.length > 0) {
    allFindings.push({ file: relPath, findings });
  }
}

test('docs/ 파일에 API 키·토큰·실제 홈 경로 후보가 없다', () => {
  const docFindings = allFindings.filter((f) => f.file.startsWith('docs/'));
  if (docFindings.length > 0) {
    const detail = docFindings.map((f) =>
      `${f.file}: ` + f.findings.map((g) => `[${g.pattern}] line ${g.line}: ${g.snippet}`).join('; ')
    ).join('\n    ');
    assert.fail(`docs/ 파일에서 민감정보 후보 발견:\n    ${detail}`);
  }
});

test('kg/ 파일에 API 키·토큰·실제 홈 경로 후보가 없다', () => {
  const kgFindings = allFindings.filter((f) => f.file.startsWith('kg/'));
  if (kgFindings.length > 0) {
    const detail = kgFindings.map((f) =>
      `${f.file}: ` + f.findings.map((g) => `[${g.pattern}] line ${g.line}: ${g.snippet}`).join('; ')
    ).join('\n    ');
    assert.fail(`kg/ 파일에서 민감정보 후보 발견:\n    ${detail}`);
  }
});

// ---------------------------------------------------------------------------
// 스캐너 자체 검증 (fixture 기반)
// ---------------------------------------------------------------------------

console.log('\n[스캐너 fixture 검증]');

test('sk-ant- 키는 감지된다', () => {
  const findings = SENSITIVE_PATTERNS[0].regex.exec('api_key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
  assert.ok(findings !== null, 'sk-ant- 키가 감지되지 않음');
});

test('sk-proj- 키는 감지된다', () => {
  const findings = SENSITIVE_PATTERNS[0].regex.exec('key: sk-proj-abcdefghijklmnopqrstuvwxyz1234');
  assert.ok(findings !== null, 'sk-proj- 키가 감지되지 않음');
});

test('[REDACTED_KEY] 마스킹된 값은 감지하지 않는다', () => {
  const line = 'api_key: [REDACTED_KEY]';
  const docFindings = scanFile.__proto__ ? [] : [];  // scanFile은 파일 대상이므로 직접 패턴 검사
  const match = SENSITIVE_PATTERNS[0].regex.exec(line);
  assert.ok(match === null || SENSITIVE_PATTERNS[0].isPlaceholder(match[0]), '[REDACTED_KEY]가 감지됨');
});

test('ANTHROPIC_API_KEY=[REDACTED]는 허용한다', () => {
  const line = 'ANTHROPIC_API_KEY=[REDACTED]';
  const match = SENSITIVE_PATTERNS[2].regex.exec(line);
  assert.ok(match === null, '[REDACTED] 값이 감지됨');
});

test('ANTHROPIC_API_KEY=<your-key>는 허용한다', () => {
  const line = 'ANTHROPIC_API_KEY=<your-key-here>';
  const match = SENSITIVE_PATTERNS[2].regex.exec(line);
  assert.ok(match === null, '<your-key-here> 값이 감지됨');
});

test('실제 ANTHROPIC_API_KEY 값은 감지된다', () => {
  const line = 'ANTHROPIC_API_KEY=sk-ant-api03-realSecretValue12345';
  const match = SENSITIVE_PATTERNS[2].regex.exec(line);
  assert.ok(match !== null, '실제 값이 감지되지 않음');
});

test('Telegram bot token은 감지된다', () => {
  // 실제 Telegram bot token 형식: <10자리>:<35자 alphanumeric>
  const match = SENSITIVE_PATTERNS[4].regex.exec('token: 1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcde1234');
  assert.ok(match !== null, 'bot token이 감지되지 않음');
});

// ---------------------------------------------------------------------------
// 결과 출력
// ---------------------------------------------------------------------------

console.log(`\n결과: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
