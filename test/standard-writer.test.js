#!/usr/bin/env node
/**
 * test/standard-writer.test.js
 *
 * 표준 provider writer 단위 테스트.
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const { createStandardWriter } = require('../src/providers/standard-writer');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message}`);
    failed++;
  }
}

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'standard-writer-test-'));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

console.log('\n[standard-writer 단위 테스트]\n');

test('표준 provider 이벤트: 원본 JSONL 보존 및 progress tail 요약', () => {
  const dir = makeTmpDir();
  try {
    const writer = createStandardWriter({ runtimeRoot: dir, featureId: 'feat', phase: 'do' });
    const output = 'O'.repeat(6000);
    writer.handleEvent({ type: 'phase_start', provider: 'codex', model: 'gpt-test' });
    writer.handleEvent({ type: 'tool_result', content: output });

    const progress = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(progress.log_summary.total_events, 2);
    assert.strictEqual(progress.log_summary.tool_result_chars, 6000);
    assert.strictEqual(progress.log_summary.tool_result_truncated, 1);
    assert.strictEqual(progress.recent_events.length, 2);
    assert.strictEqual(progress.recent_events[1].summary.length, 500);

    const lines = fs.readFileSync(path.join(dir, 'logs', 'do.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.strictEqual(lines.length, 2);
    assert.strictEqual(lines[1].content.length, 6000);
  } finally {
    rmDir(dir);
  }
});

test('표준 provider error 이벤트: 대용량 last_error는 progress에서 축약하고 원본 JSONL은 보존', () => {
  const dir = makeTmpDir();
  try {
    const writer = createStandardWriter({ runtimeRoot: dir, featureId: 'feat', phase: 'do' });
    const message = 'E'.repeat(5000);
    writer.handleEvent({ type: 'error', message });

    const progress = readJson(path.join(dir, 'progress.json'));
    assert.strictEqual(progress.status, 'failed');
    assert.strictEqual(progress.last_error.length, 200);
    assert.strictEqual(progress.recent_events[0].summary.length, 200);

    const line = fs.readFileSync(path.join(dir, 'logs', 'do.jsonl'), 'utf8').trim();
    assert.strictEqual(JSON.parse(line).message.length, 5000);
  } finally {
    rmDir(dir);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
