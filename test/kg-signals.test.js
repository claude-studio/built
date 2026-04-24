#!/usr/bin/env node
/**
 * test/kg-signals.test.js
 *
 * kg-signals.js 관련 단위 테스트.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { listRecentReviews, readRecentDriftSignals } = require('../src/kg-signals');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kg-signals-test-'));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeReview(root, name, { date, status = 'mixed', goal = 'GOAL-1', driftsFrom = [] }) {
  writeFile(path.join(root, 'kg', 'reviews', name), [
    '---',
    `id: ${name.replace(/\.md$/, '')}`,
    'title: Daily Alignment Review',
    'type: review',
    `date: ${date}`,
    `status: ${status}`,
    `goal: ${goal}`,
    `drifts_from: [${driftsFrom.join(', ')}]`,
    '---',
    '',
    '# review',
    '',
  ].join('\n'));
}

console.log('\n[kg-signals]');

test('최근 N일 review를 date 내림차순으로 읽는다', () => {
  const dir = makeTmpDir();
  try {
    writeReview(dir, 'r1.md', { date: '2026-04-22', driftsFrom: ['GOAL-1'] });
    writeReview(dir, 'r2.md', { date: '2026-04-24', driftsFrom: ['GOAL-1'] });
    writeReview(dir, 'r3.md', { date: '2026-04-23', driftsFrom: [] });

    const reviews = listRecentReviews({
      kgDir: path.join(dir, 'kg'),
      days: 7,
      now: new Date('2026-04-24T12:00:00Z'),
    });

    assert.deepStrictEqual(reviews.map((r) => r.dateText), ['2026-04-24', '2026-04-23', '2026-04-22']);
  } finally {
    rmDir(dir);
  }
});

test('최신 review 기준 현재 drift streak만 신호로 만든다', () => {
  const dir = makeTmpDir();
  try {
    writeReview(dir, 'r1.md', { date: '2026-04-22', driftsFrom: ['GOAL-1'] });
    writeReview(dir, 'r2.md', { date: '2026-04-23', driftsFrom: ['GOAL-1'] });
    writeReview(dir, 'r3.md', { date: '2026-04-24', driftsFrom: ['GOAL-1', 'GOAL-2'] });

    const result = readRecentDriftSignals({
      kgDir: path.join(dir, 'kg'),
      days: 7,
      minConsecutive: 2,
      now: new Date('2026-04-24T12:00:00Z'),
    });

    assert.strictEqual(result.signals.length, 1);
    assert.strictEqual(result.signals[0].goal, 'GOAL-1');
    assert.strictEqual(result.signals[0].count, 3);
    assert.deepStrictEqual(result.signals[0].dates, ['2026-04-22', '2026-04-23', '2026-04-24']);
    assert.ok(!result.signals.some((s) => s.goal === 'GOAL-2'), 'GOAL-2는 count=1이라 신호 없어야 함');
  } finally {
    rmDir(dir);
  }
});

test('최신 review에 없는 goal의 과거 streak는 신호로 만들지 않는다', () => {
  const dir = makeTmpDir();
  try {
    writeReview(dir, 'r1.md', { date: '2026-04-22', driftsFrom: ['GOAL-1'] });
    writeReview(dir, 'r2.md', { date: '2026-04-23', driftsFrom: ['GOAL-1'] });
    writeReview(dir, 'r3.md', { date: '2026-04-24', status: 'aligned', driftsFrom: [] });

    const result = readRecentDriftSignals({
      kgDir: path.join(dir, 'kg'),
      days: 7,
      minConsecutive: 2,
      now: new Date('2026-04-24T12:00:00Z'),
    });

    assert.strictEqual(result.signals.length, 0);
  } finally {
    rmDir(dir);
  }
});

test('days 윈도우 밖 review는 제외한다', () => {
  const dir = makeTmpDir();
  try {
    writeReview(dir, 'old.md', { date: '2026-04-10', driftsFrom: ['GOAL-1'] });
    writeReview(dir, 'new1.md', { date: '2026-04-23', driftsFrom: ['GOAL-1'] });
    writeReview(dir, 'new2.md', { date: '2026-04-24', driftsFrom: ['GOAL-1'] });

    const result = readRecentDriftSignals({
      kgDir: path.join(dir, 'kg'),
      days: 7,
      minConsecutive: 2,
      now: new Date('2026-04-24T12:00:00Z'),
    });

    assert.strictEqual(result.signals.length, 1);
    assert.strictEqual(result.signals[0].count, 2);
  } finally {
    rmDir(dir);
  }
});

console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
if (failed > 0) process.exit(1);
