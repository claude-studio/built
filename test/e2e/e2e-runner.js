#!/usr/bin/env node
/**
 * test/e2e/e2e-runner.js
 *
 * E2E 테스트 엔트리포인트 — test/e2e/scenarios/ 디렉토리의 모든 시나리오를 순서대로 실행한다.
 * 외부 npm 패키지 없음 (Node.js 내장 fs/path/child_process만 사용).
 *
 * 사용법:
 *   node test/e2e/e2e-runner.js                       # 전체 시나리오
 *   node test/e2e/e2e-runner.js --filter provider     # 파일명에 "provider"가 포함된 시나리오만
 *                                                      # (04-fake-provider-file-contracts,
 *                                                      #  05-provider-equivalence-contracts)
 *
 * Exit codes:
 *   0 — 전체 시나리오 통과
 *   1 — 하나 이상의 시나리오 실패
 */

'use strict';

const fs           = require('fs');
const path         = require('path');
const childProcess = require('child_process');

const args        = process.argv.slice(2);
const filterIdx   = args.indexOf('--filter');
const filterToken = filterIdx !== -1 ? args[filterIdx + 1] : null;

const scenariosDir = path.join(__dirname, 'scenarios');

const scenarioFiles = fs.readdirSync(scenariosDir)
  .filter((f) => {
    if (!f.endsWith('.js')) return false;
    if (filterToken) return f.includes(filterToken);
    return true;
  })
  .sort()
  .map((f) => path.join(scenariosDir, f));

if (scenarioFiles.length === 0) {
  const suffix = filterToken ? ` (--filter "${filterToken}")` : '';
  console.error('[e2e] 시나리오 파일이 없습니다: ' + scenariosDir + suffix);
  process.exit(1);
}

let passed = 0;
let failed = 0;

const label = filterToken ? `[e2e:${filterToken}]` : '[e2e]';
console.log(`\n${label} ${scenarioFiles.length}개 시나리오 실행\n`);

for (const scenarioPath of scenarioFiles) {
  const name = path.basename(scenarioPath, '.js');
  process.stdout.write(`  ${name} ... `);

  const result = childProcess.spawnSync(process.execPath, [scenarioPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { NO_NOTIFY: '1' }),
    timeout: 30000,
  });

  if (result.status === 0) {
    console.log('ok');
    passed++;
  } else {
    console.log('FAIL');
    const output = (result.stdout || Buffer.alloc(0)).toString() +
                   (result.stderr  || Buffer.alloc(0)).toString();
    output.trim().split('\n').forEach((line) => console.error('    ' + line));
    failed++;
  }
}

console.log(`\n${label} 결과: ${passed} 통과, ${failed} 실패\n`);
process.exit(failed > 0 ? 1 : 0);
