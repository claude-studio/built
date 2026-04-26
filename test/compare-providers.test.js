#!/usr/bin/env node
/**
 * test/compare-providers.test.js
 *
 * src/providers/comparison-config.js 단위 테스트와
 * scripts/compare-providers.js fake provider E2E 테스트.
 *
 * 검증 항목:
 *   [parseComparisonConfig — 단위]
 *   - null/undefined → null 반환
 *   - comparison.enabled: false → null 반환
 *   - phase 없음 → "do" 기본값
 *   - phase: "do" 외 → 오류 발생
 *   - candidates 없음/빈 배열 → 오류 발생
 *   - candidate id/provider.name 없음 → 오류 발생
 *   - id 없음 → timestamp 기반 id 생성
 *   - base_ref 없음 → "HEAD" 기본값
 *   - verification 없음 → 빈 commands 기본값
 *
 *   [compare-providers.js fake E2E]
 *   - comparison 디렉토리 구조 생성 확인
 *   - candidate별 output 디렉토리 격리 확인
 *   - canonical .built/features/<feature>/ 파일 미오염 확인
 *   - comparison.enabled: false → exit code 1
 *   - report.md에 자동 winner 미선정 문구 확인
 *   - run-request.json 없음 → exit code 1
 *
 * 외부 npm 패키지 없음. Node.js assert + fs + child_process만 사용.
 */

'use strict';

const assert       = require('assert');
const fs           = require('fs');
const os           = require('os');
const path         = require('path');
const childProcess = require('child_process');

const { parseComparisonConfig } =
  require('../src/providers/comparison-config');

// ---------------------------------------------------------------------------
// 테스트 러너
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'compare-test-'));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * compare-providers.js를 fake 모드로 실행한다.
 */
function runCompare(feature, args, cwd) {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'compare-providers.js');
  const result = childProcess.spawnSync(
    process.execPath,
    [scriptPath, feature, ...args],
    {
      stdio:   ['ignore', 'pipe', 'pipe'],
      env:     Object.assign({}, process.env, {
        BUILT_COMPARE_FAKE_PROVIDER: '1',
        NO_NOTIFY: '1',
      }),
      cwd,
      timeout: 10000,
    }
  );
  return {
    ok:     result.status === 0,
    stdout: (result.stdout || Buffer.alloc(0)).toString(),
    stderr: (result.stderr || Buffer.alloc(0)).toString(),
    status: result.status,
  };
}

/**
 * 최소 프로젝트 구조를 생성한다.
 * run-request.json과 feature spec을 tmpDir에 배치한다.
 */
function setupProject(tmpDir, featureId, comparisonConfig) {
  const runDir = path.join(tmpDir, '.built', 'runtime', 'runs', featureId);
  fs.mkdirSync(runDir, { recursive: true });

  const runRequest = {
    featureId,
    planPath:   `.built/features/${featureId}.md`,
    createdAt:  new Date().toISOString(),
    comparison: comparisonConfig,
  };
  fs.writeFileSync(
    path.join(runDir, 'run-request.json'),
    JSON.stringify(runRequest, null, 2),
    'utf8'
  );

  const featuresDir = path.join(tmpDir, '.built', 'features');
  fs.mkdirSync(featuresDir, { recursive: true });
  fs.writeFileSync(
    path.join(featuresDir, `${featureId}.md`),
    `# ${featureId}\n\nTest feature spec.\n`,
    'utf8'
  );
}

