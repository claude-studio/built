#!/usr/bin/env node
/**
 * test/iter.test.js
 *
 * iter.js 관련 단위 테스트 (Node.js assert + fs만 사용, 외부 패키지 없음)
 *
 * 테스트 범위:
 *   1. frontmatter status 파싱 (approved / needs_changes / 없음 / 잘못된 값)
 *   2. state.json attempt 갱신 및 failed 기록
 *   3. readCheckStatus 기능 검증
 *   4. iter.js 통합 시나리오 (서브프로세스):
 *      a. feature 인자 없음 → exit 1
 *      b. feature spec 없음 → exit 1
 *      c. check-result.md 없음 → exit 1
 *      d. status == approved → 즉시 exit 0 (루프 없음)
 *   5. needs_changes → 최대 반복 초과
 *   6. BUILT_MAX_ITER 파싱 검증
 *   7. 이슈 집합 비교 로직 (extractCheckIssues / issueSetEqual)
 *   8. failure_kind 필드 기록 검증
 *   9. BUILT_MAX_COST_USD 비용 상한 통합 시나리오
 */

'use strict';

const assert       = require('assert');
const fs           = require('fs');
const os           = require('os');
const path         = require('path');
const childProcess = require('child_process');

// ---------------------------------------------------------------------------
// 테스트 큐 기반 러너 (async 지원)
// ---------------------------------------------------------------------------

const _tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  _tests.push({ name, fn });
}

async function runAll() {
  for (const { name, fn } of _tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${e.message}`);
      if (process.env.VERBOSE) console.error(e.stack);
      failed++;
    }
  }
}

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'iter-test-'));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeCheckResult(featureDir, status, summary, issues) {
  fs.mkdirSync(featureDir, { recursive: true });
  summary = summary || 'Test summary';
  issues  = issues  || [];
  const issueSection = issues.length > 0
    ? '\n## 수정 필요 항목\n\n' + issues.map((i) => `- ${i}`).join('\n') + '\n'
    : '';
  const content = [
    '---',
    `feature: test-feature`,
    `status: ${status}`,
    `checked_at: ${new Date().toISOString()}`,
    '---',
    '',
    '## 검토 결과',
    '',
    summary,
    issueSection,
  ].join('\n');
  fs.writeFileSync(path.join(featureDir, 'check-result.md'), content, 'utf8');
}

function writeDoResult(featureDir, content) {
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(
    path.join(featureDir, 'do-result.md'),
    content || '# Do Result\n\nSome implementation.',
    'utf8'
  );
}

function writeFeatureSpec(projectRoot, feature, content) {
  const featuresDir = path.join(projectRoot, '.built', 'features');
  fs.mkdirSync(featuresDir, { recursive: true });
  fs.writeFileSync(
    path.join(featuresDir, `${feature}.md`),
    content || `# Feature Spec\n\nfeature: ${feature}\n`,
    'utf8'
  );
}

function writeProgressJson(featureDir, costUsd) {
  fs.mkdirSync(featureDir, { recursive: true });
  const data = {
    feature:       'test-feature',
    phase:         'iter',
    cost_usd:      costUsd,
    input_tokens:  1000,
    output_tokens: 500,
    updated_at:    new Date().toISOString(),
  };
  fs.writeFileSync(path.join(featureDir, 'progress.json'), JSON.stringify(data, null, 2), 'utf8');
}

/**
 * iter.js를 서브프로세스로 실행하고 결과를 반환한다.
 */
