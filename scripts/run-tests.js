#!/usr/bin/env node
/**
 * scripts/run-tests.js
 *
 * 통합 테스트 러너 — 단위 테스트(test/*.test.js)와 E2E 테스트(test/e2e/)를 순서대로 실행한다.
 * 외부 npm 패키지 없음 (Node.js 내장 fs/path/child_process만 사용).
 *
 * 사용법:
 *   node scripts/run-tests.js         # 전체 테스트 (단위 + E2E)
 *   node scripts/run-tests.js --unit  # 단위 테스트만
 *   node scripts/run-tests.js --e2e   # E2E 테스트만
 *
 * Exit codes:
 *   0 — 전체 통과
 *   1 — 하나 이상 실패
 */

'use strict';

const fs           = require('fs');
const path         = require('path');
const childProcess = require('child_process');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// 인자 파싱
// ---------------------------------------------------------------------------

const args    = process.argv.slice(2);
const unitOnly = args.includes('--unit');
const e2eOnly  = args.includes('--e2e');

// ---------------------------------------------------------------------------
// 단위 테스트 파일 수집
// ---------------------------------------------------------------------------

function collectUnitTests() {
  const testDir = path.join(ROOT, 'test');
  return fs.readdirSync(testDir)
    .filter((f) => f.endsWith('.test.js'))
    .sort()
    .map((f) => path.join(testDir, f));
}

// ---------------------------------------------------------------------------
// 테스트 파일 실행
// ---------------------------------------------------------------------------

/**
 * Node.js 스크립트를 서브프로세스로 실행하고 결과를 반환한다.
 *
 * @param {string} filePath
 * @param {object} [extraEnv]
 * @returns {{ ok: boolean, output: string }}
 */
function runTestFile(filePath, extraEnv) {
  const result = childProcess.spawnSync(process.execPath, [filePath], {
    stdio:   ['ignore', 'pipe', 'pipe'],
    env:     Object.assign({}, process.env, { NO_NOTIFY: '1' }, extraEnv || {}),
    timeout: 60000,
  });

  const ok     = result.status === 0;
  const output = (result.stdout || Buffer.alloc(0)).toString() +
                 (result.stderr  || Buffer.alloc(0)).toString();
  return { ok, output };
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------

let totalPassed = 0;
let totalFailed = 0;

function runSuite(label, files, extraEnv) {
  if (files.length === 0) return;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${label} (${files.length}개 파일)`);
  console.log('='.repeat(60));

  for (const filePath of files) {
    const name = path.relative(ROOT, filePath);
    process.stdout.write(`\n  ${name}\n`);

    const { ok, output } = runTestFile(filePath, extraEnv);

    // 출력 들여쓰기
    output.trim().split('\n').forEach((line) => console.log('  ' + line));

    if (ok) {
      totalPassed++;
    } else {
      totalFailed++;
    }
  }
}

// 단위 테스트
if (!e2eOnly) {
  const unitFiles = collectUnitTests();
  runSuite('단위 테스트', unitFiles);
}

// E2E 테스트 (e2e-runner.js가 시나리오를 실행)
if (!unitOnly) {
  const e2eRunner = path.join(ROOT, 'test', 'e2e', 'e2e-runner.js');
  if (fs.existsSync(e2eRunner)) {
    runSuite('E2E 테스트', [e2eRunner]);
  }
}

// ---------------------------------------------------------------------------
// 최종 결과
// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`  최종 결과: ${totalPassed} 통과, ${totalFailed} 실패`);
console.log('='.repeat(60) + '\n');

process.exit(totalFailed > 0 ? 1 : 0);
