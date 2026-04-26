#!/usr/bin/env node
/**
 * test/sanitize.test.js
 *
 * scripts/sanitize.js 단위 테스트.
 * Node.js 내장 assert + fs + os만 사용 (외부 패키지 없음).
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const {
  maskHomePaths,
  maskPrivatePaths,
  maskApiKeys,
  maskTelegramSecrets,
  maskNamedSecretFields,
  maskSessionId,
  maskEnvVars,
  sanitizeText,
  sanitizeJson,
  sanitizeMarkdown,
  parseFrontmatter,
  sanitizeFile,
  sanitizeDir,
  sanitizeCommand,
  SAFE_KEYS,
} = require('../scripts/sanitize');

// ---------------------------------------------------------------------------
// 테스트 헬퍼
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
let tmpDirs = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'built-sanitize-test-'));
  tmpDirs.push(dir);
  return dir;
}

function cleanup() {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  tmpDirs = [];
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// maskHomePaths 테스트
// ---------------------------------------------------------------------------

console.log('\nmaskHomePaths');

test('/Users/<name> 패턴 치환', () => {
  const input = 'path: /Users/gin/projects/app';
  const result = maskHomePaths(input);
  assert.ok(!result.includes('/Users/gin'), `홈 경로가 남아있음: ${result}`);
  assert.ok(result.includes('~/projects/app'), `~/로 치환되지 않음: ${result}`);
});

test('/home/<name> 패턴 치환', () => {
  const input = 'home: /home/ubuntu/workspace';
  const result = maskHomePaths(input);
  assert.ok(!result.includes('/home/ubuntu'), `홈 경로가 남아있음: ${result}`);
  assert.ok(result.includes('~/workspace'), `~/로 치환되지 않음: ${result}`);
});

test('실제 homedir 치환', () => {
  const homeDir = os.homedir();
  const input = `path: ${homeDir}/my-project/file.md`;
  const result = maskHomePaths(input);
  assert.ok(!result.includes(homeDir), `실제 홈 경로가 남아있음: ${result}`);
});

test('홈 경로 없는 텍스트는 그대로', () => {
  const input = 'no home path here, just /etc/config';
  const result = maskHomePaths(input);
  assert.strictEqual(result, input);
});

test('여러 홈 경로 동시 치환', () => {
  const input = '/Users/gin/a and /Users/gin/b';
  const result = maskHomePaths(input);
  assert.ok(!result.includes('/Users/gin'), `홈 경로가 남아있음: ${result}`);
});

// ---------------------------------------------------------------------------
// maskPrivatePaths 테스트
// ---------------------------------------------------------------------------

console.log('\nmaskPrivatePaths');

test('Multica workspace UUID path를 마스킹', () => {
  const input = 'path: ~/multica_workspaces/2ce97239-6237-460e-b450-3893ab82fbcb/6658612f/workdir/built';
  const result = maskPrivatePaths(input);
  assert.ok(!result.includes('2ce97239-6237-460e-b450-3893ab82fbcb'), `workspace UUID가 남아있음: ${result}`);
  assert.ok(result.includes('[REDACTED_WORKSPACE]'), `workspace 마스킹 토큰 없음: ${result}`);
});

test('workspace_id 값을 마스킹', () => {
  const input = 'workspace_id: 2ce97239-6237-460e-b450-3893ab82fbcb';
  const result = maskPrivatePaths(input);
  assert.ok(!result.includes('2ce97239-6237-460e-b450-3893ab82fbcb'), `workspace_id가 남아있음: ${result}`);
});

test('Codex local daemon path 후보를 마스킹', () => {
  const input = 'socket: ~/.codex/app-server/session-abc/socket.json';
  const result = maskPrivatePaths(input);
  assert.ok(!result.includes('session-abc'), `daemon path 상세가 남아있음: ${result}`);
  assert.ok(result.includes('~/.codex/[REDACTED]'), `daemon path 마스킹 실패: ${result}`);
});

// ---------------------------------------------------------------------------
// maskApiKeys 테스트
// ---------------------------------------------------------------------------

console.log('\nmaskApiKeys');

test('sk-ant-api03- 패턴 마스킹', () => {
  const key = 'sk-ant-api03-abc123xyz789ABCDEFGHIJ';
  const result = maskApiKeys(`API_KEY=${key}`);
  assert.ok(!result.includes(key), '키가 마스킹되지 않음');
  assert.ok(result.includes('[REDACTED]'), '[REDACTED]가 없음');
});

test('sk-proj- 패턴 마스킹', () => {
  const key = 'sk-proj-abcdefghijklmnopqrstuvwxyz1234';
  const result = maskApiKeys(`key: ${key}`);
  assert.ok(!result.includes(key), '키가 마스킹되지 않음');
  assert.ok(result.includes('[REDACTED]'), '[REDACTED]가 없음');
});

test('ghp_ 패턴 마스킹 (36자)', () => {
  const key = 'ghp_' + 'a'.repeat(36);
  const result = maskApiKeys(`token: ${key}`);
  assert.ok(!result.includes(key), '키가 마스킹되지 않음');
  assert.ok(result.includes('[REDACTED]'), '[REDACTED]가 없음');
});

test('짧은 sk- 패턴은 마스킹 안 함', () => {
  const input = 'key: sk-short'; // 20자 미만
  const result = maskApiKeys(input);
  assert.ok(result.includes('sk-short'), '짧은 sk- 패턴이 마스킹됨');
});

test('API 키 없는 텍스트는 그대로', () => {
  const input = 'no api keys here';
  const result = maskApiKeys(input);
  assert.strictEqual(result, input);
});

// ---------------------------------------------------------------------------
// Telegram/token 필드 테스트
// ---------------------------------------------------------------------------

console.log('\nmaskTelegramSecrets / maskNamedSecretFields');

test('Telegram bot token과 chat_id 마스킹', () => {
  const botToken = '1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi';
  const input = `bot=${botToken} chat_id=1234567890`;
  const result = maskTelegramSecrets(input);
  assert.ok(!result.includes(botToken), `bot token이 남아있음: ${result}`);
  assert.ok(!result.includes('1234567890'), `chat_id가 남아있음: ${result}`);
});

test('JSON/YAML token 필드 값을 마스킹', () => {
  const input = [
    '{"token": "plain-secret-token"}',
    'api_key: raw-api-key',
    'authorization=BearerSecret',
  ].join('\n');
  const result = maskNamedSecretFields(input);
  assert.ok(!result.includes('plain-secret-token'), `JSON token 값이 남아있음: ${result}`);
  assert.ok(!result.includes('raw-api-key'), `YAML api_key 값이 남아있음: ${result}`);
  assert.ok(!result.includes('BearerSecret'), `authorization 값이 남아있음: ${result}`);
});

// ---------------------------------------------------------------------------
// maskSessionId 테스트
// ---------------------------------------------------------------------------

console.log('\nmaskSessionId');

test('JSON 스타일 session_id 마스킹', () => {
  const input = '{"session_id": "abc-123-xyz"}';
  const result = maskSessionId(input);
  assert.ok(!result.includes('abc-123-xyz'), '세션 ID가 마스킹되지 않음');
  assert.ok(result.includes('[REDACTED]'), '[REDACTED]가 없음');
});

test('YAML frontmatter 스타일 session_id 마스킹', () => {
  const input = 'session_id: my-session-value';
  const result = maskSessionId(input);
  assert.ok(!result.includes('my-session-value'), '세션 ID가 마스킹되지 않음');
  assert.ok(result.includes('[REDACTED]'), '[REDACTED]가 없음');
});

test('key=value 스타일 session_id 마스킹', () => {
  const input = 'session_id=abc123';
  const result = maskSessionId(input);
  assert.ok(!result.includes('abc123'), '세션 ID가 마스킹되지 않음');
  assert.ok(result.includes('[REDACTED]'), '[REDACTED]가 없음');
});

test('session_id 없는 텍스트는 그대로', () => {
  const input = 'no session here';
  const result = maskSessionId(input);
  assert.strictEqual(result, input);
});

// ---------------------------------------------------------------------------
// maskEnvVars 테스트
// ---------------------------------------------------------------------------

console.log('\nmaskEnvVars');

test('SAFE_KEYS에 없는 환경변수 마스킹', () => {
  const input = 'SECRET_KEY=mysecret123';
  const result = maskEnvVars(input, SAFE_KEYS);
  assert.ok(!result.includes('mysecret123'), '환경변수 값이 마스킹되지 않음');
  assert.ok(result.includes('[REDACTED]'), '[REDACTED]가 없음');
});

test('SAFE_KEYS에 있는 환경변수는 유지', () => {
  const input = 'NODE_ENV=production';
  const result = maskEnvVars(input, SAFE_KEYS);
  assert.strictEqual(result, input, 'SAFE_KEYS 환경변수가 마스킹됨');
});

test('export 접두어 있는 환경변수 마스킹', () => {
  const input = 'export API_TOKEN=secret-value';
  const result = maskEnvVars(input, SAFE_KEYS);
  assert.ok(!result.includes('secret-value'), '환경변수 값이 마스킹되지 않음');
  assert.ok(result.includes('[REDACTED]'), '[REDACTED]가 없음');
});

test('이미 [REDACTED]인 환경변수는 그대로', () => {
  const input = 'SECRET_KEY=[REDACTED]';
  const result = maskEnvVars(input, SAFE_KEYS);
  assert.strictEqual(result, input, '이미 마스킹된 값이 이중으로 처리됨');
});

test('소문자 환경변수는 마스킹 안 함 (대문자만 대상)', () => {
  const input = 'some_key=value';
  const result = maskEnvVars(input, SAFE_KEYS);
  assert.strictEqual(result, input, '소문자 키가 마스킹됨');
});

// ---------------------------------------------------------------------------
// sanitizeText 통합 테스트
// ---------------------------------------------------------------------------

console.log('\nsanitizeText');

test('홈 경로 + API 키 동시 처리', () => {
  const homeDir = os.homedir();
  const apiKey = 'sk-ant-api03-' + 'x'.repeat(20);
  const input = `path: ${homeDir}/project, key: ${apiKey}`;
  const result = sanitizeText(input);
  assert.ok(!result.includes(homeDir), '홈 경로가 남아있음');
  assert.ok(!result.includes(apiKey), 'API 키가 남아있음');
});

test('private path + Telegram/chat id + token 필드 통합 처리', () => {
  const input = [
    'artifact: ~/multica_workspaces/2ce97239-6237-460e-b450-3893ab82fbcb/6658612f/workdir',
    'bot_token: 1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi',
    'chat_id: 1234567890',
    'token: raw-token-value',
  ].join('\n');
  const result = sanitizeText(input);
  assert.ok(!result.includes('2ce97239-6237-460e-b450-3893ab82fbcb'), `workspace UUID가 남아있음: ${result}`);
  assert.ok(!result.includes('1234567890:'), `bot token이 남아있음: ${result}`);
  assert.ok(!result.includes('raw-token-value'), `token 값이 남아있음: ${result}`);
});

test('maskSession: false 옵션 시 session_id 유지', () => {
  const input = 'session_id: my-session';
  const result = sanitizeText(input, { maskSession: false });
  assert.ok(result.includes('my-session'), 'session_id가 마스킹됨');
});

// ---------------------------------------------------------------------------
// sanitizeJson 테스트
// ---------------------------------------------------------------------------

console.log('\nsanitizeJson');

test('JSON 객체 값 마스킹', () => {
  const apiKey = 'sk-ant-api03-' + 'y'.repeat(20);
  const obj = { key: apiKey, safe: 'normal value' };
  const result = sanitizeJson(obj);
  assert.ok(!result.key.includes(apiKey), 'API 키가 마스킹되지 않음');
  assert.strictEqual(result.safe, 'normal value', '일반 값이 변경됨');
});

test('중첩 JSON 객체 처리', () => {
  const homeDir = os.homedir();
  const obj = { a: { b: { path: `${homeDir}/nested` } } };
  const result = sanitizeJson(obj);
  assert.ok(!result.a.b.path.includes(homeDir), '중첩 홈 경로가 마스킹되지 않음');
});

test('JSON 배열 처리', () => {
  const key = 'sk-ant-api03-' + 'z'.repeat(20);
  const arr = ['normal', key, 'also-normal'];
  const result = sanitizeJson(arr);
  assert.strictEqual(result[0], 'normal');
  assert.ok(!result[1].includes(key), 'API 키가 마스킹되지 않음');
  assert.strictEqual(result[2], 'also-normal');
});

test('JSON 키는 마스킹 안 함', () => {
  const obj = { 'sk-ant-api03-keyname': 'value' };
  const result = sanitizeJson(obj);
  assert.ok('sk-ant-api03-keyname' in result, '키가 마스킹됨');
});

test('민감 필드명은 값 패턴이 평범해도 마스킹', () => {
  const obj = {
    token: 'plain-token-value',
    authorization: 'Bearer plain',
    chat_id: 1234567890,
    nested: { api_key: 'plain-api-key' },
  };
  const result = sanitizeJson(obj);
  assert.strictEqual(result.token, '[REDACTED]');
  assert.strictEqual(result.authorization, '[REDACTED]');
  assert.strictEqual(result.chat_id, '[REDACTED]');
  assert.strictEqual(result.nested.api_key, '[REDACTED]');
});

test('null, number, boolean 값은 그대로', () => {
  const obj = { a: null, b: 42, c: true };
  const result = sanitizeJson(obj);
  assert.strictEqual(result.a, null);
  assert.strictEqual(result.b, 42);
  assert.strictEqual(result.c, true);
});

// ---------------------------------------------------------------------------
// parseFrontmatter 테스트
// ---------------------------------------------------------------------------

console.log('\nparseFrontmatter');

test('frontmatter 있는 Markdown 파싱', () => {
  const content = `---
title: Test
status: done
---

# Body content`;
  const { frontmatter, body, hasFrontmatter } = parseFrontmatter(content);
  assert.strictEqual(hasFrontmatter, true);
  assert.ok(frontmatter.includes('title: Test'), 'frontmatter 파싱 오류');
  assert.ok(body.includes('# Body content'), 'body 파싱 오류');
});

test('frontmatter 없는 Markdown 파싱', () => {
  const content = '# Just a body\n\nno frontmatter';
  const { hasFrontmatter, body } = parseFrontmatter(content);
  assert.strictEqual(hasFrontmatter, false);
  assert.strictEqual(body, content);
});

test('빈 frontmatter 처리', () => {
  const content = '---\n---\n\nbody here';
  const { hasFrontmatter } = parseFrontmatter(content);
  assert.strictEqual(hasFrontmatter, true);
});

// ---------------------------------------------------------------------------
// sanitizeMarkdown 테스트
// ---------------------------------------------------------------------------

console.log('\nsanitizeMarkdown');

test('frontmatter의 민감 정보 마스킹', () => {
  const apiKey = 'sk-ant-api03-' + 'f'.repeat(20);
  const content = `---
title: Test
api_key: ${apiKey}
---

# Body`;
  const result = sanitizeMarkdown(content);
  assert.ok(!result.includes(apiKey), 'frontmatter의 API 키가 마스킹되지 않음');
});

test('본문의 민감 정보 마스킹', () => {
  const homeDir = os.homedir();
  const content = `---
title: Test
---

작업 경로: ${homeDir}/myproject`;
  const result = sanitizeMarkdown(content);
  assert.ok(!result.includes(homeDir), '본문의 홈 경로가 마스킹되지 않음');
});

test('frontmatter + 본문 양쪽 동시 마스킹', () => {
  const homeDir = os.homedir();
  const apiKey = 'sk-ant-api03-' + 'g'.repeat(20);
  const content = `---
path: ${homeDir}/project
---

key: ${apiKey}`;
  const result = sanitizeMarkdown(content);
  assert.ok(!result.includes(homeDir), '홈 경로가 마스킹되지 않음');
  assert.ok(!result.includes(apiKey), 'API 키가 마스킹되지 않음');
});

test('frontmatter 없으면 전체 텍스트로 처리', () => {
  const key = 'sk-ant-api03-' + 'h'.repeat(20);
  const content = `# No frontmatter\nkey: ${key}`;
  const result = sanitizeMarkdown(content);
  assert.ok(!result.includes(key), 'API 키가 마스킹되지 않음');
});

// ---------------------------------------------------------------------------
// sanitizeFile 테스트
// ---------------------------------------------------------------------------

console.log('\nsanitizeFile');

test('Markdown 파일 sanitize', () => {
  const root = makeTmpDir();
  const homeDir = os.homedir();
  const filePath = path.join(root, 'do-result.md');
  writeFile(filePath, `# Result\n\npath: ${homeDir}/project`);

  const { changed } = sanitizeFile(filePath);
  assert.strictEqual(changed, true, '변경 감지 안 됨');
  const content = readFile(filePath);
  assert.ok(!content.includes(homeDir), '홈 경로가 마스킹되지 않음');
});

test('JSON 파일 sanitize', () => {
  const root = makeTmpDir();
  const key = 'sk-ant-api03-' + 'j'.repeat(20);
  const filePath = path.join(root, 'state.json');
  writeFile(filePath, JSON.stringify({ apiKey: key, status: 'done' }, null, 2) + '\n');

  const { changed } = sanitizeFile(filePath);
  assert.strictEqual(changed, true, '변경 감지 안 됨');
  const content = readFile(filePath);
  assert.ok(!content.includes(key), 'API 키가 마스킹되지 않음');
});

test('변경 없는 파일은 changed: false', () => {
  const root = makeTmpDir();
  const filePath = path.join(root, 'clean.md');
  writeFile(filePath, '# Clean file\n\nno sensitive data here');

  const { changed } = sanitizeFile(filePath);
  assert.strictEqual(changed, false, '변경 없는 파일이 changed: true');
});

test('dry-run 시 파일 실제 수정 안 함', () => {
  const root = makeTmpDir();
  const homeDir = os.homedir();
  const filePath = path.join(root, 'test.md');
  const original = `path: ${homeDir}/project`;
  writeFile(filePath, original);

  sanitizeFile(filePath, { dryRun: true });
  const content = readFile(filePath);
  assert.strictEqual(content, original, 'dry-run인데 파일이 수정됨');
});

test('존재하지 않는 파일 읽기 시 오류', () => {
  assert.throws(
    () => sanitizeFile('/nonexistent/path/file.md'),
    /파일 읽기 실패/
  );
});

// ---------------------------------------------------------------------------
// sanitizeDir 테스트
// ---------------------------------------------------------------------------

console.log('\nsanitizeDir');

test('디렉토리 재귀 스캔 + 변경 파일 목록 반환', () => {
  const root = makeTmpDir();
  const homeDir = os.homedir();
  const sub = path.join(root, 'feature-a');
  writeFile(path.join(sub, 'do-result.md'), `path: ${homeDir}/work`);
  writeFile(path.join(sub, 'state.json'), JSON.stringify({ status: 'done' }));
  writeFile(path.join(sub, 'clean.md'), 'clean content');

  const { files, changed } = sanitizeDir(root);
  assert.strictEqual(files.length, 3, `파일 수 오류: ${files.length}`);
  assert.strictEqual(changed.length, 1, `변경 파일 수 오류: ${changed.length}`);
});

test('존재하지 않는 디렉토리는 빈 결과', () => {
  const { files, changed } = sanitizeDir('/nonexistent/path/runs');
  assert.strictEqual(files.length, 0);
  assert.strictEqual(changed.length, 0);
});

test('md, json만 대상 — 다른 확장자 무시', () => {
  const root = makeTmpDir();
  const homeDir = os.homedir();
  writeFile(path.join(root, 'notes.txt'), `path: ${homeDir}/project`);
  writeFile(path.join(root, 'script.sh'), `HOME=${homeDir}`);

  const { files } = sanitizeDir(root);
  assert.strictEqual(files.length, 0, `.txt, .sh 파일이 포함됨`);
});

// ---------------------------------------------------------------------------
// sanitizeCommand 테스트
// ---------------------------------------------------------------------------

console.log('\nsanitizeCommand');

test('sanitizeCommand: runs 디렉토리 없으면 메시지 출력', () => {
  const root = makeTmpDir();
  const { output, changedFiles } = sanitizeCommand(root);
  assert.ok(output.includes('No runs directory found'), `메시지 오류: ${output}`);
  assert.strictEqual(changedFiles.length, 0);
});

test('sanitizeCommand: 변경 없으면 no changes 메시지', () => {
  const root = makeTmpDir();
  const runsDir = path.join(root, '.built', 'runs', 'feature-a');
  writeFile(path.join(runsDir, 'clean.md'), '# clean\n\nno sensitive info');

  const { output } = sanitizeCommand(root);
  assert.ok(output.includes('no changes needed'), `메시지 오류: ${output}`);
});

test('sanitizeCommand: 변경 파일 목록 출력', () => {
  const root = makeTmpDir();
  const homeDir = os.homedir();
  const runsDir = path.join(root, '.built', 'runs', 'feature-a');
  writeFile(path.join(runsDir, 'do-result.md'), `path: ${homeDir}/work`);

  const { output, changedFiles } = sanitizeCommand(root);
  assert.ok(output.includes('changed'), `메시지 오류: ${output}`);
  assert.strictEqual(changedFiles.length, 1);
});

test('sanitizeCommand: 커스텀 runsDir 옵션', () => {
  const root = makeTmpDir();
  const customDir = path.join(root, 'custom-runs');
  fs.mkdirSync(customDir, { recursive: true });
  writeFile(path.join(customDir, 'clean.md'), 'nothing to mask');

  const { output } = sanitizeCommand(root, { runsDir: 'custom-runs' });
  assert.ok(!output.includes('No runs directory found'), `커스텀 디렉토리를 찾지 못함: ${output}`);
});

test('sanitizeCommand: dry-run 옵션', () => {
  const root = makeTmpDir();
  const homeDir = os.homedir();
  const runsDir = path.join(root, '.built', 'runs', 'feature-a');
  const filePath = path.join(runsDir, 'do-result.md');
  const original = `path: ${homeDir}/work`;
  writeFile(filePath, original);

  const { changedFiles } = sanitizeCommand(root, { dryRun: true });
  assert.strictEqual(changedFiles.length, 1, 'dry-run에서 changedFiles가 반환되지 않음');
  const content = readFile(filePath);
  assert.strictEqual(content, original, 'dry-run인데 파일이 수정됨');
});

// ---------------------------------------------------------------------------
// 결과 출력
// ---------------------------------------------------------------------------

cleanup();

console.log('');
console.log(`총 ${passed + failed}개 중 ${passed}개 통과, ${failed}개 실패`);
if (failed > 0) {
  process.exit(1);
}