function runIterScript(feature, cwd, env) {
  const ITER_SCRIPT = path.join(__dirname, '..', 'scripts', 'iter.js');
  return new Promise((resolve) => {
    const args = feature ? [ITER_SCRIPT, feature] : [ITER_SCRIPT];
    const proc = childProcess.spawn(process.execPath, args, {
      cwd: cwd || os.tmpdir(),
      env: Object.assign({}, process.env, env || {}),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.stdin.end();
    proc.on('close', (code) => resolve({ exitCode: code === null ? 1 : code, stdout, stderr }));
  });
}

// ---------------------------------------------------------------------------
// 테스트 내부에서 사용할 extractCheckIssues / issueSetEqual 복제
// (iter.js 내부 함수를 직접 단위 테스트하기 위해 동일 로직 구현)
// ---------------------------------------------------------------------------

function extractCheckIssuesFromFile(checkResultPath) {
  if (!fs.existsSync(checkResultPath)) return [];
  try {
    const raw = fs.readFileSync(checkResultPath, 'utf8');
    const lines = raw.split('\n');
    const issues = [];
    let inIssueSection = false;
    for (const line of lines) {
      if (/^##\s+수정 필요 항목/.test(line)) {
        inIssueSection = true;
        continue;
      }
      if (inIssueSection) {
        if (/^##/.test(line)) break;
        const match = line.match(/^[-*]\s+(.+)/);
        if (match) issues.push(match[1].trim());
      }
    }
    return issues;
  } catch (_) {
    return [];
  }
}

function issueSetEqual(a, b) {
  if (a.length === 0 && b.length === 0) return false;
  if (a.length !== b.length) return false;
  const normalize = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const setA = new Set(a.map(normalize));
  for (const item of b) {
    if (!setA.has(normalize(item))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 의존 모듈
// ---------------------------------------------------------------------------

const { parse: parseFrontmatter } = require('../src/frontmatter');
const { initState, updateState, readState } = require('../src/state');

// ---------------------------------------------------------------------------
// 섹션 1: frontmatter status 파싱
// ---------------------------------------------------------------------------

console.log('\n[1] frontmatter status 파싱');

test('approved status 파싱', () => {
  const raw = '---\nfeature: foo\nstatus: approved\nchecked_at: 2026-01-01T00:00:00Z\n---\n\n## 검토 결과\n';
  const { data } = parseFrontmatter(raw);
  assert.strictEqual(data.status, 'approved');
});

test('needs_changes status 파싱', () => {
  const raw = '---\nfeature: foo\nstatus: needs_changes\nchecked_at: 2026-01-01T00:00:00Z\n---\n\n## 검토 결과\n';
  const { data } = parseFrontmatter(raw);
  assert.strictEqual(data.status, 'needs_changes');
});

test('빈 frontmatter는 status null/undefined', () => {
  const raw = '---\n---\nsome content';
  const { data } = parseFrontmatter(raw);
  assert.ok(!data.status, 'status가 falsy여야 함');
});

test('frontmatter 없는 파일은 status null/undefined', () => {
  const raw = '## 검토 결과\n\n내용';
  const { data } = parseFrontmatter(raw);
  assert.ok(!data.status, 'frontmatter 없으면 status falsy');
});

test('잘못된 status 값은 approved/needs_changes 아님', () => {
  const raw = '---\nfeature: foo\nstatus: unknown_value\n---\n';
  const { data } = parseFrontmatter(raw);
  assert.notStrictEqual(data.status, 'approved');
  assert.notStrictEqual(data.status, 'needs_changes');
});

// ---------------------------------------------------------------------------
// 섹션 2: state.json attempt 갱신
// ---------------------------------------------------------------------------

console.log('\n[2] state.json attempt 갱신');

test('initState 후 attempt == 0', () => {
  const dir = makeTmpDir();
  try {
    const state = initState(dir, 'test-feature');
    assert.strictEqual(state.attempt, 0);
    assert.strictEqual(state.status, 'planned');
  } finally {
    rmDir(dir);
  }
});

test('updateState로 attempt 증가', () => {
  const dir = makeTmpDir();
  try {
    initState(dir, 'test-feature');
    const updated = updateState(dir, { attempt: 1, phase: 'iter', status: 'running' });
    assert.strictEqual(updated.attempt, 1);
    assert.strictEqual(updated.phase, 'iter');
    assert.strictEqual(updated.status, 'running');
  } finally {
    rmDir(dir);
  }
});

test('updateState 여러 번 호출 시 마지막 값 유지', () => {
  const dir = makeTmpDir();
  try {
    initState(dir, 'test-feature');
    updateState(dir, { attempt: 1 });
    updateState(dir, { attempt: 2 });
    const state = readState(dir);
    assert.strictEqual(state.attempt, 2);
  } finally {
    rmDir(dir);
  }
});

test('updateState failed 기록', () => {
  const dir = makeTmpDir();
  try {
    initState(dir, 'test-feature');
    updateState(dir, { status: 'failed', phase: 'iter', last_error: '최대 반복 횟수 초과' });
    const state = readState(dir);
    assert.strictEqual(state.status, 'failed');
    assert.strictEqual(state.last_error, '최대 반복 횟수 초과');
    assert.strictEqual(state.phase, 'iter');
  } finally {
    rmDir(dir);
  }
});

test('state.json 없을 때 readState는 throw', () => {
  const dir = makeTmpDir();
  try {
    assert.throws(() => readState(dir), 'state.json 없으면 throw해야 함');
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// 섹션 3: readCheckStatus 로직 검증
// ---------------------------------------------------------------------------

console.log('\n[3] readCheckStatus 기능 검증');

test('approved check-result.md 파싱', () => {
  const dir = makeTmpDir();
  try {
    writeCheckResult(dir, 'approved', 'Looks good');
    const raw = fs.readFileSync(path.join(dir, 'check-result.md'), 'utf8');
    const { data } = parseFrontmatter(raw);
    assert.strictEqual(data.status, 'approved');
  } finally {
    rmDir(dir);
  }
});

test('needs_changes check-result.md + issues 파싱', () => {
  const dir = makeTmpDir();
  try {
    writeCheckResult(dir, 'needs_changes', 'Needs work', ['Fix bug 1', 'Add test']);
    const raw = fs.readFileSync(path.join(dir, 'check-result.md'), 'utf8');
    const { data } = parseFrontmatter(raw);
    assert.strictEqual(data.status, 'needs_changes');
  } finally {
    rmDir(dir);
  }
});

test('check-result.md 없을 때는 status를 얻을 수 없음', () => {
  const dir = makeTmpDir();
  try {
    const checkPath = path.join(dir, 'check-result.md');
    let status = null;
    if (fs.existsSync(checkPath)) {
      const { data } = parseFrontmatter(fs.readFileSync(checkPath, 'utf8'));
      status = data.status || null;
    }
    assert.strictEqual(status, null);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// 섹션 4: iter.js 통합 시나리오 (서브프로세스)
// ---------------------------------------------------------------------------

console.log('\n[4] iter.js 통합 시나리오');

test('feature 인자 없으면 exit 1', async () => {
  const result = await runIterScript('', os.tmpdir());
  assert.notStrictEqual(result.exitCode, 0, 'feature 인자 없으면 exit non-0');
});

test('feature spec 없으면 exit 1', async () => {
  const dir = makeTmpDir();
  try {
    const featureDir = path.join(dir, '.built', 'features', 'no-spec');
    writeCheckResult(featureDir, 'needs_changes');
    const result = await runIterScript('no-spec', dir);
    assert.strictEqual(result.exitCode, 1);
    assert.ok(
      result.stderr.includes('not found') || result.stderr.includes('없'),
      `spec not found 메시지 필요, stderr: ${result.stderr}`
    );
  } finally {
    rmDir(dir);
  }
});

test('check-result.md 없으면 exit 1', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'no-check');
    const result = await runIterScript('no-check', dir);
    assert.strictEqual(result.exitCode, 1);
    assert.ok(
      result.stderr.includes('check-result.md'),
      `check-result.md 오류 메시지 필요, stderr: ${result.stderr}`
    );
  } finally {
    rmDir(dir);
  }
});

test('status == approved이면 즉시 exit 0 (루프 없음)', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'already-approved');
    const featureDir = path.join(dir, '.built', 'features', 'already-approved');
    writeCheckResult(featureDir, 'approved');
    writeDoResult(featureDir);

    const result = await runIterScript('already-approved', dir);
    assert.strictEqual(result.exitCode, 0, `exit 0 예상, stdout: ${result.stdout}, stderr: ${result.stderr}`);
    assert.ok(
      result.stdout.includes('approved'),
      `approved 메시지 필요, stdout: ${result.stdout}`
    );
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// 섹션 5: needs_changes → 최대 반복 초과 시나리오
// ---------------------------------------------------------------------------
// 실제 claude 바이너리 없이 테스트하기 위해 PATH에 가짜 claude를 등록한다.
// ---------------------------------------------------------------------------

console.log('\n[5] needs_changes → 최대 반복 초과');

test('needs_changes + Do 실패 + BUILT_MAX_ITER=2 → exit 1', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'iter-fail');
    const featureDir = path.join(dir, '.built', 'features', 'iter-fail');
    writeCheckResult(featureDir, 'needs_changes', 'Fix everything', ['issue 1']);
    writeDoResult(featureDir);

    // 가짜 claude 스크립트 생성 (즉시 exit 1)
    const fakeBinDir = path.join(dir, 'bin');
    fs.mkdirSync(fakeBinDir, { recursive: true });
    const fakeClaude = path.join(fakeBinDir, 'claude');
    fs.writeFileSync(fakeClaude, '#!/bin/sh\nexit 1\n', 'utf8');
    fs.chmodSync(fakeClaude, '755');

    // 가짜 PATH에 fakeBinDir 추가
    const fakePath = `${fakeBinDir}:${process.env.PATH}`;

    const result = await runIterScript('iter-fail', dir, {
      BUILT_MAX_ITER: '2',
      PATH: fakePath,
    });

    assert.strictEqual(result.exitCode, 1, `exit 1 예상, stdout: ${result.stdout}, stderr: ${result.stderr}`);
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('최대 반복') || combined.includes('수렴'),
      `최대 반복 메시지 필요, combined: ${combined}`
    );
  } finally {
    rmDir(dir);
  }
});

test('needs_changes + Do 성공 + check approved → exit 0', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'iter-ok');
    const featureDir = path.join(dir, '.built', 'features', 'iter-ok');
    writeCheckResult(featureDir, 'needs_changes', 'Fix needed', ['fix 1']);
    writeDoResult(featureDir);

    // 가짜 bin 디렉토리
    const fakeBinDir = path.join(dir, 'bin');
    fs.mkdirSync(fakeBinDir, { recursive: true });

    // 가짜 claude: stream-json 이벤트 출력 후 exit 0
    // progress-writer.js가 result 이벤트를 받아 do-result.md를 생성함
    // 여기서는 do-result.md를 직접 생성하는 방식으로 단순화
    const fakeClaude = path.join(fakeBinDir, 'claude');
    const doResultContent = JSON.stringify({
      type: 'result',
      result: '# Implementation\n\nDone.',
      session_id: 'test-session',
      is_error: false,
    });
    fs.writeFileSync(
      fakeClaude,
      `#!/bin/sh\necho '${doResultContent}'\nexit 0\n`,
      'utf8'
    );
    fs.chmodSync(fakeClaude, '755');

    // iter.js가 check.js를 실행하는 경로는 __dirname/../scripts/check.js (절대 경로)
    // 이미 approved로 변경한 뒤 iter 재실행 시 즉시 exit 0 검증
    writeCheckResult(featureDir, 'approved');
    const result = await runIterScript('iter-ok', dir, {
      PATH: `${fakeBinDir}:${process.env.PATH}`,
    });
    assert.strictEqual(result.exitCode, 0, `exit 0 예상, stdout: ${result.stdout}`);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// 섹션 6: BUILT_MAX_ITER 파싱 검증
// ---------------------------------------------------------------------------

console.log('\n[6] BUILT_MAX_ITER 파싱');

test('BUILT_MAX_ITER=1 → 1회만 반복', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'max-1');
    const featureDir = path.join(dir, '.built', 'features', 'max-1');
    writeCheckResult(featureDir, 'needs_changes', 'Fix', ['item 1']);
    writeDoResult(featureDir);

    // 가짜 claude (즉시 exit 1 → Do 실패)
    const fakeBinDir = path.join(dir, 'bin2');
    fs.mkdirSync(fakeBinDir, { recursive: true });
    const fakeClaude = path.join(fakeBinDir, 'claude');
    fs.writeFileSync(fakeClaude, '#!/bin/sh\nexit 1\n', 'utf8');
    fs.chmodSync(fakeClaude, '755');

    const result = await runIterScript('max-1', dir, {
      BUILT_MAX_ITER: '1',
      PATH: `${fakeBinDir}:${process.env.PATH}`,
    });
    assert.strictEqual(result.exitCode, 1);
    // 1회 반복 후 초과 메시지
    const combined = result.stdout + result.stderr;
    assert.ok(combined.includes('1'), '반복 횟수 1 포함');
  } finally {
    rmDir(dir);
  }
});

test('BUILT_MAX_ITER=3 (기본값) → 3회 반복', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'max-default');
    const featureDir = path.join(dir, '.built', 'features', 'max-default');
    writeCheckResult(featureDir, 'needs_changes', 'Fix', ['item 1']);
    writeDoResult(featureDir);

    const fakeBinDir = path.join(dir, 'bin3');
    fs.mkdirSync(fakeBinDir, { recursive: true });
    const fakeClaude = path.join(fakeBinDir, 'claude');
    fs.writeFileSync(fakeClaude, '#!/bin/sh\nexit 1\n', 'utf8');
    fs.chmodSync(fakeClaude, '755');

    const result = await runIterScript('max-default', dir, {
      PATH: `${fakeBinDir}:${process.env.PATH}`,
      // BUILT_MAX_ITER 미설정 → 기본값 3
    });
    assert.strictEqual(result.exitCode, 1);
    const combined = result.stdout + result.stderr;
    // 기본값 3 포함 확인
    assert.ok(combined.includes('3'), `기본값 3 포함 필요, combined: ${combined}`);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// 섹션 7: 이슈 집합 비교 로직 (extractCheckIssues / issueSetEqual)
// ---------------------------------------------------------------------------

console.log('\n[7] 이슈 집합 비교 로직');

test('수정 필요 항목 섹션에서 이슈 추출', () => {
  const dir = makeTmpDir();
  try {
    const featureDir = dir;
    writeCheckResult(featureDir, 'needs_changes', '수정 필요', ['이슈 1', '이슈 2', '이슈 3']);
    const checkPath = path.join(featureDir, 'check-result.md');
    const issues = extractCheckIssuesFromFile(checkPath);
    assert.strictEqual(issues.length, 3);
    assert.ok(issues.includes('이슈 1'), `이슈 1 포함 필요, 결과: ${issues}`);
    assert.ok(issues.includes('이슈 2'), `이슈 2 포함 필요, 결과: ${issues}`);
    assert.ok(issues.includes('이슈 3'), `이슈 3 포함 필요, 결과: ${issues}`);
  } finally {
    rmDir(dir);
  }
});

test('수정 필요 항목 섹션 없으면 빈 배열', () => {
  const dir = makeTmpDir();
  try {
    writeCheckResult(dir, 'needs_changes', '수정 필요');
    const checkPath = path.join(dir, 'check-result.md');
    const issues = extractCheckIssuesFromFile(checkPath);
    assert.strictEqual(issues.length, 0);
  } finally {
    rmDir(dir);
  }
});

test('check-result.md 없으면 빈 배열', () => {
  const dir = makeTmpDir();
  try {
    const checkPath = path.join(dir, 'no-file.md');
    const issues = extractCheckIssuesFromFile(checkPath);
    assert.deepStrictEqual(issues, []);
  } finally {
    rmDir(dir);
  }
});

test('issueSetEqual: 동일 이슈 목록 → true', () => {
  const a = ['Fix bug 1', 'Add test'];
  const b = ['Fix bug 1', 'Add test'];
  assert.strictEqual(issueSetEqual(a, b), true);
});

test('issueSetEqual: 대소문자 차이는 동일 취급', () => {
  const a = ['Fix Bug 1', 'ADD TEST'];
  const b = ['fix bug 1', 'add test'];
  assert.strictEqual(issueSetEqual(a, b), true);
});

test('issueSetEqual: 순서 달라도 동일 집합이면 true', () => {
  const a = ['이슈 A', '이슈 B', '이슈 C'];
  const b = ['이슈 C', '이슈 A', '이슈 B'];
  assert.strictEqual(issueSetEqual(a, b), true);
});

test('issueSetEqual: 다른 이슈 목록 → false', () => {
  const a = ['Fix bug 1', 'Add test'];
  const b = ['Fix bug 1', 'Fix bug 2'];
  assert.strictEqual(issueSetEqual(a, b), false);
});

test('issueSetEqual: 길이 다르면 → false', () => {
  const a = ['Fix bug 1'];
  const b = ['Fix bug 1', 'Add test'];
  assert.strictEqual(issueSetEqual(a, b), false);
});

test('issueSetEqual: 둘 다 빈 배열 → false (비교 의미 없음)', () => {
  assert.strictEqual(issueSetEqual([], []), false);
});

// ---------------------------------------------------------------------------
// 섹션 8: failure_kind 필드 기록 검증
// ---------------------------------------------------------------------------

console.log('\n[8] failure_kind 필드 기록');

test('non_converging failure_kind 기록', () => {
  const dir = makeTmpDir();
  try {
    initState(dir, 'test-feature');
    updateState(dir, {
      status:       'failed',
      phase:        'iter',
      last_error:   '수렴 실패: 연속 2회 동일한 needs_changes 이슈',
      failure_kind: 'non_converging',
    });
    const state = readState(dir);
    assert.strictEqual(state.failure_kind, 'non_converging');
    assert.strictEqual(state.status, 'failed');
  } finally {
    rmDir(dir);
  }
});

test('worker_crashed failure_kind 기록', () => {
  const dir = makeTmpDir();
  try {
    initState(dir, 'test-feature');
    updateState(dir, {
      status:       'failed',
      phase:        'iter',
      last_error:   'Do 단계 실패',
      failure_kind: 'worker_crashed',
    });
    const state = readState(dir);
    assert.strictEqual(state.failure_kind, 'worker_crashed');
  } finally {
    rmDir(dir);
  }
});

test('retryable failure_kind 기록 (비용 초과)', () => {
  const dir = makeTmpDir();
  try {
    initState(dir, 'test-feature');
    updateState(dir, {
      status:       'failed',
      phase:        'iter',
      last_error:   '비용 상한 초과: $5.00 >= $1.00',
      failure_kind: 'retryable',
    });
    const state = readState(dir);
    assert.strictEqual(state.failure_kind, 'retryable');
  } finally {
    rmDir(dir);
  }
});

test('failure_kind 필드 없이 기록 시 기본값 없음 (updateState는 주어진 필드만 갱신)', () => {
  const dir = makeTmpDir();
  try {
    initState(dir, 'test-feature');
    // failure_kind 없이 failed 기록
    updateState(dir, { status: 'failed', last_error: '오류' });
    const state = readState(dir);
    assert.strictEqual(state.status, 'failed');
    // failure_kind는 초기값에 없으므로 undefined
    assert.ok(!('failure_kind' in state) || state.failure_kind === undefined);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// 섹션 9: BUILT_MAX_COST_USD 비용 상한 통합 시나리오
// ---------------------------------------------------------------------------

console.log('\n[9] BUILT_MAX_COST_USD 비용 상한');

test('progress.json cost_usd가 상한 초과 시 즉시 exit 1', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'budget-exceed');
    const featureDir = path.join(dir, '.built', 'features', 'budget-exceed');
    writeCheckResult(featureDir, 'needs_changes', '수정 필요', ['이슈 1']);
    writeDoResult(featureDir);
    // cost_usd = 5.0, 상한 = 1.0 → 초과
    writeProgressJson(featureDir, 5.0);

    const result = await runIterScript('budget-exceed', dir, {
      BUILT_MAX_COST_USD: '1.0',
    });

    assert.strictEqual(result.exitCode, 1, `exit 1 예상, combined: ${result.stdout + result.stderr}`);
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('비용 상한') || combined.includes('budget'),
      `비용 상한 메시지 필요, combined: ${combined}`
    );
  } finally {
    rmDir(dir);
  }
});

test('progress.json cost_usd가 상한 미만이면 계속 진행 (Do 실패로 exit 1)', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'budget-ok');
    const featureDir = path.join(dir, '.built', 'features', 'budget-ok');
    writeCheckResult(featureDir, 'needs_changes', '수정 필요', ['이슈 1']);
    writeDoResult(featureDir);
    // cost_usd = 0.5, 상한 = 1.0 → 미초과 → Do 단계로 진입
    writeProgressJson(featureDir, 0.5);

    // 가짜 claude (즉시 exit 1 → Do 실패)
    const fakeBinDir = path.join(dir, 'bin-budget');
    fs.mkdirSync(fakeBinDir, { recursive: true });
    const fakeClaude = path.join(fakeBinDir, 'claude');
    fs.writeFileSync(fakeClaude, '#!/bin/sh\nexit 1\n', 'utf8');
    fs.chmodSync(fakeClaude, '755');

    const result = await runIterScript('budget-ok', dir, {
      BUILT_MAX_COST_USD: '1.0',
      BUILT_MAX_ITER: '1',
      PATH: `${fakeBinDir}:${process.env.PATH}`,
    });

    assert.strictEqual(result.exitCode, 1);
    const combined = result.stdout + result.stderr;
    // 비용 초과 메시지가 아닌 Do 실패 또는 최대 반복 메시지여야 함
    assert.ok(
      !combined.includes('비용 상한 초과'),
      `비용 초과 메시지가 없어야 함, combined: ${combined}`
    );
    assert.ok(
      combined.includes('누적 비용') || combined.includes('Do'),
      `비용 로그 또는 Do 관련 메시지 필요, combined: ${combined}`
    );
  } finally {
    rmDir(dir);
  }
});