// ---------------------------------------------------------------------------
// 단위 테스트: parseComparisonConfig
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n[parseComparisonConfig — 기본값]');

  await test('null → null 반환', async () => {
    assert.strictEqual(parseComparisonConfig(null), null);
  });

  await test('undefined → null 반환', async () => {
    assert.strictEqual(parseComparisonConfig(undefined), null);
  });

  await test('comparison 없음 → null 반환', async () => {
    assert.strictEqual(parseComparisonConfig({ featureId: 'foo' }), null);
  });

  await test('comparison.enabled: false → null 반환', async () => {
    assert.strictEqual(
      parseComparisonConfig({ comparison: { enabled: false } }),
      null
    );
  });

  await test('comparison.enabled: true + 유효한 config → 파싱 성공', async () => {
    const result = parseComparisonConfig({
      comparison: {
        enabled:    true,
        phase:      'do',
        candidates: [
          { id: 'claude', provider: { name: 'claude' } },
          { id: 'codex',  provider: { name: 'codex', sandbox: 'workspace-write' } },
        ],
      },
    });
    assert.ok(result !== null);
    assert.strictEqual(result.phase, 'do');
    assert.strictEqual(result.candidates.length, 2);
    assert.strictEqual(result.candidates[0].id, 'claude');
    assert.strictEqual(result.candidates[1].id, 'codex');
  });

  // -------------------------------------------------------------------------
  console.log('\n[parseComparisonConfig — phase 검증]');

  await test('phase 없음 → "do" 기본값', async () => {
    const result = parseComparisonConfig({
      comparison: {
        enabled:    true,
        candidates: [{ id: 'c1', provider: { name: 'claude' } }],
      },
    });
    assert.strictEqual(result.phase, 'do');
  });

  await test('phase: "check" → 오류 발생 (MVP는 do만)', async () => {
    assert.throws(
      () => parseComparisonConfig({
        comparison: {
          enabled:    true,
          phase:      'check',
          candidates: [{ id: 'c1', provider: { name: 'claude' } }],
        },
      }),
      (e) => e.message.includes('"check"') && e.message.includes('do')
    );
  });

  await test('phase: "iter" → 오류 발생', async () => {
    assert.throws(
      () => parseComparisonConfig({
        comparison: {
          enabled:    true,
          phase:      'iter',
          candidates: [{ id: 'c1', provider: { name: 'claude' } }],
        },
      }),
      (e) => e.message.includes('"iter"')
    );
  });

  await test('phase: "report" → 오류 발생', async () => {
    assert.throws(
      () => parseComparisonConfig({
        comparison: {
          enabled:    true,
          phase:      'report',
          candidates: [{ id: 'c1', provider: { name: 'claude' } }],
        },
      }),
      (e) => e.message.includes('do')
    );
  });

  // -------------------------------------------------------------------------
  console.log('\n[parseComparisonConfig — candidates 검증]');

  await test('candidates 없음 → 오류 발생', async () => {
    assert.throws(
      () => parseComparisonConfig({
        comparison: { enabled: true, phase: 'do' },
      }),
      (e) => e.message.includes('candidates')
    );
  });

  await test('candidates 빈 배열 → 오류 발생', async () => {
    assert.throws(
      () => parseComparisonConfig({
        comparison: { enabled: true, phase: 'do', candidates: [] },
      }),
      (e) => e.message.includes('candidates')
    );
  });

  await test('candidate id 없음 → 오류 발생', async () => {
    assert.throws(
      () => parseComparisonConfig({
        comparison: {
          enabled:    true,
          phase:      'do',
          candidates: [{ provider: { name: 'claude' } }],
        },
      }),
      (e) => e.message.includes('id')
    );
  });

  await test('candidate provider 없음 → 오류 발생', async () => {
    assert.throws(
      () => parseComparisonConfig({
        comparison: {
          enabled:    true,
          phase:      'do',
          candidates: [{ id: 'c1' }],
        },
      }),
      (e) => e.message.includes('provider')
    );
  });

  await test('candidate provider.name 없음 → 오류 발생', async () => {
    assert.throws(
      () => parseComparisonConfig({
        comparison: {
          enabled:    true,
          phase:      'do',
          candidates: [{ id: 'c1', provider: {} }],
        },
      }),
      (e) => e.message.includes('provider.name')
    );
  });

  // -------------------------------------------------------------------------
  console.log('\n[parseComparisonConfig — 필드 정규화]');

  await test('id 없음 → timestamp 기반 id 생성', async () => {
    const result = parseComparisonConfig({
      comparison: {
        enabled:    true,
        candidates: [{ id: 'c1', provider: { name: 'claude' } }],
      },
    });
    assert.ok(typeof result.id === 'string' && result.id.length > 0);
  });

  await test('id 지정 → 그대로 유지', async () => {
    const result = parseComparisonConfig({
      comparison: {
        enabled:    true,
        id:         'my-comparison-001',
        candidates: [{ id: 'c1', provider: { name: 'claude' } }],
      },
    });
    assert.strictEqual(result.id, 'my-comparison-001');
  });

  await test('base_ref 없음 → "HEAD" 기본값', async () => {
    const result = parseComparisonConfig({
      comparison: {
        enabled:    true,
        candidates: [{ id: 'c1', provider: { name: 'claude' } }],
      },
    });
    assert.strictEqual(result.base_ref, 'HEAD');
  });

  await test('base_ref 지정 → 그대로 유지', async () => {
    const result = parseComparisonConfig({
      comparison: {
        enabled:    true,
        base_ref:   'main',
        candidates: [{ id: 'c1', provider: { name: 'claude' } }],
      },
    });
    assert.strictEqual(result.base_ref, 'main');
  });

  await test('verification 없음 → 빈 commands, smoke: false 기본값', async () => {
    const result = parseComparisonConfig({
      comparison: {
        enabled:    true,
        candidates: [{ id: 'c1', provider: { name: 'claude' } }],
      },
    });
    assert.deepStrictEqual(result.verification.commands, []);
    assert.strictEqual(result.verification.smoke, false);
  });

  await test('verification.commands 지정 → 그대로 유지', async () => {
    const result = parseComparisonConfig({
      comparison: {
        enabled:      true,
        candidates:   [{ id: 'c1', provider: { name: 'claude' } }],
        verification: { commands: ['npm test', 'npm run lint'] },
      },
    });
    assert.deepStrictEqual(result.verification.commands, ['npm test', 'npm run lint']);
  });

  await test('provider 필드는 얕은 복사', async () => {
    const original = { name: 'codex', sandbox: 'workspace-write', effort: 'high' };
    const result = parseComparisonConfig({
      comparison: {
        enabled:    true,
        candidates: [{ id: 'codex', provider: original }],
      },
    });
    assert.deepStrictEqual(result.candidates[0].provider, original);
    // 원본 객체는 변경되지 않았는지 확인
    assert.strictEqual(original.name, 'codex');
  });

  // ---------------------------------------------------------------------------
  // fake E2E: compare-providers.js
  // ---------------------------------------------------------------------------

  console.log('\n[compare-providers.js — fake provider E2E]');

  await test('비교 디렉토리 구조 생성', async () => {
    const tmpDir    = makeTmpDir();
    const featureId = 'test-feat';
    const compId    = 'test-comp-001';
    try {
      setupProject(tmpDir, featureId, {
        enabled:    true,
        id:         compId,
        phase:      'do',
        candidates: [
          { id: 'claude', provider: { name: 'claude' } },
          { id: 'codex',  provider: { name: 'codex', sandbox: 'workspace-write' } },
        ],
      });

      const result = runCompare(featureId, ['--phase', 'do'], tmpDir);
      assert.ok(
        result.ok,
        `compare-providers.js 실패:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
      );

      const compRoot = path.join(
        tmpDir, '.built', 'runtime', 'runs', featureId, 'comparisons', compId
      );
      assert.ok(fs.existsSync(compRoot),
        'comparison 루트 디렉토리 존재해야 함');
      assert.ok(fs.existsSync(path.join(compRoot, 'manifest.json')),
        'manifest.json 존재해야 함');
      assert.ok(fs.existsSync(path.join(compRoot, 'report.md')),
        'report.md 존재해야 함');
      assert.ok(fs.existsSync(path.join(compRoot, 'input-snapshot.json')),
        'input-snapshot.json 존재해야 함');
      assert.ok(fs.existsSync(path.join(compRoot, 'acceptance-criteria.md')),
        'acceptance-criteria.md 존재해야 함');
      assert.ok(fs.existsSync(path.join(compRoot, 'verification-plan.json')),
        'verification-plan.json 존재해야 함');
    } finally {
      rmDir(tmpDir);
    }
  });

  await test('candidate별 output 디렉토리 격리', async () => {
    const tmpDir    = makeTmpDir();
    const featureId = 'test-feat';
    const compId    = 'iso-comp-001';
    try {
      setupProject(tmpDir, featureId, {
        enabled:    true,
        id:         compId,
        phase:      'do',
        candidates: [
          { id: 'claude', provider: { name: 'claude' } },
          { id: 'codex',  provider: { name: 'codex', sandbox: 'workspace-write' } },
        ],
      });

      const result = runCompare(featureId, ['--phase', 'do'], tmpDir);
      assert.ok(result.ok, `compare-providers.js 실패: ${result.stderr}`);

      const compRoot = path.join(
        tmpDir, '.built', 'runtime', 'runs', featureId, 'comparisons', compId
      );

      for (const candidateId of ['claude', 'codex']) {
        const cDir = path.join(compRoot, 'providers', candidateId);
        assert.ok(fs.existsSync(cDir),
          `${candidateId} output dir 존재해야 함`);
        assert.ok(fs.existsSync(path.join(cDir, 'run-request.json')),
          `${candidateId}/run-request.json 존재해야 함`);
        assert.ok(fs.existsSync(path.join(cDir, 'state.json')),
          `${candidateId}/state.json 존재해야 함`);
        assert.ok(fs.existsSync(path.join(cDir, 'progress.json')),
          `${candidateId}/progress.json 존재해야 함`);
        assert.ok(fs.existsSync(path.join(cDir, 'verification.json')),
          `${candidateId}/verification.json 존재해야 함`);
        assert.ok(fs.existsSync(path.join(cDir, 'diff.patch')),
          `${candidateId}/diff.patch 존재해야 함`);
        assert.ok(fs.existsSync(path.join(cDir, 'git-status.txt')),
          `${candidateId}/git-status.txt 존재해야 함`);
        assert.ok(
          fs.existsSync(path.join(cDir, 'result', 'do-result.md')),
          `${candidateId}/result/do-result.md 존재해야 함`
        );
      }

      // candidate별 run-request.json이 서로 다른 provider를 가리키는지 확인
      const claudeReq = JSON.parse(
        fs.readFileSync(path.join(compRoot, 'providers', 'claude', 'run-request.json'), 'utf8')
      );
      const codexReq = JSON.parse(
        fs.readFileSync(path.join(compRoot, 'providers', 'codex', 'run-request.json'), 'utf8')
      );
      assert.strictEqual(claudeReq.providers.do.name, 'claude',
        'claude candidate는 claude provider를 사용해야 함');
      assert.strictEqual(codexReq.providers.do.name, 'codex',
        'codex candidate는 codex provider를 사용해야 함');
    } finally {
      rmDir(tmpDir);
    }
  });

  await test('canonical .built/features/<feature>/ 파일 미오염', async () => {
    const tmpDir    = makeTmpDir();
    const featureId = 'test-feat';
    const compId    = 'purity-comp-001';
    try {
      setupProject(tmpDir, featureId, {
        enabled:    true,
        id:         compId,
        phase:      'do',
        candidates: [{ id: 'claude', provider: { name: 'claude' } }],
      });

      // 비교 실행 전 canonical 파일 미리 작성
      const canonicalFeatureDir = path.join(tmpDir, '.built', 'features', featureId);
      fs.mkdirSync(canonicalFeatureDir, { recursive: true });

      const canonicalResultPath   = path.join(canonicalFeatureDir, 'do-result.md');
      const canonicalProgressPath = path.join(canonicalFeatureDir, 'progress.json');
      const canonicalStatePath    = path.join(
        tmpDir, '.built', 'runtime', 'runs', featureId, 'state.json'
      );

      fs.writeFileSync(canonicalResultPath,   '# canonical do-result', 'utf8');
      fs.writeFileSync(canonicalProgressPath, '{"status":"canonical"}', 'utf8');

      const result = runCompare(featureId, ['--phase', 'do'], tmpDir);
      assert.ok(result.ok, `compare-providers.js 실패: ${result.stderr}`);

      // canonical 파일 내용이 변경되지 않았는지 확인
      assert.strictEqual(
        fs.readFileSync(canonicalResultPath, 'utf8'),
        '# canonical do-result',
        'canonical do-result.md가 덮어써졌습니다'
      );
      assert.strictEqual(
        fs.readFileSync(canonicalProgressPath, 'utf8'),
        '{"status":"canonical"}',
        'canonical progress.json이 덮어써졌습니다'
      );

      // 기본 runs/<feature>/state.json도 건드리지 않았는지 확인
      assert.ok(
        !fs.existsSync(canonicalStatePath),
        '기본 runs/<feature>/state.json은 compare-providers.js가 생성하지 않아야 함'
      );
    } finally {
      rmDir(tmpDir);
    }
  });

  await test('comparison.enabled: false → exit code 1', async () => {
    const tmpDir    = makeTmpDir();
    const featureId = 'test-feat';
    try {
      setupProject(tmpDir, featureId, { enabled: false });
      const result = runCompare(featureId, ['--phase', 'do'], tmpDir);
      assert.ok(!result.ok, 'enabled: false인 경우 exit code 1이어야 함');
    } finally {
      rmDir(tmpDir);
    }
  });

  await test('report.md에 자동 winner 미선정 문구 포함', async () => {
    const tmpDir    = makeTmpDir();
    const featureId = 'test-feat';
    const compId    = 'report-comp-001';
    try {
      setupProject(tmpDir, featureId, {
        enabled:    true,
        id:         compId,
        phase:      'do',
        candidates: [{ id: 'claude', provider: { name: 'claude' } }],
      });

      const result = runCompare(featureId, ['--phase', 'do'], tmpDir);
      assert.ok(result.ok, `compare-providers.js 실패: ${result.stderr}`);

      const reportPath = path.join(
        tmpDir, '.built', 'runtime', 'runs', featureId, 'comparisons', compId, 'report.md'
      );
      const reportContent = fs.readFileSync(reportPath, 'utf8');
      assert.ok(
        reportContent.includes('자동 winner는 선택하지 않았습니다'),
        'report.md에 자동 winner 미선정 문구가 있어야 합니다'
      );
    } finally {
      rmDir(tmpDir);
    }
  });

  await test('run-request.json 없음 → exit code 1', async () => {
    const tmpDir = makeTmpDir();
    try {
      const result = runCompare('nonexistent-feat', ['--phase', 'do'], tmpDir);
      assert.ok(!result.ok, 'run-request.json 없으면 exit code 1이어야 함');
    } finally {
      rmDir(tmpDir);
    }
  });

  await test('manifest.json에 candidate별 결과 기록', async () => {
    const tmpDir    = makeTmpDir();
    const featureId = 'test-feat';
    const compId    = 'manifest-comp-001';
    try {
      setupProject(tmpDir, featureId, {
        enabled:    true,
        id:         compId,
        phase:      'do',
        candidates: [
          { id: 'claude', provider: { name: 'claude' } },
          { id: 'codex',  provider: { name: 'codex', sandbox: 'workspace-write' } },
        ],
      });

      const result = runCompare(featureId, ['--phase', 'do'], tmpDir);
      assert.ok(result.ok, `compare-providers.js 실패: ${result.stderr}`);

      const manifestPath = path.join(
        tmpDir, '.built', 'runtime', 'runs', featureId, 'comparisons', compId, 'manifest.json'
      );
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      assert.strictEqual(manifest.comparison_id, compId);
      assert.strictEqual(manifest.feature, featureId);
      assert.strictEqual(manifest.phase, 'do');
      assert.strictEqual(manifest.status, 'completed');
      assert.ok(manifest.finished_at, 'finished_at이 설정되어야 함');
      assert.strictEqual(manifest.candidates.length, 2);
      assert.strictEqual(manifest.candidates[0].phase_status, 'completed');
      assert.strictEqual(manifest.candidates[1].phase_status, 'completed');
    } finally {
      rmDir(tmpDir);
    }
  });

  // ---------------------------------------------------------------------------
  // 결과
  // ---------------------------------------------------------------------------

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
