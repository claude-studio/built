#!/usr/bin/env node
/** /built:apply <feature> [--dry-run] CLI entrypoint. */

'use strict';

const { applyFeature } = require('../src/worktree-apply');

function formatResult(result) {
  const lines = [];
  lines.push(`[built:apply] code: ${result.code}`);
  if (result.method) lines.push(`[built:apply] method: ${result.method}`);
  lines.push(`[built:apply] ${result.message}`);
  if (result.dryRun) lines.push('[built:apply] dry-run: root와 state.json을 변경하지 않았습니다.');
  if (result.recovery) lines.push(`[built:apply] recovery: ${result.recovery}`);
  return lines.join('\n');
}

function applyCommand(projectRoot, argv) {
  const args = Array.isArray(argv) ? argv : [];
  const feature = args.find((arg) => !arg.startsWith('--')) || null;
  const dryRun = args.includes('--dry-run');
  const unknown = args.filter((arg) => arg.startsWith('--') && arg !== '--dry-run');
  if (unknown.length > 0) {
    return {
      result: {
        ok: false,
        code: 'invalid_arguments',
        message: `지원하지 않는 옵션입니다: ${unknown.join(', ')}`,
        recovery: '사용법: /built:apply <feature> [--dry-run]',
      },
      output: null,
    };
  }
  if (!feature) {
    return {
      result: {
        ok: false,
        code: 'invalid_feature',
        message: 'feature 이름을 입력해주세요.',
        recovery: '예: /built:apply user-auth --dry-run',
      },
      output: null,
    };
  }

  const result = applyFeature(projectRoot, feature, { dryRun });
  return { result, output: formatResult(result) };
}

if (require.main === module) {
  const { result, output } = applyCommand(process.cwd(), process.argv.slice(2));
  const rendered = output || formatResult(result);
  if (result.ok) console.log(rendered);
  else console.error(rendered);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { applyCommand, formatResult };