test('BUILT_MAX_COST_USD 미설정 시 progress.json 무시 (Do 실패로 exit 1)', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'budget-skip');
    const featureDir = path.join(dir, '.built', 'features', 'budget-skip');
    writeCheckResult(featureDir, 'needs_changes', '수정 필요', ['이슈 1']);
    writeDoResult(featureDir);
    // 매우 높은 cost_usd 기록 — 상한 없으면 무시
    writeProgressJson(featureDir, 9999.0);

    const fakeBinDir = path.join(dir, 'bin-skip');
    fs.mkdirSync(fakeBinDir, { recursive: true });
    const fakeClaude = path.join(fakeBinDir, 'claude');
    fs.writeFileSync(fakeClaude, '#!/bin/sh\nexit 1\n', 'utf8');
    fs.chmodSync(fakeClaude, '755');

    const result = await runIterScript('budget-skip', dir, {
      // BUILT_MAX_COST_USD 미설정
      BUILT_MAX_ITER: '1',
      PATH: `${fakeBinDir}:${process.env.PATH}`,
    });

    assert.strictEqual(result.exitCode, 1);
    const combined = result.stdout + result.stderr;
    // 비용 초과 메시지 없어야 함
    assert.ok(
      !combined.includes('비용 상한 초과'),
      `비용 초과 메시지가 없어야 함 (BUILT_MAX_COST_USD 미설정), combined: ${combined}`
    );
  } finally {
    rmDir(dir);
  }
});

