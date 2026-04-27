#!/usr/bin/env node
/**
 * test/report.test.js
 *
 * report.js 관련 단위 테스트 (Node.js assert + fs만 사용, 외부 패키지 없음)
 *
 * 1. frontmatter 생성 로직 (id, date, status, model)
 * 2. 저비용 모델 선택 (haiku 기본값, run-request.json 우선 적용)
 * 3. do-result.md 없을 때 오류 처리
 * 4. check-result.md approved gate
 */

'use strict';

const assert       = require('assert');
const fs           = require('fs');
const os           = require('os');
const path         = require('path');
const childProcess = require('child_process');

const { parse, stringify } = require('../src/frontmatter');
const { evaluateCheckGate, getCheckStatus, parseArgs } = require('../scripts/report');

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
// 유틸
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'report-test-'));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeCheckResult(filePath, status) {
  fs.writeFileSync(filePath, stringify({
    feature: 'test-feature',
    status,
    checked_at: new Date().toISOString(),
  }, `# Check Result\n\nstatus: ${status}\n`), 'utf8');
}

// ---------------------------------------------------------------------------
// [1] frontmatter 생성 로직
// ---------------------------------------------------------------------------

console.log('\n[frontmatter] report.md frontmatter 생성');

test('id, date, status, model 필드가 포함된 frontmatter 생성', () => {
  const feature = 'user-auth';
  const model   = 'claude-haiku-4-5-20251001';
  const date    = new Date().toISOString();

  const frontmatter = {
    id:     feature,
    date,
    status: 'completed',
    model,
  };

  const content = '## Summary\n\nImplementation completed.';
  const output  = stringify(frontmatter, content);

  const { data, content: body } = parse(output);

  assert.strictEqual(data.id,     feature,     'id 필드');
  assert.strictEqual(data.status, 'completed', 'status 필드');
  assert.strictEqual(data.model,  model,       'model 필드');
  assert.ok(data.date,                         'date 필드 존재');
  assert.strictEqual(body, content,            '본문 보존');
});

test('frontmatter에 feature_id, cost_usd, duration_ms 없음 (불필요 필드 제거)', () => {
  const frontmatter = {
    id:     'my-feature',
    date:   new Date().toISOString(),
    status: 'completed',
    model:  'claude-haiku-4-5-20251001',
  };

  const output = stringify(frontmatter, '');
  const { data } = parse(output);

  assert.ok(!data.feature_id,  'feature_id 없어야 함');
  assert.ok(!data.cost_usd,    'cost_usd 없어야 함');
  assert.ok(!data.duration_ms, 'duration_ms 없어야 함');
  assert.ok(!data.created_at,  'created_at 없어야 함');
});

test('status는 항상 completed (report 단계 완료 시)', () => {
  const frontmatter = {
    id:     'some-feature',
    date:   new Date().toISOString(),
    status: 'completed',
    model:  'claude-haiku-4-5-20251001',
  };

  const { data } = parse(stringify(frontmatter, ''));
  assert.strictEqual(data.status, 'completed');
});

test('date 필드가 ISO8601 형식인지 확인', () => {
  const date = new Date().toISOString();
  // ISO8601: 2026-04-24T12:34:56.789Z 형식
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(date), `ISO8601 형식: ${date}`);
});

