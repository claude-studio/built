#!/usr/bin/env node
/**
 * test/do-kg-context.test.js
 *
 * scripts/do-kg-context.js 단위 테스트.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildDoKgContext,
  getPromptBudgetFromEnv,
} = require('../scripts/do-kg-context');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function writeFile(root, relPath, content) {
  const filePath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'built-do-kg-'));
  writeFile(root, 'kg/goals/north-star.md', [
    '---',
    'id: GOAL-1',
    'title: north star',
    'status: active',
    'tags: [control-plane, provider]',
    '---',
    '# north star',
    'Provider agnostic control plane.',
  ].join('\n'));
  writeFile(root, 'kg/workflows/plan-synthesis-provider-validation.md', [
    '---',
    'id: WF-1',
    'title: provider validation',
    'tags: [plan_synthesis, provider]',
    '---',
    '# provider validation',
    'Validate provider plan synthesis.',
  ].join('\n'));
  return root;
}

console.log('\n[do KG context]');

test('환경변수에서 prompt budget을 읽고 기본값을 제공한다', () => {
  const budget = getPromptBudgetFromEnv({
    BUILT_DO_PROMPT_MAX_CHARS: '12345',
    BUILT_DO_PROMPT_WARN_CHARS: '6789',
  });
  assert.strictEqual(budget.maxChars, 12345);
  assert.strictEqual(budget.warnChars, 6789);

  const fallback = getPromptBudgetFromEnv({});
  assert.ok(fallback.maxChars > fallback.warnChars);
});

test('mandatory KG와 명시 BUI issue를 full context에 포함한다', () => {
  const root = fixtureRoot();
  writeFile(root, 'kg/issues/BUI-350.md', [
    '---',
    'id: BUI-350',
    'title: Do prompt budget',
    'status: accepted',
    'tags: [kg, prompt]',
    '---',
    '# BUI-350',
    'Relevant issue body.',
  ].join('\n'));

  const result = buildDoKgContext({
    projectRoot: root,
    featureSpec: 'Implement BUI-350 with provider prompt budget.',
    maxSectionChars: 50000,
  });

  assert.ok(result.text.includes('kg/goals/north-star.md'));
  assert.ok(result.text.includes('kg/workflows/plan-synthesis-provider-validation.md'));
  assert.ok(result.text.includes('kg/issues/BUI-350.md'));
  assert.ok(result.text.includes('Relevant issue body.'));
});

test('많은 issue 문서가 있어도 full body와 index가 bounded 된다', () => {
  const root = fixtureRoot();
  for (let i = 1; i <= 200; i++) {
    writeFile(root, `kg/issues/BUI-${i}.md`, [
      '---',
      `id: BUI-${i}`,
      `title: Issue ${i}`,
      'status: done',
      'tags: [history]',
      '---',
      `# BUI-${i}`,
      'Historical issue body '.repeat(20),
    ].join('\n'));
  }

  const result = buildDoKgContext({
    projectRoot: root,
    featureSpec: 'Feature uses provider prompt budget.',
    maxSectionChars: 50000,
  });

  assert.ok(result.stats.full_docs <= 14, `full_docs=${result.stats.full_docs}`);
  assert.ok(result.stats.indexed_issues <= 40, `indexed_issues=${result.stats.indexed_issues}`);
  assert.ok(result.stats.skipped_issues > 100, `skipped_issues=${result.stats.skipped_issues}`);
});

test('많은 workflow 문서가 있어도 full body가 bounded 된다', () => {
  const root = fixtureRoot();
  for (let i = 1; i <= 20; i++) {
    writeFile(root, `kg/workflows/workflow-${i}.md`, [
      '---',
      `id: WF-${i}`,
      `title: Workflow ${i}`,
      'tags: [workflow, provider]',
      '---',
      `# Workflow ${i}`,
      'Workflow body.',
    ].join('\n'));
  }

  const result = buildDoKgContext({
    projectRoot: root,
    featureSpec: 'provider workflow prompt budget',
    maxSectionChars: 50000,
  });

  const workflowFull = result.selection.full.filter((doc) => doc.kind === 'workflow');
  assert.ok(workflowFull.length <= 4, `workflowFull=${workflowFull.length}`);
  assert.ok(result.stats.skipped_workflows >= 16, `skipped_workflows=${result.stats.skipped_workflows}`);
});

test('section budget에 맞춰 KG index와 body를 줄인다', () => {
  const root = fixtureRoot();
  writeFile(root, 'kg/issues/BUI-350.md', [
    '---',
    'id: BUI-350',
    'title: Large issue',
    'tags: [prompt]',
    '---',
    '# BUI-350',
    'x'.repeat(10000),
  ].join('\n'));

  const result = buildDoKgContext({
    projectRoot: root,
    featureSpec: 'BUI-350 prompt budget',
    maxSectionChars: 1000,
  });

  assert.ok(result.text.length <= 1000, `chars=${result.text.length}`);
});

console.log(`\n결과: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