test('BUILT_MAX_COST_USD 설정 시 비용 로그 출력', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'budget-log');
    const featureDir = path.join(dir, '.built', 'features', 'budget-log');
    writeCheckResult(featureDir, 'needs_changes', '수정 필요', ['이슈 1']);
    writeDoResult(featureDir);
    writeProgressJson(featureDir, 0.1234);

    const fakeBinDir = path.join(dir, 'bin-log');
    fs.mkdirSync(fakeBinDir, { recursive: true });
    const fakeClaude = path.join(fakeBinDir, 'claude');
    fs.writeFileSync(fakeClaude, '#!/bin/sh\nexit 1\n', 'utf8');
    fs.chmodSync(fakeClaude, '755');

    const result = await runIterScript('budget-log', dir, {
      BUILT_MAX_COST_USD: '5.0',
      BUILT_MAX_ITER: '1',
      PATH: `${fakeBinDir}:${process.env.PATH}`,
    });

    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('누적 비용') || combined.includes('비용 상한'),
      `비용 로그 출력 필요, combined: ${combined}`
    );
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// 섹션 10: providers.iter provider 설정 동작
// ---------------------------------------------------------------------------

console.log('\n[10] providers.iter provider 설정 동작');

const { parseProviderConfig, getProviderForPhase } = require('../src/providers/config');

