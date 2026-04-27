#!/usr/bin/env node
/**
 * test/agent-kg-writer.test.js
 *
 * Codex PDCA agent-local KG writer 단위 테스트.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  resolveAgentKgRoot,
  inferProjectSlug,
  extractCandidateSections,
  generateAgentKgDrafts,
} = require('../src/agent-kg-writer');
const { parse, stringify } = require('../src/frontmatter');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-kg-writer-test-'));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

console.log('\n[agent-kg-writer]');

test('project slug는 env > package name > basename 순서로 결정된다', () => {
  const root = makeTmpDir();
  try {
    writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@scope/My App' }));
    assert.strictEqual(inferProjectSlug(root, {}), 'scope-my-app');
    assert.strictEqual(inferProjectSlug(root, { BUILT_AGENT_PROJECT_SLUG: 'Custom Slug' }), 'custom-slug');
  } finally {
    rmDir(root);
  }
});

test('agent KG root는 agent folder projects/<slug>/kg 내부로 해석된다', () => {
  const agentRoot = makeTmpDir();
  const kgRoot = resolveAgentKgRoot({
    projectRoot: '/tmp/sample-project',
    agentRoot,
    projectSlug: 'demo-project',
    env: {},
  });

  assert.strictEqual(kgRoot, path.join(agentRoot, 'projects', 'demo-project', 'kg'));
  rmDir(agentRoot);
});

test('report의 KG 후보 섹션에서 decision/pattern/entity/workflow 후보를 분리한다', () => {
  const report = [
    '# Report',
    '',
    '## KG Draft Candidates',
    '',
    '### Decisions',
    '- agent-local-kg: KG output stays outside target repo',
    '### Patterns',
    '- markdown-only-kg: file-only reusable KG',
    '### Entities',
    '- project-slug: project namespace for agent KG',
    '### Workflows',
    '- report-to-plan: Report drafts feed next Plan',
    '',
  ].join('\n');

  const result = extractCandidateSections(report);
  assert.strictEqual(result.decisions[0].slug, 'agent-local-kg');
  assert.strictEqual(result.patterns[0].slug, 'markdown-only-kg');
  assert.strictEqual(result.entities[0].slug, 'project-slug');
  assert.strictEqual(result.workflows[0].slug, 'report-to-plan');
});

test('Report 결과로 agent-local issue/index/candidate 문서를 생성하고 target repo에는 쓰지 않는다', () => {
  const projectRoot = makeTmpDir();
  const agentRoot = makeTmpDir();
  try {
    const feature = 'agent-kg';
    const featureDir = path.join(projectRoot, '.built', 'features', feature);
    const specPath = path.join(projectRoot, '.built', 'features', `${feature}.md`);
    const doResultPath = path.join(featureDir, 'do-result.md');
    const checkResultPath = path.join(featureDir, 'check-result.md');
    const reportPath = path.join(featureDir, 'report.md');

    writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'demo-app' }));
    writeFile(specPath, stringify({
      id: feature,
      title: 'Agent KG',
      goal: 'Report 결과를 agent-local KG로 남긴다.',
    }, '# Spec\n'));
    writeFile(doResultPath, '## Do\n\n구현 완료');
    writeFile(checkResultPath, stringify({ status: 'approved' }, '## Check\n\n승인'));
    writeFile(reportPath, [
      '# Report',
      '',
      '완료',
      '',
      '### Decisions',
      '- local-only: target repo에 KG를 쓰지 않음',
      '### Patterns',
      '- report-candidate-split: report 후보를 별도 문서로 분리',
    ].join('\n'));

    const result = generateAgentKgDrafts({
      projectRoot,
      agentRoot,
      feature,
      specPath,
      doResultPath,
      checkResultPath,
      reportPath,
      env: {},
      now: new Date('2026-04-27T00:00:00Z'),
    });

    assert.strictEqual(result.kgRoot, path.join(agentRoot, 'projects', 'demo-app', 'kg'));
    assert.strictEqual(fs.existsSync(path.join(result.kgRoot, '_index.md')), true);
    assert.strictEqual(fs.existsSync(path.join(result.kgRoot, 'issues', 'AGENT-KG.md')), true);
    assert.strictEqual(fs.existsSync(path.join(result.kgRoot, 'decisions', 'local-only.md')), true);
    assert.strictEqual(fs.existsSync(path.join(result.kgRoot, 'patterns', 'report-candidate-split.md')), true);
    assert.strictEqual(fs.existsSync(path.join(projectRoot, 'kg')), false, 'target repo kg/가 생성되면 안 됨');

    const { data } = parse(fs.readFileSync(path.join(result.kgRoot, 'issues', 'AGENT-KG.md'), 'utf8'));
    assert.strictEqual(data.project, 'demo-app');
    assert.deepStrictEqual(data.kg_files, [
      'decisions/local-only.md',
      'patterns/report-candidate-split.md',
    ]);
  } finally {
    rmDir(projectRoot);
    rmDir(agentRoot);
  }
});

console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
if (failed > 0) process.exit(1);
