#!/usr/bin/env node
/**
 * scripts/provider-doctor.js
 *
 * provider 환경 사전 점검 (diagnostics) 명령.
 * 실제 모델 호출 없이 Codex CLI 설치, app-server 지원, 인증 상태,
 * broker 상태, stale broker 후보, run-request provider 설정 유효성을 점검한다.
 *
 * 사용법:
 *   node scripts/provider-doctor.js [--json] [--cwd <path>] [--feature <featureId>]
 *
 * 옵션:
 *   --json              결과를 구조화 JSON으로 출력
 *   --cwd <path>        점검할 워크스페이스 경로 (기본: process.cwd())
 *   --feature <id>      특정 feature의 run-request.json provider 설정 점검
 *
 * 종료 코드:
 *   0 — 모든 점검 정상 또는 주의(warn)만 있음
 *   1 — 하나 이상의 점검 실패(fail)
 *
 * 외부 npm 패키지 없음. Node.js 내장 모듈만 사용.
 * docs/ops/provider-setup-guide.md 참고.
 */

'use strict';

const { runDoctorChecks } = require('../src/providers/doctor');

// ---------------------------------------------------------------------------
// 인자 파싱
// ---------------------------------------------------------------------------

const args      = process.argv.slice(2);
const jsonMode  = args.includes('--json');

const cwdIdx  = args.indexOf('--cwd');
const rootCwd = cwdIdx !== -1 ? args[cwdIdx + 1] : process.cwd();

const featureIdx = args.indexOf('--feature');
const featureId  = featureIdx !== -1 ? args[featureIdx + 1] : null;

// ---------------------------------------------------------------------------
// 출력 포맷
// ---------------------------------------------------------------------------

const STATUS_PREFIX = { ok: '[정상]', warn: '[주의]', fail: '[실패]' };

function printHuman(checks) {
  const hasFail = checks.some((c) => c.status === 'fail');
  const hasWarn = checks.some((c) => c.status === 'warn');
  const overallStatus = hasFail ? '실패' : hasWarn ? '주의' : '정상';

  process.stdout.write(`\n=== built provider doctor ===\n`);
  process.stdout.write(`전체 상태: ${overallStatus}\n\n`);

  for (const c of checks) {
    const prefix = STATUS_PREFIX[c.status] || '[?]';
    process.stdout.write(`${prefix} ${c.label}\n`);
    process.stdout.write(`       ${c.message}\n`);
    if (c.action) {
      process.stdout.write(`       -> 조치: ${c.action}\n`);
    }
  }

  process.stdout.write('\n');

  if (hasFail) {
    process.stdout.write('하나 이상의 점검이 실패했습니다. 위의 조치를 수행한 뒤 다시 점검하세요.\n');
    process.stdout.write('환경 준비 후: node scripts/provider-doctor.js\n\n');
  } else if (hasWarn) {
    process.stdout.write('주의 항목이 있습니다. 실행은 가능하지만 위의 조치를 확인하세요.\n\n');
  } else {
    process.stdout.write('모든 점검이 정상입니다. provider 환경이 준비되어 있습니다.\n\n');
  }
}

function printJson(checks) {
  const hasFail = checks.some((c) => c.status === 'fail');
  const hasWarn = checks.some((c) => c.status === 'warn');
  const overall = hasFail ? 'fail' : hasWarn ? 'warn' : 'ok';

  const output = {
    overall,
    checks: checks.map((c) => {
      const item = { id: c.id, status: c.status, label: c.label, message: c.message };
      if (c.action) item.action = c.action;
      return item;
    }),
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// 진입점
// ---------------------------------------------------------------------------

const checks = runDoctorChecks({ cwd: rootCwd, featureId });

if (jsonMode) {
  printJson(checks);
} else {
  printHuman(checks);
}

const hasFail = checks.some((c) => c.status === 'fail');
process.exit(hasFail ? 1 : 0);