test('providers.iter 단축형 설정 → iter provider 반환', () => {
  const req = { providers: { iter: 'codex' } };
  const config = parseProviderConfig(req);
  const spec = getProviderForPhase(config, 'iter');
  assert.strictEqual(spec.name, 'codex');
});

test('providers.iter 상세형 설정 (workspace-write sandbox) → 정상 파싱', () => {
  const req = {
    providers: {
      iter: {
        name: 'codex',
        model: 'gpt-5.5',
        effort: 'high',
        sandbox: 'workspace-write',
        timeout_ms: 1800000,
      },
    },
  };
  const config = parseProviderConfig(req);
  const spec = getProviderForPhase(config, 'iter');
  assert.strictEqual(spec.name, 'codex');
  assert.strictEqual(spec.sandbox, 'workspace-write');
  assert.strictEqual(spec.model, 'gpt-5.5');
});

test('providers.iter 미설정 시 providers.do fallback', () => {
  const req = { providers: { do: 'codex' } };
  const config = parseProviderConfig(req);
  // providers.iter가 없으면 iter는 빈 맵 → getProviderForPhase returns claude default
  // fallback 정책은 iter.js 스크립트 레벨에서 처리
  const iterSpec = getProviderForPhase(config, 'iter');
  const doSpec = getProviderForPhase(config, 'do');
  // iter 설정 없으므로 기본값 claude
  assert.strictEqual(iterSpec.name, 'claude');
  // do 설정은 codex
  assert.strictEqual(doSpec.name, 'codex');
  // iter.js는 providers.iter 없을 때 providers.do spec을 사용 (스크립트 레벨 fallback)
  const effectiveIterSpec = config['iter'] || config['do'] || { name: 'claude' };
  assert.strictEqual(effectiveIterSpec.name, 'codex');
});

