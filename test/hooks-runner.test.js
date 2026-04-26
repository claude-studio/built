#!/usr/bin/env node
/**
 * test/hooks-runner.test.js
 *
 * hooks-runner.js 단위 테스트 (Node.js assert + fs만 사용, 외부 패키지 없음)
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

const {
  loadHooks,
  evaluateCondition,
  runHooks,
  injectFailuresIntoCheckResult,
  buildHookEnv,
  SENSITIVE_ENV_PATTERN,
} = require('../src/hooks-runner');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
  }
}

function makeTemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-runner-test-'));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

// ---------------------------------------------------------------------------
// 테스트 그룹 1: 훅 로드 및 병합
// ---------------------------------------------------------------------------

console.log('\n=== loadHooks: 훅 로드 및 병합 ===');

test('hooks.json 없으면 빈 배열 반환', () => {
  const dir = makeTemp();
  try {
    const hooks = loadHooks(dir);
    assert.deepStrictEqual(hooks.before_do, []);
    assert.deepStrictEqual(hooks.after_do,  []);
    assert.deepStrictEqual(hooks.after_check,  []);
    assert.deepStrictEqual(hooks.after_report, []);
  } finally {
    cleanup(dir);
  }
});

test('hooks.json team 훅 로드 및 source: team 메타데이터', () => {
  const dir = makeTemp();
  const builtDir = path.join(dir, '.built');
  fs.mkdirSync(builtDir, { recursive: true });

  const hooksJson = {
    pipeline: {
      before_do: [{ run: 'echo before', halt_on_fail: true }],
      after_do:  [{ run: 'echo after',  halt_on_fail: false }],
    },
  };
  fs.writeFileSync(path.join(builtDir, 'hooks.json'), JSON.stringify(hooksJson), 'utf8');

  try {
    const hooks = loadHooks(dir);
    assert.strictEqual(hooks.before_do.length, 1);
    assert.strictEqual(hooks.before_do[0].source, 'team');
    assert.strictEqual(hooks.before_do[0].run, 'echo before');
    assert.strictEqual(hooks.before_do[0].halt_on_fail, true);
    assert.strictEqual(hooks.after_do[0].source, 'team');
  } finally {
    cleanup(dir);
  }
});

test('hooks.local.json local 훅은 team 뒤에 concat', () => {
  const dir = makeTemp();
  const builtDir = path.join(dir, '.built');
  fs.mkdirSync(builtDir, { recursive: true });

  fs.writeFileSync(path.join(builtDir, 'hooks.json'), JSON.stringify({
    pipeline: {
      after_do: [{ run: 'echo team-hook' }],
    },
  }), 'utf8');

  fs.writeFileSync(path.join(builtDir, 'hooks.local.json'), JSON.stringify({
    pipeline: {
      after_do: [{ run: 'echo local-hook' }],
    },
  }), 'utf8');

  try {
    const hooks = loadHooks(dir);
    assert.strictEqual(hooks.after_do.length, 2);
    assert.strictEqual(hooks.after_do[0].run, 'echo team-hook');
    assert.strictEqual(hooks.after_do[0].source, 'team');
    assert.strictEqual(hooks.after_do[1].run, 'echo local-hook');
    assert.strictEqual(hooks.after_do[1].source, 'local');
  } finally {
    cleanup(dir);
  }
});

test('local 훅은 team을 덮어쓰지 않음 (concat만)', () => {
  const dir = makeTemp();
  const builtDir = path.join(dir, '.built');
  fs.mkdirSync(builtDir, { recursive: true });

  fs.writeFileSync(path.join(builtDir, 'hooks.json'), JSON.stringify({
    pipeline: {
      before_do: [{ run: 'echo team-before' }],
    },
  }), 'utf8');

  fs.writeFileSync(path.join(builtDir, 'hooks.local.json'), JSON.stringify({
    pipeline: {
      before_do: [{ run: 'echo local-before' }],
    },
  }), 'utf8');

  try {
    const hooks = loadHooks(dir);
    // team + local 모두 존재 (덮어쓰기 없음)
    assert.strictEqual(hooks.before_do.length, 2);
    assert.strictEqual(hooks.before_do[0].source, 'team');
    assert.strictEqual(hooks.before_do[1].source, 'local');
  } finally {
    cleanup(dir);
  }
});

test('잘못된 hooks.json (JSON 파싱 오류) → 예외 발생', () => {
  const dir = makeTemp();
  const builtDir = path.join(dir, '.built');
  fs.mkdirSync(builtDir, { recursive: true });
  fs.writeFileSync(path.join(builtDir, 'hooks.json'), 'NOT_JSON', 'utf8');

  try {
    assert.throws(() => loadHooks(dir), /JSON 파싱 실패/);
  } finally {
    cleanup(dir);
  }
});

test('command 훅에 run + skill 동시 존재 → 검증 오류', () => {
  const dir = makeTemp();
  const builtDir = path.join(dir, '.built');
  fs.mkdirSync(builtDir, { recursive: true });
  fs.writeFileSync(path.join(builtDir, 'hooks.json'), JSON.stringify({
    pipeline: {
      before_do: [{ run: 'echo x', skill: 'my-skill' }],
    },
  }), 'utf8');

  try {
    assert.throws(() => loadHooks(dir), /cannot have both/);
  } finally {
    cleanup(dir);
  }
});

test('기본값: halt_on_fail 미지정 시 false, capture_output 미지정 시 false', () => {
  const dir = makeTemp();
  const builtDir = path.join(dir, '.built');
  fs.mkdirSync(builtDir, { recursive: true });
  fs.writeFileSync(path.join(builtDir, 'hooks.json'), JSON.stringify({
    pipeline: { before_do: [{ run: 'echo x' }] },
  }), 'utf8');

  try {
    const hooks = loadHooks(dir);
    assert.strictEqual(hooks.before_do[0].halt_on_fail, false);
    assert.strictEqual(hooks.before_do[0].capture_output, false);
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// 테스트 그룹 2: condition 평가
// ---------------------------------------------------------------------------

console.log('\n=== evaluateCondition: condition 표현식 평가 ===');

test('condition 없으면 true 반환', () => {
  assert.strictEqual(evaluateCondition(null, {}), true);
  assert.strictEqual(evaluateCondition('', {}), true);
});

test("check.status == 'approved' 평가", () => {
  const ctx = { check: { status: 'approved' } };
  assert.strictEqual(evaluateCondition("check.status == 'approved'", ctx), true);
  assert.strictEqual(evaluateCondition("check.status == 'needs_changes'", ctx), false);
});

test('feature.touches_auth == true 평가', () => {
  const ctx = { feature: { touches_auth: true } };
  assert.strictEqual(evaluateCondition('feature.touches_auth == true', ctx), true);
  assert.strictEqual(evaluateCondition('feature.touches_auth == false', ctx), false);
});

test('존재하지 않는 경로 → lhs undefined → false', () => {
  const ctx = {};
  assert.strictEqual(evaluateCondition('feature.touches_auth == true', ctx), false);
});

test('숫자 비교', () => {
  const ctx = { run: { count: 3 } };
  assert.strictEqual(evaluateCondition('run.count == 3', ctx), true);
  assert.strictEqual(evaluateCondition('run.count == 5', ctx), false);
});

// ---------------------------------------------------------------------------
// 테스트 그룹 3: halt_on_fail 동작
// ---------------------------------------------------------------------------

console.log('\n=== runHooks: halt_on_fail 동작 ===');

test('halt_on_fail: true인 훅 실패 시 halted: true 반환', () => {
  const dir = makeTemp();
  const builtDir = path.join(dir, '.built');
  fs.mkdirSync(builtDir, { recursive: true });

  const hooks = {
    before_do: [
      { type: 'command', run: 'exit 1', halt_on_fail: true, source: 'team',
        capture_output: false, expect_exit_code: 0 },
    ],
    after_do: [], after_check: [], after_report: [],
  };

  try {
    const result = runHooks('before_do', {
      projectRoot: dir,
      feature: 'test-feature',
      featureDir: path.join(dir, '.built', 'features', 'test-feature'),
      runDir: path.join(dir, '.built', 'runtime', 'runs', 'test-feature'),
      hooks,
    });

    assert.strictEqual(result.halted, true);
    assert.strictEqual(result.failures.length, 1);
    assert.strictEqual(result.failures[0].isHalt, true);
  } finally {
    cleanup(dir);
  }
});

test('halt_on_fail: true 실패 후 이후 훅은 실행 안 함', () => {
  const dir = makeTemp();
  const executedFile = path.join(dir, 'second-hook-executed');

  const hooks = {
    before_do: [
      { type: 'command', run: 'exit 1', halt_on_fail: true, source: 'team',
        capture_output: false, expect_exit_code: 0 },
      { type: 'command', run: `touch ${executedFile}`, halt_on_fail: false, source: 'team',
        capture_output: false, expect_exit_code: 0 },
    ],
    after_do: [], after_check: [], after_report: [],
  };

  try {
    runHooks('before_do', {
      projectRoot: dir,
      feature: 'test-feature',
      featureDir: path.join(dir, '.built', 'features', 'test-feature'),
      runDir: path.join(dir, '.built', 'runtime', 'runs', 'test-feature'),
      hooks,
    });

    // 두 번째 훅(touch 명령)이 실행되지 않아야 함
    assert.strictEqual(fs.existsSync(executedFile), false, '두 번째 훅이 실행되면 안 됨');
  } finally {
    cleanup(dir);
  }
});

test('halt_on_fail: false 실패 시 halted: false, 다음 훅 계속 실행', () => {
  const dir = makeTemp();
  const executedFile = path.join(dir, 'second-hook-executed');

  const hooks = {
    after_do: [
      { type: 'command', run: 'exit 1', halt_on_fail: false, source: 'team',
        capture_output: false, expect_exit_code: 0 },
      { type: 'command', run: `touch ${executedFile}`, halt_on_fail: false, source: 'team',
        capture_output: false, expect_exit_code: 0 },
    ],
    before_do: [], after_check: [], after_report: [],
  };

  try {
    const result = runHooks('after_do', {
      projectRoot: dir,
      feature: 'test-feature',
      featureDir: path.join(dir, '.built', 'features', 'test-feature'),
      runDir: path.join(dir, '.built', 'runtime', 'runs', 'test-feature'),
      hooks,
    });

    assert.strictEqual(result.halted, false);
    assert.strictEqual(result.failures[0].isHalt, false);
    // 두 번째 훅은 계속 실행되어야 함
    assert.strictEqual(fs.existsSync(executedFile), true, '두 번째 훅이 실행되어야 함');
  } finally {
    cleanup(dir);
  }
});

test('훅이 없는 hookPoint에서 runHooks 호출 → halted: false, 빈 배열', () => {
  const dir = makeTemp();
  const hooks = { before_do: [], after_do: [], after_check: [], after_report: [] };

  const result = runHooks('before_do', {
    projectRoot: dir,
    feature: 'test-feature',
    featureDir: path.join(dir, 'features', 'test-feature'),
    runDir: path.join(dir, 'runs', 'test-feature'),
    hooks,
  });

  assert.strictEqual(result.halted, false);
  assert.deepStrictEqual(result.failures, []);
  assert.deepStrictEqual(result.capturedOutputs, []);
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// 테스트 그룹 4: 환경변수 주입
// ---------------------------------------------------------------------------

console.log('\n=== runHooks: env 주입 ===');

test('BUILT_HOOK_POINT, BUILT_FEATURE, BUILT_PROJECT_ROOT 주입 확인', () => {
  const dir = makeTemp();
  const outFile = path.join(dir, 'env-out.txt');

  const hooks = {
    before_do: [
      {
        type: 'command',
        run: `printf '%s\\n%s\\n%s' "$BUILT_HOOK_POINT" "$BUILT_FEATURE" "$BUILT_PROJECT_ROOT" > ${outFile}`,
        halt_on_fail: false,
        source: 'team',
        capture_output: false,
        expect_exit_code: 0,
      },
    ],
    after_do: [], after_check: [], after_report: [],
  };

  try {
    runHooks('before_do', {
      projectRoot: dir,
      feature: 'my-feature',
      featureDir: path.join(dir, 'features', 'my-feature'),
      runDir: path.join(dir, 'runs', 'my-feature'),
      hooks,
    });

    const out = fs.readFileSync(outFile, 'utf8').trim().split('\n');
    assert.strictEqual(out[0], 'before_do');
    assert.strictEqual(out[1], 'my-feature');
    assert.strictEqual(out[2], dir);
  } finally {
    cleanup(dir);
  }
});

test('capture_output: true 시 출력이 capturedOutputs에 담김', () => {
  const dir = makeTemp();

  const hooks = {
    after_do: [
      {
        type: 'command',
        run: 'echo hello-from-hook',
        halt_on_fail: false,
        source: 'team',
        capture_output: true,
        expect_exit_code: 0,
      },
    ],
    before_do: [], after_check: [], after_report: [],
  };

  try {
    const result = runHooks('after_do', {
      projectRoot: dir,
      feature: 'test-feature',
      featureDir: path.join(dir, 'features', 'test-feature'),
      runDir: path.join(dir, 'runs', 'test-feature'),
      hooks,
    });

    assert.strictEqual(result.capturedOutputs.length, 1);
    assert.ok(result.capturedOutputs[0].output.includes('hello-from-hook'));
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// 테스트 그룹 5: injectFailuresIntoCheckResult (iter 연동)
// ---------------------------------------------------------------------------

console.log('\n=== injectFailuresIntoCheckResult: iter 연동 ===');

test('check-result.md 없을 때 새로 생성 (needs_changes)', () => {
  const dir = makeTemp();
  const featureDir = path.join(dir, 'features', 'test-feature');
  fs.mkdirSync(featureDir, { recursive: true });

  const failures = [
    { label: 'lint', message: 'ESLint: 3 errors', isHalt: true },
  ];

  injectFailuresIntoCheckResult(featureDir, failures, true);

  const checkResultPath = path.join(featureDir, 'check-result.md');
  assert.ok(fs.existsSync(checkResultPath), 'check-result.md가 생성되어야 함');

  const content = fs.readFileSync(checkResultPath, 'utf8');
  assert.ok(content.includes('needs_changes'), 'status: needs_changes 포함');
  assert.ok(content.includes('[hook-failure]'), 'hook-failure 레이블 포함');
  assert.ok(content.includes('ESLint: 3 errors'), '오류 메시지 포함');

  cleanup(dir);
});

test('기존 approved check-result.md를 needs_changes로 강제 변경 (halt_on_fail: true)', () => {
  const dir = makeTemp();
  const featureDir = path.join(dir, 'features', 'test-feature');
  fs.mkdirSync(featureDir, { recursive: true });

  const checkResultPath = path.join(featureDir, 'check-result.md');
  fs.writeFileSync(checkResultPath, [
    '---',
    'status: approved',
    'issues: []',
    '---',
    '',
    '모든 항목 통과.',
  ].join('\n'), 'utf8');

  const failures = [
    { label: 'npm run build', message: 'Build failed: missing module', isHalt: true },
  ];

  injectFailuresIntoCheckResult(featureDir, failures, true);

  const updated = fs.readFileSync(checkResultPath, 'utf8');
  assert.ok(updated.includes('needs_changes'), '상태가 needs_changes로 변경되어야 함');
  assert.ok(updated.includes('[hook-failure]'), 'hook-failure 이슈 추가됨');
  assert.ok(updated.includes('Build failed: missing module'), '실패 메시지 포함');

  cleanup(dir);
});

test('halt_on_fail: false 실패는 경고로만 기록 (status 유지)', () => {
  const dir = makeTemp();
  const featureDir = path.join(dir, 'features', 'test-feature');
  fs.mkdirSync(featureDir, { recursive: true });

  const checkResultPath = path.join(featureDir, 'check-result.md');
  fs.writeFileSync(checkResultPath, [
    '---',
    'status: approved',
    'issues: []',
    '---',
    '',
    '모든 항목 통과.',
  ].join('\n'), 'utf8');

  const failures = [
    { label: 'coverage', message: 'Coverage below 80%', isHalt: false },
  ];

  injectFailuresIntoCheckResult(featureDir, failures, false);

  const updated = fs.readFileSync(checkResultPath, 'utf8');
  // status는 approved 유지
  assert.ok(updated.includes('approved'), 'status: approved 유지');
  // 경고는 기록됨
  assert.ok(updated.includes('[hook-warning]'), 'hook-warning 레이블 포함');

  cleanup(dir);
});

test('기존 issues[]에 새 실패를 추가 (덮어쓰지 않음)', () => {
  const dir = makeTemp();
  const featureDir = path.join(dir, 'features', 'test-feature');
  fs.mkdirSync(featureDir, { recursive: true });

  const checkResultPath = path.join(featureDir, 'check-result.md');
  fs.writeFileSync(checkResultPath, [
    '---',
    'status: needs_changes',
    'issues: ["기존 이슈"]',
    '---',
    '',
    '수정 필요.',
  ].join('\n'), 'utf8');

  const failures = [
    { label: 'typecheck', message: 'Type error in foo.ts', isHalt: true },
  ];

  injectFailuresIntoCheckResult(featureDir, failures, true);

  const updated = fs.readFileSync(checkResultPath, 'utf8');
  assert.ok(updated.includes('기존 이슈'), '기존 이슈 유지');
  assert.ok(updated.includes('[hook-failure]'), '새 실패 추가');

  cleanup(dir);
});

test('halt_on_fail: true 실패는 본문에도 상세 내역 추가 (iter 프롬프트 인지용)', () => {
  const dir = makeTemp();
  const featureDir = path.join(dir, 'features', 'test-feature');
  fs.mkdirSync(featureDir, { recursive: true });

  const checkResultPath = path.join(featureDir, 'check-result.md');
  fs.writeFileSync(checkResultPath, '---\nstatus: approved\nissues: []\n---\n\n내용.\n', 'utf8');

  const failures = [
    { label: 'npm test', message: 'Test suite failed: 5 tests failed', isHalt: true },
  ];

  injectFailuresIntoCheckResult(featureDir, failures, true);

  const updated = fs.readFileSync(checkResultPath, 'utf8');
  // 본문에 Hook 실패 내역 섹션이 추가되어야 함 (iter 재실행 프롬프트가 이를 포함)
  assert.ok(updated.includes('Hook 실패 내역'), '본문에 Hook 실패 내역 섹션 추가');
  assert.ok(updated.includes('Test suite failed'), '실패 메시지 본문 포함');

  cleanup(dir);
});

// ---------------------------------------------------------------------------
// condition 평가 + runHooks 연동
// ---------------------------------------------------------------------------

console.log('\n=== condition + runHooks 연동 ===');

test('condition false인 훅은 건너뜀', () => {
  const dir = makeTemp();
  const executedFile = path.join(dir, 'hook-executed');

  const hooks = {
    after_check: [
      {
        type: 'command',
        run: `touch ${executedFile}`,
        condition: "check.status == 'approved'",
        halt_on_fail: false,
        source: 'team',
        capture_output: false,
        expect_exit_code: 0,
      },
    ],
    before_do: [], after_do: [], after_report: [],
  };

  try {
    runHooks('after_check', {
      projectRoot: dir,
      feature: 'test-feature',
      featureDir: path.join(dir, 'features', 'test-feature'),
      runDir: path.join(dir, 'runs', 'test-feature'),
      hooks,
      conditionContext: { check: { status: 'needs_changes' } },
    });

    // condition false → 훅 건너뜀 → 파일 생성 안 됨
    assert.strictEqual(fs.existsSync(executedFile), false, 'condition false 훅은 건너뜀');
  } finally {
    cleanup(dir);
  }
});

test('condition true인 훅은 실행됨', () => {
  const dir = makeTemp();
  const executedFile = path.join(dir, 'hook-executed');

  const hooks = {
    after_check: [
      {
        type: 'command',
        run: `touch ${executedFile}`,
        condition: "check.status == 'approved'",
        halt_on_fail: false,
        source: 'team',
        capture_output: false,
        expect_exit_code: 0,
      },
    ],
    before_do: [], after_do: [], after_report: [],
  };

  try {
    runHooks('after_check', {
      projectRoot: dir,
      feature: 'test-feature',
      featureDir: path.join(dir, 'features', 'test-feature'),
      runDir: path.join(dir, 'runs', 'test-feature'),
      hooks,
      conditionContext: { check: { status: 'approved' } },
    });

    assert.strictEqual(fs.existsSync(executedFile), true, 'condition true 훅은 실행됨');
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// 테스트 그룹: before_check / before_report 훅 포인트
// ---------------------------------------------------------------------------

console.log('\n=== before_check 훅 포인트 ===');

test('before_check halt_on_fail: true 실패 시 halted: true 반환', () => {
  const dir = makeTemp();
  try {
    const hooks = {
      before_check: [
        { type: 'command', run: 'exit 1', halt_on_fail: true, source: 'team',
          capture_output: false, expect_exit_code: 0 },
      ],
      before_do: [], after_do: [], after_check: [], before_report: [], after_report: [],
    };

    const result = runHooks('before_check', {
      projectRoot: dir,
      feature: 'test-feature',
      featureDir: path.join(dir, 'features', 'test-feature'),
      runDir: path.join(dir, 'runs', 'test-feature'),
      hooks,
    });

    assert.strictEqual(result.halted, true);
    assert.strictEqual(result.failures.length, 1);
    assert.strictEqual(result.failures[0].isHalt, true);
  } finally {
    cleanup(dir);
  }
});

test('before_check halt_on_fail: false 실패 시 halted: false, 이후 훅 계속', () => {
  const dir = makeTemp();
  const secondFile = path.join(dir, 'second-executed');
  try {
    const hooks = {
      before_check: [
        { type: 'command', run: 'exit 1', halt_on_fail: false, source: 'team',
          capture_output: false, expect_exit_code: 0 },
        { type: 'command', run: `touch ${secondFile}`, halt_on_fail: false, source: 'team',
          capture_output: false, expect_exit_code: 0 },
      ],
      before_do: [], after_do: [], after_check: [], before_report: [], after_report: [],
    };

    const result = runHooks('before_check', {
      projectRoot: dir,
      feature: 'test-feature',
      featureDir: path.join(dir, 'features', 'test-feature'),
      runDir: path.join(dir, 'runs', 'test-feature'),
      hooks,
    });

    assert.strictEqual(result.halted, false);
    assert.strictEqual(result.failures.length, 1);
    assert.strictEqual(result.failures[0].isHalt, false);
    assert.strictEqual(fs.existsSync(secondFile), true, '후속 훅은 계속 실행됨');
  } finally {
    cleanup(dir);
  }
});

test('before_check 성공 시 halted: false, failures 빈 배열', () => {
  const dir = makeTemp();
  try {
    const hooks = {
      before_check: [
        { type: 'command', run: 'exit 0', halt_on_fail: true, source: 'team',
          capture_output: false, expect_exit_code: 0 },
      ],
      before_do: [], after_do: [], after_check: [], before_report: [], after_report: [],
    };

    const result = runHooks('before_check', {
      projectRoot: dir,
      feature: 'test-feature',
      featureDir: path.join(dir, 'features', 'test-feature'),
      runDir: path.join(dir, 'runs', 'test-feature'),
      hooks,
    });

    assert.strictEqual(result.halted, false);
    assert.strictEqual(result.failures.length, 0);
  } finally {
    cleanup(dir);
  }
});

console.log('\n=== before_report 훅 포인트 ===');

test('before_report halt_on_fail: true 실패 시 halted: true 반환', () => {
  const dir = makeTemp();
  try {
    const hooks = {
      before_report: [
        { type: 'command', run: 'exit 1', halt_on_fail: true, source: 'team',
          capture_output: false, expect_exit_code: 0 },
      ],
      before_do: [], after_do: [], before_check: [], after_check: [], after_report: [],
    };

    const result = runHooks('before_report', {
      projectRoot: dir,
      feature: 'test-feature',
      featureDir: path.join(dir, 'features', 'test-feature'),
      runDir: path.join(dir, 'runs', 'test-feature'),
      hooks,
    });

    assert.strictEqual(result.halted, true);
    assert.strictEqual(result.failures.length, 1);
    assert.strictEqual(result.failures[0].isHalt, true);
  } finally {
    cleanup(dir);
  }
});

test('before_report halt_on_fail: false 실패 시 halted: false, 이후 훅 계속', () => {
  const dir = makeTemp();
  const secondFile = path.join(dir, 'second-executed');
  try {
    const hooks = {
      before_report: [
        { type: 'command', run: 'exit 1', halt_on_fail: false, source: 'team',
          capture_output: false, expect_exit_code: 0 },
        { type: 'command', run: `touch ${secondFile}`, halt_on_fail: false, source: 'team',
          capture_output: false, expect_exit_code: 0 },
      ],
      before_do: [], after_do: [], before_check: [], after_check: [], after_report: [],
    };

    const result = runHooks('before_report', {
      projectRoot: dir,
      feature: 'test-feature',
      featureDir: path.join(dir, 'features', 'test-feature'),
      runDir: path.join(dir, 'runs', 'test-feature'),
      hooks,
    });

    assert.strictEqual(result.halted, false);
    assert.strictEqual(result.failures.length, 1);
    assert.strictEqual(result.failures[0].isHalt, false);
    assert.strictEqual(fs.existsSync(secondFile), true, '후속 훅은 계속 실행됨');
  } finally {
    cleanup(dir);
  }
});

test('before_report 성공 시 halted: false, failures 빈 배열', () => {
  const dir = makeTemp();
  try {
    const hooks = {
      before_report: [
        { type: 'command', run: 'exit 0', halt_on_fail: true, source: 'team',
          capture_output: false, expect_exit_code: 0 },
      ],
      before_do: [], after_do: [], before_check: [], after_check: [], after_report: [],
    };

    const result = runHooks('before_report', {
      projectRoot: dir,
      feature: 'test-feature',
      featureDir: path.join(dir, 'features', 'test-feature'),
      runDir: path.join(dir, 'runs', 'test-feature'),
      hooks,
    });

    assert.strictEqual(result.halted, false);
    assert.strictEqual(result.failures.length, 0);
  } finally {
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// 테스트 그룹: buildHookEnv — 민감정보 필터링
// ---------------------------------------------------------------------------

console.log('\n=== buildHookEnv: 민감정보 필터링 ===');

test('SENSITIVE_ENV_PATTERN: _KEY 접미어 매칭', () => {
  assert.ok(SENSITIVE_ENV_PATTERN.test('ANTHROPIC_API_KEY'));
  assert.ok(SENSITIVE_ENV_PATTERN.test('OPENAI_API_KEY'));
  assert.ok(SENSITIVE_ENV_PATTERN.test('MY_PRIVATE_KEY'));
});

test('SENSITIVE_ENV_PATTERN: _SECRET, _TOKEN, _PASSWORD 매칭', () => {
  assert.ok(SENSITIVE_ENV_PATTERN.test('GITHUB_TOKEN'));
  assert.ok(SENSITIVE_ENV_PATTERN.test('DB_PASSWORD'));
  assert.ok(SENSITIVE_ENV_PATTERN.test('OAUTH_CLIENT_SECRET'));
  assert.ok(SENSITIVE_ENV_PATTERN.test('AWS_ACCESS_TOKEN'));
  assert.ok(SENSITIVE_ENV_PATTERN.test('MY_REFRESH_TOKEN'));
});

test('SENSITIVE_ENV_PATTERN: 안전한 키는 매칭하지 않음', () => {
  assert.ok(!SENSITIVE_ENV_PATTERN.test('PATH'));
  assert.ok(!SENSITIVE_ENV_PATTERN.test('HOME'));
  assert.ok(!SENSITIVE_ENV_PATTERN.test('NODE_PATH'));
  assert.ok(!SENSITIVE_ENV_PATTERN.test('BUILT_FEATURE'));
  assert.ok(!SENSITIVE_ENV_PATTERN.test('BUILT_PROVIDER'));
  assert.ok(!SENSITIVE_ENV_PATTERN.test('MY_KEYBASE_DIR'));  // 접미어가 아닌 경우
});

test('buildHookEnv: 민감 키는 결과에 포함되지 않음', () => {
  const base = {
    PATH:             '/usr/bin:/bin',
    HOME:             '/home/user',
    ANTHROPIC_API_KEY: 'sk-ant-secret',
    GITHUB_TOKEN:      'ghp_token123',
    DB_PASSWORD:       'hunter2',
    OPENAI_API_KEY:    'sk-openai-key',
  };
  const builtVars = { BUILT_FEATURE: 'test' };

  const result = buildHookEnv(base, builtVars);

  assert.strictEqual(result.PATH, '/usr/bin:/bin', 'PATH는 유지');
  assert.strictEqual(result.HOME, '/home/user', 'HOME은 유지');
  assert.strictEqual(result.BUILT_FEATURE, 'test', 'BUILT_* 변수 포함');
  assert.ok(!('ANTHROPIC_API_KEY' in result), 'API KEY 제거');
  assert.ok(!('GITHUB_TOKEN' in result), 'TOKEN 제거');
  assert.ok(!('DB_PASSWORD' in result), 'PASSWORD 제거');
  assert.ok(!('OPENAI_API_KEY' in result), 'API KEY 제거');
});

test('buildHookEnv: builtVars는 base를 덮어씀', () => {
  const base     = { BUILT_FEATURE: 'old-feature', PATH: '/usr/bin' };
  const builtVars = { BUILT_FEATURE: 'new-feature' };

  const result = buildHookEnv(base, builtVars);
  assert.strictEqual(result.BUILT_FEATURE, 'new-feature');
});

// ---------------------------------------------------------------------------
// 테스트 그룹: runHooks — provider-aware context env 주입
// ---------------------------------------------------------------------------

console.log('\n=== runHooks: provider-aware context 환경변수 주입 ===');

test('providerContext 미전달 시 BUILT_PROVIDER 등은 빈 문자열', () => {
  const dir = makeTemp();
  const outFile = path.join(dir, 'provider-env.txt');

  const hooks = {
    after_do: [
      {
        type: 'command',
        run: `printf '%s\\n%s\\n%s\\n%s\\n%s' "$BUILT_PROVIDER" "$BUILT_PHASE" "$BUILT_PROVIDER_STATUS" "$BUILT_FAILURE_SUMMARY" "$BUILT_MODEL" > ${outFile}`,
        halt_on_fail: false,
        source: 'team',
        capture_output: false,
        expect_exit_code: 0,
      },
    ],
    before_do: [], after_check: [], before_check: [], before_report: [], after_report: [],
  };

  try {
    runHooks('after_do', {
      projectRoot: dir,
      feature: 'my-feature',
      featureDir: path.join(dir, 'features', 'my-feature'),
      runDir: path.join(dir, 'runs', 'my-feature'),
      hooks,
    });

    const lines = fs.readFileSync(outFile, 'utf8').split('\n');
    assert.strictEqual(lines[0], '', 'BUILT_PROVIDER 빈 문자열');
    assert.strictEqual(lines[1], '', 'BUILT_PHASE 빈 문자열');
    assert.strictEqual(lines[2], '', 'BUILT_PROVIDER_STATUS 빈 문자열');
    assert.strictEqual(lines[3], '', 'BUILT_FAILURE_SUMMARY 빈 문자열');
    assert.strictEqual(lines[4], '', 'BUILT_MODEL 빈 문자열');
  } finally {
    cleanup(dir);
  }
});

test('providerContext 전달 시 BUILT_PROVIDER 등이 주입됨', () => {
  const dir = makeTemp();
  const outFile = path.join(dir, 'provider-env.txt');

  const hooks = {
    after_do: [
      {
        type: 'command',
        run: `printf '%s\\n%s\\n%s\\n%s\\n%s' "$BUILT_PROVIDER" "$BUILT_PHASE" "$BUILT_PROVIDER_STATUS" "$BUILT_FAILURE_SUMMARY" "$BUILT_MODEL" > ${outFile}`,
        halt_on_fail: false,
        source: 'team',
        capture_output: false,
        expect_exit_code: 0,
      },
    ],
    before_do: [], after_check: [], before_check: [], before_report: [], after_report: [],
  };

  try {
    runHooks('after_do', {
      projectRoot: dir,
      feature: 'my-feature',
      featureDir: path.join(dir, 'features', 'my-feature'),
      runDir: path.join(dir, 'runs', 'my-feature'),
      hooks,
      providerContext: {
        provider:       'claude',
        phase:          'do',
        providerStatus: 'completed',
        failureSummary: '',
        model:          'claude-sonnet-4-5',
      },
    });

    const lines = fs.readFileSync(outFile, 'utf8').split('\n');
    assert.strictEqual(lines[0], 'claude',            'BUILT_PROVIDER');
    assert.strictEqual(lines[1], 'do',                'BUILT_PHASE');
    assert.strictEqual(lines[2], 'completed',         'BUILT_PROVIDER_STATUS');
    assert.strictEqual(lines[3], '',                  'BUILT_FAILURE_SUMMARY 빈 문자열');
    assert.strictEqual(lines[4], 'claude-sonnet-4-5', 'BUILT_MODEL');
  } finally {
    cleanup(dir);
  }
});

test('providerContext 실패 시 BUILT_FAILURE_SUMMARY 주입됨', () => {
  const dir = makeTemp();
  const outFile = path.join(dir, 'failure-env.txt');

  const hooks = {
    after_do: [
      {
        type: 'command',
        run: `printf '%s\\n%s' "$BUILT_PROVIDER_STATUS" "$BUILT_FAILURE_SUMMARY" > ${outFile}`,
        halt_on_fail: false,
        source: 'team',
        capture_output: false,
        expect_exit_code: 0,
      },
    ],
    before_do: [], after_check: [], before_check: [], before_report: [], after_report: [],
  };

  try {
    runHooks('after_do', {
      projectRoot: dir,
      feature: 'my-feature',
      featureDir: path.join(dir, 'features', 'my-feature'),
      runDir: path.join(dir, 'runs', 'my-feature'),
      hooks,
      providerContext: {
        provider:       'codex',
        phase:          'do',
        providerStatus: 'failed',
        failureSummary: 'auth error: codex login required',
        model:          'gpt-5.5',
      },
    });

    const lines = fs.readFileSync(outFile, 'utf8').split('\n');
    assert.strictEqual(lines[0], 'failed',                       'BUILT_PROVIDER_STATUS');
    assert.strictEqual(lines[1], 'auth error: codex login required', 'BUILT_FAILURE_SUMMARY');
  } finally {
    cleanup(dir);
  }
});

test('runHooks: 민감 env 변수가 hook 프로세스에 전달되지 않음', () => {
  const dir = makeTemp();
  const outFile = path.join(dir, 'sensitive-check.txt');

  // 테스트 전용: process.env에 임시 민감 키 설정
  process.env.TEST_HOOK_API_KEY   = 'super-secret-key';
  process.env.TEST_HOOK_SAFE_VAR  = 'safe-value';

  const hooks = {
    before_do: [
      {
        type: 'command',
        run: `printf '%s\\n%s' "$TEST_HOOK_API_KEY" "$TEST_HOOK_SAFE_VAR" > ${outFile}`,
        halt_on_fail: false,
        source: 'team',
        capture_output: false,
        expect_exit_code: 0,
      },
    ],
    after_do: [], after_check: [], before_check: [], before_report: [], after_report: [],
  };

  try {
    runHooks('before_do', {
      projectRoot: dir,
      feature: 'test-feature',
      featureDir: path.join(dir, 'features', 'test-feature'),
      runDir: path.join(dir, 'runs', 'test-feature'),
      hooks,
    });

    const lines = fs.readFileSync(outFile, 'utf8').split('\n');
    assert.strictEqual(lines[0], '', 'API_KEY는 빈 문자열 (전달되지 않음)');
    assert.strictEqual(lines[1], 'safe-value', '안전한 변수는 전달됨');
  } finally {
    delete process.env.TEST_HOOK_API_KEY;
    delete process.env.TEST_HOOK_SAFE_VAR;
    cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// 결과 출력
// ---------------------------------------------------------------------------

console.log(`\n결과: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
