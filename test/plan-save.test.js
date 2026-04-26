#!/usr/bin/env node
/**
 * test/plan-save.test.js
 *
 * plan-save.js 보조 문서 생성 회귀 테스트.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { saveAuxDocs } = require('../scripts/plan-save');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plan-save-test-'));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

console.log('\n[plan-save]');

test('feature spec 컨텍스트를 보조 문서에 반영한다', () => {
  const dir = makeTmpDir();
  try {
    const builtDir = path.join(dir, '.built');
    const featurePath = path.join(builtDir, 'features', 'todo-list-service.md');
    writeFile(featurePath, [
      '---',
      'feature: todo-list-service',
      'architecture_decision: "[[decisions/zustand-persist-localstorage]]"',
      '---',
      '',
      '# todo-list-service',
      '',
      '## Content & Data',
      '',
      '### Entities',
      '- [[entities/todo]] — 제목, 설명, 상태(todo/done), 우선순위(high/medium/low), 마감일, 카테고리 ID',
      '- [[entities/category]]',
      '',
      '## Architecture',
      '',
      '채택: [[decisions/zustand-persist-localstorage]] — 클라이언트 단일 사용자 앱이므로 Zustand persist와 localStorage를 사용한다.',
      '',
      '### 선택하지 않은 대안',
      '- 서버 DB 저장 — 인증과 백엔드 운영 부담이 현재 범위보다 크다.',
      '- IndexedDB 직접 구현 — 쿼리 복잡도 대비 이점이 작다.',
      '',
      '### Tradeoffs',
      '- 장점: 서버 없이 빠르게 구현하고 오프라인에서도 동작한다.',
      '- 단점: 여러 기기 동기화와 협업은 지원하지 않는다.',
      '',
      '## Build Plan',
      '',
      '### Reference Patterns',
      '- [[patterns/list-filter-store]] — 기존 필터 상태 store 구조를 재사용한다.',
      '- [[patterns/plain-link-only]]',
      '',
    ].join('\n'));

    const result = saveAuxDocs(featurePath, builtDir);
    assert.deepStrictEqual(result.skipped, []);
    assert.ok(result.created.includes('entities/todo.md'), 'todo entity 생성 필요');
    assert.ok(result.created.includes('decisions/zustand-persist-localstorage.md'), 'decision 생성 필요');
    assert.ok(result.created.includes('patterns/list-filter-store.md'), 'pattern 생성 필요');

    const todo = readFile(path.join(builtDir, 'entities', 'todo.md'));
    assert.ok(todo.includes('제목, 설명, 상태(todo/done), 우선순위(high/medium/low), 마감일, 카테고리 ID'), 'entity 필드 설명 보존 필요');
    assert.ok(todo.includes('- [[features/todo-list-service]] — 제목, 설명'), 'entity feature 사용 설명 보존 필요');

    const decision = readFile(path.join(builtDir, 'decisions', 'zustand-persist-localstorage.md'));
    assert.ok(decision.includes('클라이언트 단일 사용자 앱이므로 Zustand persist와 localStorage를 사용한다.'), '채택 설명 보존 필요');
    assert.ok(decision.includes('장점: 서버 없이 빠르게 구현하고 오프라인에서도 동작한다.'), 'tradeoff 장점 보존 필요');
    assert.ok(decision.includes('단점: 여러 기기 동기화와 협업은 지원하지 않는다.'), 'tradeoff 단점 보존 필요');
    assert.ok(decision.includes('서버 DB 저장 — 인증과 백엔드 운영 부담이 현재 범위보다 크다.'), '거부 대안 보존 필요');

    const pattern = readFile(path.join(builtDir, 'patterns', 'list-filter-store.md'));
    assert.ok(pattern.includes('기존 필터 상태 store 구조를 재사용한다.'), 'pattern 인라인 설명 보존 필요');

    const fallbackEntity = readFile(path.join(builtDir, 'entities', 'category.md'));
    assert.ok(fallbackEntity.includes('내용을 채워주세요'), '정보 없는 entity는 fallback 필요');

    const fallbackPattern = readFile(path.join(builtDir, 'patterns', 'plain-link-only.md'));
    assert.ok(fallbackPattern.includes('내용을 채워주세요'), '정보 없는 pattern은 fallback 필요');
  } finally {
    rmDir(dir);
  }
});

test('기존 보조 문서는 덮어쓰지 않는다', () => {
  const dir = makeTmpDir();
  try {
    const builtDir = path.join(dir, '.built');
    const featurePath = path.join(builtDir, 'features', 'todo-list-service.md');
    const existingPath = path.join(builtDir, 'entities', 'todo.md');

    writeFile(featurePath, [
      '# todo-list-service',
      '',
      '## Content & Data',
      '',
      '### Entities',
      '- [[entities/todo]] — 새 설명',
      '',
    ].join('\n'));
    writeFile(existingPath, '기존 문서\n');

    const result = saveAuxDocs(featurePath, builtDir);
    assert.deepStrictEqual(result.created, []);
    assert.deepStrictEqual(result.skipped, ['entities/todo.md']);
    assert.strictEqual(readFile(existingPath), '기존 문서\n');
  } finally {
    rmDir(dir);
  }
});

if (failed > 0) {
  console.error(`\n[plan-save] ${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`[plan-save] ${passed} passed, ${failed} failed`);