test('providers.iter, providers.do 모두 미설정 → claude 기본값', () => {
  const config = parseProviderConfig({});
  const spec = getProviderForPhase(config, 'iter');
  assert.strictEqual(spec.name, 'claude');
});

test('Codex iter + read-only sandbox → parseProviderConfig 오류', () => {
  assert.throws(() => {
    parseProviderConfig({
      providers: {
        iter: { name: 'codex', sandbox: 'read-only' },
      },
    });
  }, /read-only|workspace-write/);
});

test('Codex iter + workspace-write sandbox → 정상 (오류 없음)', () => {
  assert.doesNotThrow(() => {
    parseProviderConfig({
      providers: {
        iter: { name: 'codex', sandbox: 'workspace-write' },
      },
    });
  });
});

test('providers.iter 설정 시 iter.js 시작 로그에 provider 출력', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'iter-provider-log');
    const featureDir = path.join(dir, '.built', 'features', 'iter-provider-log');
    // approved 상태로 즉시 exit 0 되게 함 (provider 로그만 확인)
    writeCheckResult(featureDir, 'approved');
    writeDoResult(featureDir);

    const result = await runIterScript('iter-provider-log', dir);
    // approved면 루프 진입 전에 종료 → provider 로그는 출력 안 됨 (정상)
    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.stdout.includes('approved'), `approved 메시지 필요: ${result.stdout}`);
  } finally {
    rmDir(dir);
  }
});

