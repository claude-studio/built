#!/usr/bin/env node
/**
 * test/kg-checker.test.js
 *
 * kg-checker.js 관련 단위 테스트.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkKg } = require('../src/kg-checker');

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

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kg-checker-test-'));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

console.log('\n[kg-checker]');

test('goals/reviews 디렉토리 없으면 schema-gap 진단', () => {
  const dir = makeTmpDir();
  try {
    writeFile(path.join(dir, 'kg', '_index.md'), '# index\n');
    writeFile(path.join(dir, 'kg', '_schema.md'), '# schema\n');
    writeFile(path.join(dir, 'kg', 'workflows', 'wf-1.md'), '---\nid: WF-1\ntitle: x\ntype: workflow\ndate: 2026-04-24\n---\n');
    writeFile(path.join(dir, 'kg', 'agents', 'agent-1.md'), '---\nid: A-1\n---\n');

    const result = checkKg(dir);
    assert.ok(result.findings.some((f) => f.includes('kg/goals/ 디렉토리 없음')), 'goals schema-gap 필요');
    assert.ok(result.findings.some((f) => f.includes('kg/reviews/ 디렉토리 없음')), 'reviews schema-gap 필요');
  } finally {
    rmDir(dir);
  }
});

test('goal/review 필수 필드와 dangling goal 참조를 검사', () => {
  const dir = makeTmpDir();
  try {
    writeFile(path.join(dir, 'kg', '_index.md'), '# index\n');
    writeFile(path.join(dir, 'kg', '_schema.md'), '# schema\n');
    writeFile(path.join(dir, 'kg', 'agents', 'agent-1.md'), '---\nid: A-1\n---\n');
    writeFile(path.join(dir, 'kg', 'workflows', 'wf-1.md'), '---\nid: WF-1\ntitle: x\ntype: workflow\ndate: 2026-04-24\n---\n');
    writeFile(path.join(dir, 'kg', 'goals', 'north-star.md'), [
      '---',
      'id: GOAL-1',
      'title: North Star',
      'type: goal',
      'date: 2026-04-24',
      'status: active',
      '---',
      '',
      '# goal',
      '',
    ].join('\n'));
    writeFile(path.join(dir, 'kg', 'reviews', 'daily-2026-04-24.md'), [
      '---',
      'id: REVIEW-2026-04-24',
      'title: Daily Alignment Review',
      'type: review',
      'date: 2026-04-24',
      'status: mixed',
      'goal: GOAL-999',
      'drifts_from: ["GOAL-998"]',
      '---',
      '',
      '# review',
      '',
    ].join('\n'));

    const result = checkKg(dir);
    assert.ok(result.findings.some((f) => f.includes('kg/goals/north-star.md') && f.includes('horizon')), 'goal 필수 필드 검사 필요');
    assert.ok(result.findings.some((f) => f.includes('kg/reviews/daily-2026-04-24.md') && f.includes('GOAL-999')), 'review dangling goal 검사 필요');
    assert.ok(result.findings.some((f) => f.includes('kg/reviews/daily-2026-04-24.md') && f.includes('GOAL-998')), 'review drifts_from dangling 검사 필요');
  } finally {
    rmDir(dir);
  }
});

test('review.status enum과 drifts_from 일관성을 검사', () => {
  const dir = makeTmpDir();
  try {
    writeFile(path.join(dir, 'kg', '_index.md'), '# index\n');
    writeFile(path.join(dir, 'kg', '_schema.md'), '# schema\n');
    writeFile(path.join(dir, 'kg', 'agents', 'agent-1.md'), '---\nid: A-1\n---\n');
    writeFile(path.join(dir, 'kg', 'workflows', 'wf-1.md'), '---\nid: WF-1\ntitle: x\ntype: workflow\ndate: 2026-04-24\n---\n');
    writeFile(path.join(dir, 'kg', 'goals', 'north-star.md'), [
      '---',
      'id: GOAL-1',
      'title: North Star',
      'type: goal',
      'date: 2026-04-24',
      'status: active',
      'horizon: long-term',
      '---',
      '',
      '# goal',
      '',
    ].join('\n'));
    writeFile(path.join(dir, 'kg', 'reviews', 'bad-aligned.md'), [
      '---',
      'id: REVIEW-1',
      'title: Bad Aligned',
      'type: review',
      'date: 2026-04-24',
      'status: aligned',
      'goal: GOAL-1',
      'drifts_from: ["GOAL-1"]',
      '---',
      '',
      '# review',
      '',
    ].join('\n'));
    writeFile(path.join(dir, 'kg', 'reviews', 'bad-drifted.md'), [
      '---',
      'id: REVIEW-2',
      'title: Bad Drifted',
      'type: review',
      'date: 2026-04-24',
      'status: drifted',
      'goal: GOAL-1',
      '---',
      '',
      '# review',
      '',
    ].join('\n'));
    writeFile(path.join(dir, 'kg', 'reviews', 'bad-status.md'), [
      '---',
      'id: REVIEW-3',
      'title: Bad Status',
      'type: review',
      'date: 2026-04-24',
      'status: unknown',
      'goal: GOAL-1',
      '---',
      '',
      '# review',
      '',
    ].join('\n'));

    const result = checkKg(dir);
    assert.ok(result.findings.some((f) => f.includes('bad-aligned.md') && f.includes('[status-mismatch]')), 'aligned/drifts mismatch 필요');
    assert.ok(result.findings.some((f) => f.includes('bad-drifted.md') && f.includes('[status-mismatch]')), 'drifted without drifts_from mismatch 필요');
    assert.ok(result.findings.some((f) => f.includes('bad-status.md') && f.includes('[invalid-value]')), 'invalid status 검사 필요');
  } finally {
    rmDir(dir);
  }
});

test('issue/decision supports_goal dangling 참조를 검사', () => {
  const dir = makeTmpDir();
  try {
    writeFile(path.join(dir, 'kg', '_index.md'), '# index\n');
    writeFile(path.join(dir, 'kg', '_schema.md'), '# schema\n');
    writeFile(path.join(dir, 'kg', 'agents', 'agent-1.md'), '---\nid: A-1\n---\n');
    writeFile(path.join(dir, 'kg', 'workflows', 'wf-1.md'), '---\nid: WF-1\ntitle: x\ntype: workflow\ndate: 2026-04-24\n---\n');
    writeFile(path.join(dir, 'kg', 'issues', 'BUI-1.md'), [
      '---',
      'id: BUI-1',
      'title: Issue',
      'type: issue',
      'date: 2026-04-24',
      'status: completed',
      'agent: dev',
      'branch: main',
      'supports_goal: ["GOAL-404"]',
      '---',
      '',
      '# issue',
      '',
    ].join('\n'));
    writeFile(path.join(dir, 'kg', 'decisions', 'adr-1.md'), [
      '---',
      'id: ADR-1',
      'title: Decision',
      'type: decision',
      'date: 2026-04-24',
      'status: accepted',
      'context_issue: BUI-1',
      'supports_goal: ["GOAL-405"]',
      '---',
      '',
      '# decision',
      '',
    ].join('\n'));
    writeFile(path.join(dir, 'kg', 'goals', 'north-star.md'), [
      '---',
      'id: GOAL-1',
      'title: North Star',
      'type: goal',
      'date: 2026-04-24',
      'status: active',
      'horizon: long-term',
      '---',
      '',
      '# goal',
      '',
    ].join('\n'));
    writeFile(path.join(dir, 'kg', 'reviews', 'daily-2026-04-24.md'), [
      '---',
      'id: REVIEW-2026-04-24',
      'title: Daily Alignment Review',
      'type: review',
      'date: 2026-04-24',
      'status: aligned',
      'goal: GOAL-1',
      '---',
      '',
      '# review',
      '',
    ].join('\n'));

    const result = checkKg(dir);
    assert.ok(result.findings.some((f) => f.includes('kg/issues/BUI-1.md') && f.includes('GOAL-404')), 'issue supports_goal dangling 검사 필요');
    assert.ok(result.findings.some((f) => f.includes('kg/decisions/adr-1.md') && f.includes('GOAL-405')), 'decision supports_goal dangling 검사 필요');
  } finally {
    rmDir(dir);
  }
});

test('정상 goal/review 엔트리가 있으면 goals/reviews 관련 오류 없음', () => {
  const dir = makeTmpDir();
  try {
    writeFile(path.join(dir, 'kg', '_index.md'), '# index\n');
    writeFile(path.join(dir, 'kg', '_schema.md'), '# schema\n');
    writeFile(path.join(dir, 'kg', 'agents', 'agent-1.md'), '---\nid: A-1\n---\n');
    writeFile(path.join(dir, 'kg', 'workflows', 'wf-1.md'), '---\nid: WF-1\ntitle: x\ntype: workflow\ndate: 2026-04-24\n---\n');
    writeFile(path.join(dir, 'kg', 'goals', 'north-star.md'), [
      '---',
      'id: GOAL-1',
      'title: North Star',
      'type: goal',
      'date: 2026-04-24',
      'status: active',
      'horizon: long-term',
      '---',
      '',
      '# goal',
      '',
    ].join('\n'));
    writeFile(path.join(dir, 'kg', 'reviews', 'daily-2026-04-24.md'), [
      '---',
      'id: REVIEW-2026-04-24',
      'title: Daily Alignment Review',
      'type: review',
      'date: 2026-04-24',
      'status: aligned',
      'goal: GOAL-1',
      '---',
      '',
      '# review',
      '',
    ].join('\n'));

    const result = checkKg(dir);
    assert.ok(!result.findings.some((f) => f.includes('kg/goals/')), 'goals 관련 오류 없어야 함');
    assert.ok(!result.findings.some((f) => f.includes('kg/reviews/')), 'reviews 관련 오류 없어야 함');
    assert.ok(result.summary.includes('goals: 1'), `summary: ${result.summary}`);
    assert.ok(result.summary.includes('reviews: 1'), `summary: ${result.summary}`);
  } finally {
    rmDir(dir);
  }
});

test('goal이 2개 이상이고 review.goal이 스칼라면 migration-due를 알린다', () => {
  const dir = makeTmpDir();
  try {
    writeFile(path.join(dir, 'kg', '_index.md'), '# index\n');
    writeFile(path.join(dir, 'kg', '_schema.md'), '# schema\n');
    writeFile(path.join(dir, 'kg', 'agents', 'agent-1.md'), '---\nid: A-1\n---\n');
    writeFile(path.join(dir, 'kg', 'workflows', 'wf-1.md'), '---\nid: WF-1\ntitle: x\ntype: workflow\ndate: 2026-04-24\n---\n');
    writeFile(path.join(dir, 'kg', 'goals', 'north-star.md'), [
      '---',
      'id: GOAL-1',
      'title: North Star',
      'type: goal',
      'date: 2026-04-24',
      'status: active',
      'horizon: long-term',
      '---',
      '',
      '# goal',
      '',
    ].join('\n'));
    writeFile(path.join(dir, 'kg', 'goals', 'goal-2.md'), [
      '---',
      'id: GOAL-2',
      'title: Second Goal',
      'type: goal',
      'date: 2026-04-24',
      'status: active',
      'horizon: long-term',
      '---',
      '',
      '# goal',
      '',
    ].join('\n'));
    writeFile(path.join(dir, 'kg', 'reviews', 'daily-2026-04-24.md'), [
      '---',
      'id: REVIEW-2026-04-24',
      'title: Daily Alignment Review',
      'type: review',
      'date: 2026-04-24',
      'status: aligned',
      'goal: GOAL-1',
      '---',
      '',
      '# review',
      '',
    ].join('\n'));

    const result = checkKg(dir);
    assert.ok(result.findings.some((f) => f.includes('[migration-due]') && f.includes('daily-2026-04-24.md')), 'migration-due 필요');
  } finally {
    rmDir(dir);
  }
});

console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
if (failed > 0) process.exit(1);
