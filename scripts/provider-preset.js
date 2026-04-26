#!/usr/bin/env node
/**
 * scripts/provider-preset.js
 *
 * provider preset을 적용해 run-request.json을 생성하는 CLI helper.
 *
 * 사용법:
 *   node scripts/provider-preset.js <feature> --preset <preset-name>
 *   node scripts/provider-preset.js <feature> --preset codex-do
 *   node scripts/provider-preset.js <feature> --preset codex-do --model gpt-5.5
 *   node scripts/provider-preset.js --list
 *
 * .built/runtime/runs/<feature>/run-request.json에만 기록한다.
 * .built/config.json에는 절대 쓰지 않는다.
 */

'use strict';

const path = require('path');
const { listPresets, getPreset, buildRunRequest, writeRunRequest } = require('../src/providers/presets');

// ---------------------------------------------------------------------------
// 인자 파싱
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(name) {
  return args.includes(name);
}

// ---------------------------------------------------------------------------
// --list: preset 목록 출력
// ---------------------------------------------------------------------------

if (hasFlag('--list')) {
  console.log('사용 가능한 provider preset:\n');
  for (const name of listPresets()) {
    const providers = getPreset(name);
    const phases = Object.keys(providers);
    const desc = phases.length === 0
      ? '(기본 Claude, providers 설정 없음)'
      : phases.map(p => {
          const v = providers[p];
          const provName = typeof v === 'string' ? v : v.name;
          return `${p}=${provName}`;
        }).join(', ');
    console.log(`  ${name}  →  ${desc}`);
  }
  console.log('\n사용법: node scripts/provider-preset.js <feature> --preset <preset-name>');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// --help
// ---------------------------------------------------------------------------

if (hasFlag('--help') || hasFlag('-h') || args.length === 0) {
  console.log(`사용법:
  node scripts/provider-preset.js <feature> --preset <preset-name> [--model <model>]
  node scripts/provider-preset.js --list

옵션:
  --preset <name>    적용할 preset 이름 (--list로 목록 확인)
  --model <model>    전역 모델 지정 (예: claude-opus-4-5, gpt-5.5)
  --list             사용 가능한 preset 목록 출력

예시:
  node scripts/provider-preset.js user-auth --preset codex-do
  node scripts/provider-preset.js payment --preset claude-default --model claude-opus-4-5
  node scripts/provider-preset.js search --preset codex-all --model gpt-5.5`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 메인 실행
// ---------------------------------------------------------------------------

const featureId = args[0];
const preset = getArg('--preset');
const model = getArg('--model');

if (!featureId || featureId.startsWith('--')) {
  console.error('오류: feature 이름이 필요합니다.');
  console.error('사용법: node scripts/provider-preset.js <feature> --preset <preset-name>');
  process.exit(1);
}

if (!preset) {
  console.error('오류: --preset 옵션이 필요합니다.');
  console.error(`사용 가능한 preset: ${listPresets().join(', ')}`);
  console.error('사용법: node scripts/provider-preset.js <feature> --preset <preset-name>');
  process.exit(1);
}

try {
  const req = buildRunRequest({ featureId, preset, model: model || undefined });
  const cwd = process.cwd();
  const dir = path.join(cwd, '.built', 'runtime', 'runs', featureId);
  const filePath = writeRunRequest(dir, req);

  console.log(`[provider-preset] preset "${preset}" 적용 완료.`);
  console.log(`[provider-preset] 파일: ${path.relative(cwd, filePath)}`);

  if (req.providers) {
    const phases = Object.keys(req.providers);
    for (const phase of phases) {
      const v = req.providers[phase];
      const name = typeof v === 'string' ? v : v.name;
      const sandbox = typeof v === 'object' && v.sandbox ? ` (sandbox: ${v.sandbox})` : '';
      console.log(`  ${phase}: ${name}${sandbox}`);
    }
  } else {
    console.log('  (모든 phase Claude 기본값)');
  }

  console.log(`\n다음 단계: node scripts/run.js ${featureId}`);
} catch (err) {
  console.error(`오류: ${err.message}`);
  process.exit(1);
}