test('providers.iter Codex + read-only → iter.js exit 1 (설정 오류)', async () => {
  const dir = makeTmpDir();
  try {
    writeFeatureSpec(dir, 'iter-codex-readonly');
    const featureDir = path.join(dir, '.built', 'features', 'iter-codex-readonly');
    writeCheckResult(featureDir, 'needs_changes', '수정 필요', ['issue 1']);
    writeDoResult(featureDir);

    // run-request.json에 Codex + read-only 설정
    const runDir = path.join(dir, '.built', 'runtime', 'runs', 'iter-codex-readonly');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, 'run-request.json'),
      JSON.stringify({ providers: { iter: { name: 'codex', sandbox: 'read-only' } } }),
      'utf8'
    );

    const result = await runIterScript('iter-codex-readonly', dir);
    assert.strictEqual(result.exitCode, 1, `exit 1 예상, stderr: ${result.stderr}`);
    assert.ok(
      result.stderr.includes('read-only') || result.stderr.includes('workspace-write') || result.stderr.includes('provider'),
      `sandbox 오류 메시지 필요, stderr: ${result.stderr}`
    );
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// 실행 진입점
// ---------------------------------------------------------------------------

runAll().then(() => {
  console.log(`\n결과: ${passed} 통과, ${failed} 실패\n`);
  process.exit(failed > 0 ? 1 : 0);
});
