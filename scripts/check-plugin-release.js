#!/usr/bin/env node
/**
 * Claude Code plugin release packaging guard.
 *
 * This script verifies metadata, package-visible docs, and vendor notices that
 * must be present before marketplace packaging.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let failed = 0;

function pass(message) {
  console.log(`  ✓ ${message}`);
}

function fail(message) {
  console.error(`  ✗ ${message}`);
  failed++;
}

function check(message, fn) {
  try {
    fn();
    pass(message);
  } catch (error) {
    fail(`${message}: ${error.message}`);
  }
}

function readJson(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: 기대 ${expected}, 실제 ${actual}`);
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assertRequiredString(object, fieldPath, label) {
  const value = fieldPath.split('.').reduce((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return current[key];
  }, object);
  assert(typeof value === 'string' && value.trim().length > 0, `${label} 필드 없음`);
}

console.log('\n[plugin release metadata]');

check('.claude-plugin/plugin.json 필수 metadata', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  for (const field of ['name', 'version', 'description', 'repository', 'license']) {
    assertRequiredString(plugin, field, field);
  }
  assertRequiredString(plugin, 'author.name', 'author.name');
});

check('.claude-plugin/marketplace.json 필수 metadata', () => {
  const marketplace = readJson('.claude-plugin/marketplace.json');
  for (const field of ['name', 'owner.name', 'owner.email', 'metadata.description']) {
    assertRequiredString(marketplace, field, field);
  }
  assert(Array.isArray(marketplace.plugins) && marketplace.plugins.length > 0,
    'plugins 배열이 비어 있음');
  for (const plugin of marketplace.plugins) {
    for (const field of ['name', 'source', 'description']) {
      assertRequiredString(plugin, field, `plugins[].${field}`);
    }
    assert(exists(plugin.source), `marketplace source ${plugin.source} 없음`);
  }
  const built = marketplace.plugins.find((plugin) => plugin.name === 'built');
  assert(built, 'built plugin 항목 없음');
  assertEqual(built.source, './plugins/built', 'built source는 ./plugins/built 이어야 함');
});

check('plugins/built/.claude-plugin/plugin.json 필수 metadata', () => {
  const plugin = readJson('plugins/built/.claude-plugin/plugin.json');
  for (const field of ['name', 'description', 'skills']) {
    assertRequiredString(plugin, field, field);
  }
  const skillsPath = path.resolve(ROOT, 'plugins/built', plugin.skills);
  assert(fs.existsSync(skillsPath), `skills 경로 ${skillsPath} 없음`);
});

console.log('\n[package-visible release files]');

const requiredPackagePaths = [
  'plugins/built/.claude-plugin/plugin.json',
  'plugins/built/README.md',
  'plugins/built/docs/ops/provider-setup-guide.md',
  'plugins/built/docs/smoke-testing.md',
  'plugins/built/scripts/provider-doctor.js',
  'plugins/built/scripts/smoke-codex-do.js',
  'plugins/built/scripts/smoke-codex-plan-synthesis.js',
  'plugins/built/skills/doctor/SKILL.md',
  'plugins/built/skills/run-codex/SKILL.md',
  'plugins/built/src/providers/codex.js',
  'plugins/built/vendor/codex-plugin-cc/LICENSE',
  'plugins/built/vendor/codex-plugin-cc/NOTICE',
];

for (const relativePath of requiredPackagePaths) {
  check(`${relativePath} 포함`, () => {
    assert(exists(relativePath), `${relativePath} 없음`);
  });
}

console.log('\n[vendor license notice]');

check('vendor/codex-plugin-cc/LICENSE 포함 및 내용 확인', () => {
  const content = read('vendor/codex-plugin-cc/LICENSE');
  assert(content.includes('Apache License'), 'Apache License 문구 없음');
  assert(content.includes('Version 2.0'), 'Apache License Version 2.0 문구 없음');
  assert(content.trim().length > 100, 'LICENSE 내용이 비어 있거나 너무 짧음');
});

check('vendor/codex-plugin-cc/NOTICE 포함 및 내용 확인', () => {
  const content = read('vendor/codex-plugin-cc/NOTICE');
  assert(content.includes('Copyright 2026 OpenAI'), 'OpenAI copyright 문구 없음');
  assert(content.includes('Apache License, Version 2.0'), 'Apache License notice 문구 없음');
  assert(content.trim().length > 100, 'NOTICE 내용이 비어 있거나 너무 짧음');
});

console.log('\n[provider documentation links]');

check('README.md provider setup/smoke 문서 링크', () => {
  const readme = read('README.md');
  assert(readme.includes('docs/ops/provider-setup-guide.md'),
    'README.md에 provider setup guide 링크 없음');
  assert(readme.includes('docs/smoke-testing.md'),
    'README.md에 smoke testing guide 링크 없음');
});

check('plugin package README/docs/vendor 링크가 같은 package 안에서 해석됨', () => {
  const pluginRoot = path.join(ROOT, 'plugins/built');
  const links = [
    'README.md',
    'docs/ops/provider-setup-guide.md',
    'docs/smoke-testing.md',
    'vendor/codex-plugin-cc/LICENSE',
    'vendor/codex-plugin-cc/NOTICE',
  ];
  for (const link of links) {
    assert(fs.existsSync(path.join(pluginRoot, link)), `${link}가 package 안에서 해석되지 않음`);
  }
});

console.log('\n[release checklist]');

check('release checklist 문서와 명령 연결', () => {
  const checklist = read('docs/ops/plugin-release-checklist.md');
  assert(checklist.includes('npm run check:plugin-release'),
    'release checklist에 npm run check:plugin-release 없음');
  assert(checklist.includes('vendor/codex-plugin-cc/LICENSE'),
    'release checklist에 vendor LICENSE 기준 없음');
  assert(checklist.includes('docs/ops/provider-setup-guide.md'),
    'release checklist에 provider setup guide 기준 없음');
  const pkg = readJson('package.json');
  assert(pkg.scripts && pkg.scripts['check:plugin-release'] === 'node scripts/check-plugin-release.js',
    'package.json scripts.check:plugin-release 불일치');
});

console.log(`\n  plugin-release-check: ${failed === 0 ? '통과' : `${failed} 실패`}\n`);
process.exit(failed > 0 ? 1 : 0);
