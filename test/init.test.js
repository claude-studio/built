#!/usr/bin/env node
/**
 * test/init.test.js
 *
 * scripts/init.js 단위 테스트.
 * Node.js 내장 assert + fs + os만 사용 (외부 패키지 없음).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { init } = require('../scripts/init');

// ---------------------------------------------------------------------------
// 테스트 헬퍼
// ---------------------------------------------------------------------------

let tmpDirs = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'built-init-test-'));
  tmpDirs.push(dir);
  return dir;
}

function cleanup() {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }
  tmpDirs = [];
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// 테스트 스위트
// ---------------------------------------------------------------------------

console.log('\n[init.js 단위 테스트]\n');

// 1. 신규 초기화 — status
test('신규 프로젝트에 init() 실행 시 status === created 반환', () => {
  const root = makeTmpDir();
  const result = init(root);
  assert.strictEqual(result.status, 'created');
});

// 2. 신규 초기화 — paths 비어있지 않음
test('신규 초기화 시 paths 배열이 비어있지 않음', () => {
  const root = makeTmpDir();
  const result = init(root);
  assert.ok(result.paths.length > 0, 'paths가 비어있음');
});

// 3. .built/ 디렉토리 생성
test('.built/ 디렉토리가 생성됨', () => {
  const root = makeTmpDir();
  init(root);
  assert.ok(fs.existsSync(path.join(root, '.built')));
});

// 4. .built/context.md 생성
test('.built/context.md가 생성됨', () => {
  const root = makeTmpDir();
  init(root);
  assert.ok(fs.existsSync(path.join(root, '.built', 'context.md')));
});

// 5. .built/context.md frontmatter 포함
test('.built/context.md에 frontmatter(--- 블록)가 포함됨', () => {
  const root = makeTmpDir();
  init(root);
  const content = fs.readFileSync(path.join(root, '.built', 'context.md'), 'utf8');
  assert.ok(content.startsWith('---'), 'frontmatter 시작(---) 없음');
  assert.ok(content.includes('created_at:'), 'created_at 필드 없음');
});

// 6. .built/config.json 생성
test('.built/config.json이 생성됨', () => {
  const root = makeTmpDir();
  init(root);
  assert.ok(fs.existsSync(path.join(root, '.built', 'config.json')));
});

// 7. .built/config.json 파싱 가능
test('.built/config.json이 유효한 JSON임', () => {
  const root = makeTmpDir();
  init(root);
  const raw = fs.readFileSync(path.join(root, '.built', 'config.json'), 'utf8');
  const parsed = JSON.parse(raw);
  assert.ok(typeof parsed.version === 'number', 'version 필드 없음');
  assert.ok(typeof parsed.max_parallel === 'number', 'max_parallel 필드 없음');
  assert.ok(typeof parsed.default_model === 'string', 'default_model 필드 없음');
  assert.ok(typeof parsed.max_iterations === 'number', 'max_iterations 필드 없음');
  assert.ok(typeof parsed.cost_warn_usd === 'number', 'cost_warn_usd 필드 없음');
});

// 8. .built/hooks.json 생성
test('.built/hooks.json이 생성됨', () => {
  const root = makeTmpDir();
  init(root);
  assert.ok(fs.existsSync(path.join(root, '.built', 'hooks.json')));
});

// 9. .built/hooks.json 파싱 가능
test('.built/hooks.json이 유효한 JSON이고 pipeline 키를 가짐', () => {
  const root = makeTmpDir();
  init(root);
  const raw = fs.readFileSync(path.join(root, '.built', 'hooks.json'), 'utf8');
  const parsed = JSON.parse(raw);
  assert.ok('pipeline' in parsed, 'pipeline 키 없음');
});

// 10. .built/features-index.md 생성
test('.built/features-index.md가 생성됨', () => {
  const root = makeTmpDir();
  init(root);
  assert.ok(fs.existsSync(path.join(root, '.built', 'features-index.md')));
});

// 11. .built/hooks.local.json.example 생성
test('.built/hooks.local.json.example이 생성됨', () => {
  const root = makeTmpDir();
  init(root);
  assert.ok(fs.existsSync(path.join(root, '.built', 'hooks.local.json.example')));
});

// 12. 서브디렉토리 생성 확인
test('.built/{features,decisions,entities,patterns,runs,runtime}/ 가 모두 생성됨', () => {
  const root = makeTmpDir();
  init(root);
  for (const sub of ['features', 'decisions', 'entities', 'patterns', 'runs', 'runtime']) {
    assert.ok(
      fs.existsSync(path.join(root, '.built', sub)),
      `.built/${sub} 없음`
    );
  }
});

// 13. .claude/settings.json 생성
test('.claude/settings.json이 생성됨', () => {
  const root = makeTmpDir();
  init(root);
  assert.ok(fs.existsSync(path.join(root, '.claude', 'settings.json')));
});

// 14. .claude/settings.json 유효한 JSON
test('.claude/settings.json이 유효한 JSON임', () => {
  const root = makeTmpDir();
  init(root);
  const raw = fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8');
  const parsed = JSON.parse(raw);
  assert.ok(typeof parsed === 'object', 'object가 아님');
});

// 15. .claude/worktrees/ 디렉토리 생성
test('.claude/worktrees/ 디렉토리가 생성됨', () => {
  const root = makeTmpDir();
  init(root);
  assert.ok(fs.existsSync(path.join(root, '.claude', 'worktrees')));
});

// 16. .worktreeinclude 생성
test('.worktreeinclude가 생성됨', () => {
  const root = makeTmpDir();
  init(root);
  assert.ok(fs.existsSync(path.join(root, '.worktreeinclude')));
});

// 17. .gitignore 생성 또는 갱신
test('.gitignore가 생성되고 built 항목을 포함함', () => {
  const root = makeTmpDir();
  init(root);
  const gitignorePath = path.join(root, '.gitignore');
  assert.ok(fs.existsSync(gitignorePath), '.gitignore 없음');
  const content = fs.readFileSync(gitignorePath, 'utf8');
  assert.ok(content.includes('.claude/worktrees/'), '.claude/worktrees/ 항목 없음');
  assert.ok(content.includes('.built/runtime/'), '.built/runtime/ 항목 없음');
});

// 18. 기존 .gitignore에 append (덮어쓰지 않음)
test('기존 .gitignore가 있으면 내용 보존 후 built 항목 추가', () => {
  const root = makeTmpDir();
  const gitignorePath = path.join(root, '.gitignore');
  fs.writeFileSync(gitignorePath, 'node_modules/\ndist/\n', 'utf8');
  init(root);
  const content = fs.readFileSync(gitignorePath, 'utf8');
  assert.ok(content.includes('node_modules/'), '기존 항목이 사라짐');
  assert.ok(content.includes('dist/'), '기존 항목이 사라짐');
  assert.ok(content.includes('.built/runtime/'), 'built 항목 없음');
});

// 19. 멱등성 — 이미 초기화된 경우 status === already_initialized
test('이미 초기화된 프로젝트에 재실행 시 status === already_initialized', () => {
  const root = makeTmpDir();
  init(root);
  const result2 = init(root);
  assert.strictEqual(result2.status, 'already_initialized');
});

// 20. 멱등성 — 재실행 시 paths가 빈 배열
test('이미 초기화된 경우 재실행 시 paths가 빈 배열', () => {
  const root = makeTmpDir();
  init(root);
  const result2 = init(root);
  assert.deepStrictEqual(result2.paths, []);
});

// 21. 멱등성 — 기존 파일 덮어쓰지 않음
test('재실행 시 기존 context.md를 덮어쓰지 않음', () => {
  const root = makeTmpDir();
  init(root);
  const contextPath = path.join(root, '.built', 'context.md');
  fs.writeFileSync(contextPath, '# Custom Context\n', 'utf8');
  init(root);
  const content = fs.readFileSync(contextPath, 'utf8');
  assert.strictEqual(content, '# Custom Context\n', 'context.md가 덮어써짐');
});

// 22. 멱등성 — .gitignore 중복 추가 없음
test('재실행 시 .gitignore에 중복 항목이 추가되지 않음', () => {
  const root = makeTmpDir();
  init(root);
  init(root);
  const content = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  const lines = content.split('\n').filter((l) => l.trim() === '.built/runtime/');
  assert.strictEqual(lines.length, 1, '.built/runtime/ 항목이 중복됨: ' + lines.length + '회');
});

// 23. .built/config.local.json.example 생성
test('.built/config.local.json.example이 생성됨', () => {
  const root = makeTmpDir();
  init(root);
  assert.ok(fs.existsSync(path.join(root, '.built', 'config.local.json.example')));
});

// 24. config.local.json.example 내용 검증
test('.built/config.local.json.example에 worktree_location 필드가 포함됨', () => {
  const root = makeTmpDir();
  init(root);
  const raw = fs.readFileSync(path.join(root, '.built', 'config.local.json.example'), 'utf8');
  const parsed = JSON.parse(raw);
  assert.ok('worktree_location' in parsed, 'worktree_location 필드 없음');
  assert.ok(
    parsed.worktree_location === 'default' || parsed.worktree_location === 'sibling',
    `worktree_location 값이 올바르지 않음: ${parsed.worktree_location}`
  );
});

// 25. projectRoot 인수 생략 시 process.cwd() 사용
test('projectRoot 생략 시 process.cwd() 기준으로 init (smoke test)', () => {
  // 실제로 cwd에 .built를 만들면 안 되므로 임시 디렉토리로 cwd 우회
  const root = makeTmpDir();
  const origCwd = process.cwd();
  try {
    process.chdir(root);
    const result = init(); // projectRoot 생략
    assert.strictEqual(result.status, 'created');
    assert.ok(fs.existsSync(path.join(root, '.built', 'config.json')));
  } finally {
    process.chdir(origCwd);
  }
});

// ---------------------------------------------------------------------------
// 결과
// ---------------------------------------------------------------------------

cleanup();
console.log(`\n총 ${passed + failed}개 중 ${passed}개 통과, ${failed}개 실패\n`);
if (failed > 0) process.exit(1);
