#!/usr/bin/env node
/**
 * Real Codex plan_synthesis smoke.
 *
 * 기본 테스트에서는 실행하지 않는다. 다음처럼 명시적으로 opt-in한다.
 *   BUILT_CODEX_PLAN_SYNTHESIS_SMOKE=1 node scripts/smoke-codex-plan-synthesis.js
 *
 * 실패 시 원인 축 안내:
 *   - provider_unavailable : Codex CLI 미설치 또는 app-server 미지원
 *   - 인증(auth)           : codex login 상태 미인증
 *   - timeout              : 실행 시간이 timeout_ms 초과
 *   - sandbox              : read-only sandbox와 do/iter 충돌 (plan에는 해당 없음)
 *   - model_response       : 모델 출력 파싱 실패
 */

'use strict';

const fs           = require('fs');
const os           = require('os');
const path         = require('path');
const childProcess = require('child_process');

const { checkLogin } = require('../src/providers/codex');

if (process.env.BUILT_CODEX_PLAN_SYNTHESIS_SMOKE !== '1') {
  console.log('[built:smoke] skip: BUILT_CODEX_PLAN_SYNTHESIS_SMOKE=1 설정 시 실제 Codex smoke를 실행합니다.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 사전 점검: Codex 가용성 및 인증 상태
// ---------------------------------------------------------------------------

const preCheck = checkLogin();
if (!preCheck.available) {
  if (preCheck.detail.includes('app-server')) {
    console.error('[built:smoke] 원인축: app-server — ' + preCheck.detail);
  } else {
    console.error('[built:smoke] 원인축: provider_unavailable — ' + preCheck.detail);
  }
  process.exit(1);
}
if (!preCheck.loggedIn) {
  console.error('[built:smoke] 원인축: 인증(auth) — ' + preCheck.detail);
  process.exit(1);
}

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'built-codex-plan-smoke-'));
const feature = 'codex-plan-smoke';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

try {
  fs.mkdirSync(path.join(projectRoot, '.built', 'features'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, '.built', 'features', `${feature}.md`),
    '# Codex plan smoke\n\n간단한 hello helper 구현 계획을 작성한다.\n',
    'utf8',
  );
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'codex-plan-smoke' }), 'utf8');

  writeJson(path.join(projectRoot, '.built', 'runtime', 'runs', feature, 'run-request.json'), {
    featureId: feature,
    planPath: `.built/features/${feature}.md`,
    createdAt: new Date().toISOString(),
    providers: {
      plan_synthesis: {
        name: 'codex',
        sandbox: 'read-only',
        timeout_ms: 900000,
      },
    },
    acceptance_criteria: ['hello helper 구현 계획이 있어야 한다.'],
    constraints: ['파일을 수정하지 않는다.'],
  });

  const scriptPath = path.join(__dirname, 'plan-synthesis.js');
  const result = childProcess.spawnSync(process.execPath, [scriptPath, feature], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    timeout: 1000 * 60 * 20,
  });

  const exitCode = result.status === null ? 1 : result.status;
  if (exitCode !== 0) {
    if (result.signal === 'SIGTERM' || result.status === null) {
      console.error('[built:smoke] 원인축: timeout — 실행 시간이 제한(20분)을 초과했습니다. timeout_ms를 조정하거나 재시도하세요.');
    } else {
      console.error('[built:smoke] 원인축: model_response 또는 미분류 — 위 출력을 확인하세요.');
    }
    process.exit(exitCode);
  }

  const outputPath = path.join(projectRoot, '.built', 'features', feature, 'plan-synthesis.json');
  const output = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  if (!output.output || !Array.isArray(output.output.steps)) {
    console.error('[built:smoke] plan-synthesis.json 필수 구조가 없습니다.');
    process.exit(1);
  }

  console.log(`[built:smoke] ok: ${outputPath}`);
  process.exit(0);
} finally {
  if (process.env.BUILT_KEEP_SMOKE_DIR !== '1') {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}