test('기존 report.md 재작성 시 본문 보존', () => {
  const dir = makeTmpDir();
  try {
    const reportPath = path.join(dir, 'report.md');

    // result-to-markdown.js 스타일의 원본 파일
    const original = [
      '---',
      'feature_id: my-feature',
      'status: completed',
      'model: claude-haiku-4-5-20251001',
      'cost_usd: 0.001',
      'duration_ms: 1234',
      'created_at: 2026-04-24T00:00:00.000Z',
      '---',
      '',
      '## Summary',
      '',
      'Implementation done.',
    ].join('\n');

    fs.writeFileSync(reportPath, original, 'utf8');

    // report.js의 frontmatter 재작성 로직 재현
    const raw            = fs.readFileSync(reportPath, 'utf8');
    const { content }    = parse(raw);
    const newFrontmatter = {
      id:     'my-feature',
      date:   new Date().toISOString(),
      status: 'completed',
      model:  'claude-haiku-4-5-20251001',
    };
    fs.writeFileSync(reportPath, stringify(newFrontmatter, content), 'utf8');

    const rewritten      = fs.readFileSync(reportPath, 'utf8');
    const { data, content: body } = parse(rewritten);

    assert.strictEqual(data.id,     'my-feature', 'id 필드');
    assert.strictEqual(data.status, 'completed',  'status 필드');
    assert.ok(!data.feature_id,                   'feature_id 제거됨');
    assert.ok(!data.cost_usd,                     'cost_usd 제거됨');
    assert.ok(body.includes('## Summary'),        '본문 보존');
    assert.ok(body.includes('Implementation done.'), '본문 내용 보존');
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// [2] 저비용 모델 선택 로직
// ---------------------------------------------------------------------------

console.log('\n[model] 저비용 모델 선택');

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

test('run-request.json 없으면 DEFAULT_MODEL (claude-haiku-4-5-20251001) 사용', () => {
  const dir = makeTmpDir();
  try {
    // run-request.json 없는 상태
    let model = DEFAULT_MODEL;
    const runRequestPath = path.join(dir, 'run-request.json');
    if (fs.existsSync(runRequestPath)) {
      const req = JSON.parse(fs.readFileSync(runRequestPath, 'utf8'));
      if (req.model) model = req.model;
    }
    assert.strictEqual(model, DEFAULT_MODEL);
  } finally {
    rmDir(dir);
  }
});

test('run-request.json에 model 없으면 DEFAULT_MODEL 유지', () => {
  const dir = makeTmpDir();
  try {
    const runRequestPath = path.join(dir, 'run-request.json');
    fs.writeFileSync(runRequestPath, JSON.stringify({ featureId: 'test' }), 'utf8');

    let model = DEFAULT_MODEL;
    if (fs.existsSync(runRequestPath)) {
      const req = JSON.parse(fs.readFileSync(runRequestPath, 'utf8'));
      if (req.model) model = req.model;
    }
    assert.strictEqual(model, DEFAULT_MODEL);
  } finally {
    rmDir(dir);
  }
});

test('run-request.json에 model 있으면 해당 모델 우선 적용', () => {
  const dir = makeTmpDir();
  try {
    const runRequestPath = path.join(dir, 'run-request.json');
    fs.writeFileSync(runRequestPath, JSON.stringify({ model: 'claude-opus-4-6', featureId: 'test' }), 'utf8');

    let model = DEFAULT_MODEL;
    if (fs.existsSync(runRequestPath)) {
      const req = JSON.parse(fs.readFileSync(runRequestPath, 'utf8'));
      if (req.model) model = req.model;
    }
    assert.strictEqual(model, 'claude-opus-4-6');
  } finally {
    rmDir(dir);
  }
});

test('run-request.json이 파싱 불가하면 silent fallback하지 않음', () => {
  const dir = makeTmpDir();
  try {
    const runRequestPath = path.join(dir, 'run-request.json');
    fs.writeFileSync(runRequestPath, 'not-valid-json', 'utf8');

    assert.throws(
      () => JSON.parse(fs.readFileSync(runRequestPath, 'utf8')),
      SyntaxError
    );
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// [3] do-result.md 없을 때 오류 처리
// ---------------------------------------------------------------------------

console.log('\n[validation] do-result.md 없을 때 오류');

test('do-result.md 없으면 exit code 1로 종료', (done) => {
  const dir = makeTmpDir();
  try {
    // feature spec 파일 생성 (do-result.md는 없음)
    const featuresDir = path.join(dir, '.built', 'features');
    fs.mkdirSync(featuresDir, { recursive: true });
    fs.writeFileSync(path.join(featuresDir, 'test-feature.md'), '# test feature spec', 'utf8');

    const child = childProcess.spawnSync(
      'node',
      [path.join(__dirname, '..', 'scripts', 'report.js'), 'test-feature'],
      { cwd: dir, encoding: 'utf8' }
    );

    assert.strictEqual(child.status, 1, `exit code: ${child.status}`);
    assert.ok(
      child.stderr.includes('do-result.md not found') || child.stderr.includes('do-result'),
      `stderr: ${child.stderr}`
    );
  } finally {
    rmDir(dir);
  }
});

test('feature spec 없으면 exit code 1로 종료', () => {
  const dir = makeTmpDir();
  try {
    const child = childProcess.spawnSync(
      'node',
      [path.join(__dirname, '..', 'scripts', 'report.js'), 'nonexistent-feature'],
      { cwd: dir, encoding: 'utf8' }
    );

    assert.strictEqual(child.status, 1, `exit code: ${child.status}`);
  } finally {
    rmDir(dir);
  }
});

test('feature 인자 없으면 exit code 1로 종료', () => {
  const dir = makeTmpDir();
  try {
    const child = childProcess.spawnSync(
      'node',
      [path.join(__dirname, '..', 'scripts', 'report.js')],
      { cwd: dir, encoding: 'utf8' }
    );

    assert.strictEqual(child.status, 1);
  } finally {
    rmDir(dir);
  }
});

// ---------------------------------------------------------------------------
// [4] check-result.md approved gate
// ---------------------------------------------------------------------------

console.log('\n[validation] check-result.md approved gate');

test('check-result.md 없으면 기본적으로 report gate 실패', () => {
  const dir = makeTmpDir();
  try {
    const checkResultPath = path.join(dir, 'check-result.md');
    const gate = evaluateCheckGate(checkResultPath, false);
    assert.strictEqual(gate.ok, false);
    assert.strictEqual(gate.checkStatus, 'missing');
    assert.ok(gate.error.includes('check-result.md not found'));
  } finally {
    rmDir(dir);
  }
});

test('check-result.md needs_changes이면 기본적으로 report gate 실패', () => {
  const dir = makeTmpDir();
  try {
    const checkResultPath = path.join(dir, 'check-result.md');
    writeCheckResult(checkResultPath, 'needs_changes');

    const gate = evaluateCheckGate(checkResultPath, false);
    assert.strictEqual(gate.ok, false);
    assert.strictEqual(gate.checkStatus, 'needs_changes');
    assert.ok(gate.error.includes('approved'));
  } finally {
    rmDir(dir);
  }
});

test('check-result.md approved이면 report gate 통과', () => {
  const dir = makeTmpDir();
  try {
    const checkResultPath = path.join(dir, 'check-result.md');
    writeCheckResult(checkResultPath, 'approved');

    const gate = evaluateCheckGate(checkResultPath, false);
    assert.strictEqual(gate.ok, true);
    assert.strictEqual(gate.checkStatus, 'approved');
    assert.strictEqual(gate.unchecked, false);
  } finally {
    rmDir(dir);
  }
});

test('--allow-unchecked이면 missing check-result gate 통과와 evidence 값 반환', () => {
  const dir = makeTmpDir();
  try {
    const checkResultPath = path.join(dir, 'check-result.md');
    const gate = evaluateCheckGate(checkResultPath, true);
    assert.strictEqual(gate.ok, true);
    assert.strictEqual(gate.checkStatus, 'missing');
    assert.strictEqual(gate.unchecked, true);
    assert.ok(gate.uncheckedReason.includes('check-result.md'));
  } finally {
    rmDir(dir);
  }
});

test('--allow-unchecked이면 needs_changes gate 통과와 evidence 값 반환', () => {
  const dir = makeTmpDir();
  try {
    const checkResultPath = path.join(dir, 'check-result.md');
    writeCheckResult(checkResultPath, 'needs_changes');

    const gate = evaluateCheckGate(checkResultPath, true);
    assert.strictEqual(gate.ok, true);
    assert.strictEqual(gate.checkStatus, 'needs_changes');
    assert.strictEqual(gate.unchecked, true);
    assert.ok(gate.uncheckedReason.includes('needs_changes'));
  } finally {
    rmDir(dir);
  }
});

test('check-result.md status frontmatter를 파싱한다', () => {
  const markdown = stringify({ status: 'approved' }, '# Check Result\n');
  assert.strictEqual(getCheckStatus(markdown), 'approved');
});

test('parseArgs는 --allow-unchecked opt-in을 파싱한다', () => {
  const parsed = parseArgs(['node', 'scripts/report.js', 'my-feature', '--allow-unchecked']);
  assert.strictEqual(parsed.feature, 'my-feature');
  assert.strictEqual(parsed.allowUnchecked, true);
});

test('do-result.md가 있어도 check-result.md 없으면 CLI가 provider 실행 전 실패', () => {
  const dir = makeTmpDir();
  try {
    const featuresDir = path.join(dir, '.built', 'features');
    const featureDir = path.join(featuresDir, 'test-feature');
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(featuresDir, 'test-feature.md'), '# test feature spec', 'utf8');
    fs.writeFileSync(path.join(featureDir, 'do-result.md'), '# Do Result', 'utf8');

    const child = childProcess.spawnSync(
      'node',
      [path.join(__dirname, '..', 'scripts', 'report.js'), 'test-feature'],
      { cwd: dir, encoding: 'utf8' }
    );

    assert.strictEqual(child.status, 1, `exit code: ${child.status}`);
    assert.ok(child.stderr.includes('check-result.md not found'), `stderr: ${child.stderr}`);
    assert.ok(!child.stdout.includes('보고서 생성 중'), `stdout: ${child.stdout}`);
  } finally {
    rmDir(dir);
  }
});

test('needs_changes check-result.md이면 CLI가 provider 실행 전 실패', () => {
  const dir = makeTmpDir();
  try {
    const featuresDir = path.join(dir, '.built', 'features');
    const featureDir = path.join(featuresDir, 'test-feature');
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(featuresDir, 'test-feature.md'), '# test feature spec', 'utf8');
    fs.writeFileSync(path.join(featureDir, 'do-result.md'), '# Do Result', 'utf8');
    writeCheckResult(path.join(featureDir, 'check-result.md'), 'needs_changes');

    const child = childProcess.spawnSync(
      'node',
      [path.join(__dirname, '..', 'scripts', 'report.js'), 'test-feature'],
      { cwd: dir, encoding: 'utf8' }
    );

    assert.strictEqual(child.status, 1, `exit code: ${child.status}`);
    assert.ok(child.stderr.includes('status must be approved'), `stderr: ${child.stderr}`);
    assert.ok(!child.stdout.includes('보고서 생성 중'), `stdout: ${child.stdout}`);
  } finally {
    rmDir(dir);
  }
});

test('allow-unchecked report frontmatter에는 unchecked evidence가 남는다', () => {
  const frontmatter = {
    id: 'unchecked-feature',
    date: new Date().toISOString(),
    status: 'completed',
    provider: 'claude',
    model: DEFAULT_MODEL,
    check_status: 'needs_changes',
    unchecked: true,
    unchecked_reason: 'check-result.md status가 approved가 아님: needs_changes',
  };

  const { data } = parse(stringify(frontmatter, '# Report\n'));
  assert.strictEqual(data.check_status, 'needs_changes');
  assert.strictEqual(data.unchecked, true);
  assert.ok(data.unchecked_reason.includes('needs_changes'));
});

// ---------------------------------------------------------------------------
// [5] providers.report provider 설정 동작
// ---------------------------------------------------------------------------

console.log('\n[provider] providers.report 설정 동작');

const { parseProviderConfig: parseReportProviderConfig, getProviderForPhase: getReportProviderForPhase } = require('../src/providers/config');

test('providers.report 단축형 설정 → report provider 반환', () => {
  const req = { providers: { report: 'codex' } };
  const config = parseReportProviderConfig(req);
  const spec = getReportProviderForPhase(config, 'report');
  assert.strictEqual(spec.name, 'codex');
});

test('providers.report 상세형 설정 → model/sandbox 파싱', () => {
  const req = {
    providers: {
      report: {
        name: 'codex',
        model: 'gpt-5.5',
        sandbox: 'read-only',
        timeout_ms: 900000,
      },
    },
  };
  const config = parseReportProviderConfig(req);
  const spec = getReportProviderForPhase(config, 'report');
  assert.strictEqual(spec.name, 'codex');
  assert.strictEqual(spec.model, 'gpt-5.5');
  assert.strictEqual(spec.sandbox, 'read-only');
});

test('providers.report 미설정 시 claude 기본값', () => {
  const config = parseReportProviderConfig({});
  const spec = getReportProviderForPhase(config, 'report');
  assert.strictEqual(spec.name, 'claude');
});

test('report.md frontmatter에 provider 필드 포함', () => {
  const feature  = 'provider-test';
  const model    = 'claude-haiku-4-5-20251001';
  const provider = 'claude';
  const date     = new Date().toISOString();

  const frontmatter = {
    id:       feature,
    date,
    status:   'completed',
    provider,
    model,
  };

  const { parse: parseFm, stringify: stringifyFm } = require('../src/frontmatter');
  const output     = stringifyFm(frontmatter, '## Report\n\nDone.');
  const { data }   = parseFm(output);

  assert.strictEqual(data.provider, 'claude', 'provider 필드');
  assert.strictEqual(data.model,    model,    'model 필드');
  assert.strictEqual(data.id,       feature,  'id 필드');
  assert.strictEqual(data.status, 'completed', 'status 필드');
});

test('providers.report codex → frontmatter provider=codex', () => {
  const { parse: parseFm, stringify: stringifyFm } = require('../src/frontmatter');
  const frontmatter = {
    id:       'codex-report-feature',
    date:     new Date().toISOString(),
    status:   'completed',
    provider: 'codex',
    model:    'gpt-5.5',
  };

  const output   = stringifyFm(frontmatter, '## Report\n\nCodex report.');
  const { data } = parseFm(output);

  assert.strictEqual(data.provider, 'codex', 'provider=codex');
  assert.strictEqual(data.model,    'gpt-5.5', 'model=gpt-5.5');
});

test('providers.report 설정 없을 때 frontmatter provider=claude (기본값)', () => {
  const { parse: parseFm, stringify: stringifyFm } = require('../src/frontmatter');
  const frontmatter = {
    id:       'default-report-feature',
    date:     new Date().toISOString(),
    status:   'completed',
    provider: 'claude',
    model:    DEFAULT_MODEL,
  };

  const output   = stringifyFm(frontmatter, '## Report\n');
  const { data } = parseFm(output);

  assert.strictEqual(data.provider, 'claude', 'provider=claude (기본값)');
  assert.strictEqual(data.model,    DEFAULT_MODEL, 'model=haiku (기본값)');
});

// ---------------------------------------------------------------------------
// 결과
// ---------------------------------------------------------------------------

console.log(`\n결과: ${passed} 통과, ${failed} 실패\n`);
if (failed > 0) process.exit(1);
