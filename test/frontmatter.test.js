#!/usr/bin/env node
/**
 * test/frontmatter.test.js
 *
 * frontmatter.js 단위 테스트 (Node.js assert 모듈만 사용, 외부 패키지 없음)
 */

'use strict';

const assert = require('assert');
const { parse, stringify } = require('../src/frontmatter');

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

// ---------------------------------------------------------------------------
// parse: 기본 타입
// ---------------------------------------------------------------------------

console.log('\n[parse] 스칼라 타입');

test('문자열 값', () => {
  const { data } = parse('---\ntitle: Hello World\n---\n');
  assert.strictEqual(data.title, 'Hello World');
});

test('따옴표 문자열', () => {
  const { data } = parse('---\ntitle: "Hello: World"\n---\n');
  assert.strictEqual(data.title, 'Hello: World');
});

test('정수 숫자', () => {
  const { data } = parse('---\ncount: 42\n---\n');
  assert.strictEqual(data.count, 42);
});

test('부동소수 숫자', () => {
  const { data } = parse('---\nratio: 3.14\n---\n');
  assert.strictEqual(data.ratio, 3.14);
});

test('boolean true', () => {
  const { data } = parse('---\nactive: true\n---\n');
  assert.strictEqual(data.active, true);
});

test('boolean false', () => {
  const { data } = parse('---\nactive: false\n---\n');
  assert.strictEqual(data.active, false);
});

test('null 값', () => {
  const { data } = parse('---\nfoo: null\n---\n');
  assert.strictEqual(data.foo, null);
});

test('~ null 값', () => {
  const { data } = parse('---\nfoo: ~\n---\n');
  assert.strictEqual(data.foo, null);
});

// ---------------------------------------------------------------------------
// parse: 배열
// ---------------------------------------------------------------------------

console.log('\n[parse] 배열');

test('inline 배열 (문자열)', () => {
  const { data } = parse('---\ntags: [a, b, c]\n---\n');
  assert.deepStrictEqual(data.tags, ['a', 'b', 'c']);
});

test('inline 배열 (숫자)', () => {
  const { data } = parse('---\nnums: [1, 2, 3]\n---\n');
  assert.deepStrictEqual(data.nums, [1, 2, 3]);
});

test('inline 빈 배열', () => {
  const { data } = parse('---\ntags: []\n---\n');
  assert.deepStrictEqual(data.tags, []);
});

test('block 배열', () => {
  const input = '---\nsteps:\n  - build\n  - test\n  - deploy\n---\n';
  const { data } = parse(input);
  assert.deepStrictEqual(data.steps, ['build', 'test', 'deploy']);
});

test('block 배열 (숫자)', () => {
  const input = '---\nids:\n  - 1\n  - 2\n  - 3\n---\n';
  const { data } = parse(input);
  assert.deepStrictEqual(data.ids, [1, 2, 3]);
});

// ---------------------------------------------------------------------------
// parse: 중첩 객체 (2단계)
// ---------------------------------------------------------------------------

console.log('\n[parse] 중첩 객체');

test('2단계 객체', () => {
  const input = '---\nconstraints:\n  technical: Node.js\n  budget: tight\n---\n';
  const { data } = parse(input);
  assert.deepStrictEqual(data.constraints, { technical: 'Node.js', budget: 'tight' });
});

test('2단계 객체 - 숫자/boolean 값', () => {
  const input = '---\nmeta:\n  version: 2\n  stable: true\n---\n';
  const { data } = parse(input);
  assert.deepStrictEqual(data.meta, { version: 2, stable: true });
});

// ---------------------------------------------------------------------------
// parse: content 추출
// ---------------------------------------------------------------------------

console.log('\n[parse] content 추출');

test('본문 추출', () => {
  const input = '---\ntitle: Test\n---\n\n# Heading\n\nParagraph.';
  const { content } = parse(input);
  assert.strictEqual(content, '# Heading\n\nParagraph.');
});

test('본문 없음', () => {
  const { content } = parse('---\ntitle: Test\n---\n');
  assert.strictEqual(content, '');
});

test('frontmatter 없으면 data 빈 객체, content 전체', () => {
  const input = '# Just markdown\nNo frontmatter.';
  const { data, content } = parse(input);
  assert.deepStrictEqual(data, {});
  assert.strictEqual(content, input);
});

test('닫는 --- 없으면 data 빈 객체', () => {
  const input = '---\ntitle: Test\nno closing';
  const { data } = parse(input);
  assert.deepStrictEqual(data, {});
});

// ---------------------------------------------------------------------------
// stringify: 기본 타입
// ---------------------------------------------------------------------------

console.log('\n[stringify] 스칼라 타입');

test('문자열 직렬화', () => {
  const out = stringify({ title: 'Hello' });
  assert.ok(out.includes('title: Hello'));
});

test('특수문자 문자열 따옴표 처리', () => {
  const out = stringify({ title: 'Hello: World' });
  assert.ok(out.includes('"Hello: World"'));
});

test('숫자 직렬화', () => {
  const out = stringify({ count: 42 });
  assert.ok(out.includes('count: 42'));
});

test('boolean 직렬화', () => {
  const out = stringify({ active: true, done: false });
  assert.ok(out.includes('active: true'));
  assert.ok(out.includes('done: false'));
});

test('null 직렬화', () => {
  const out = stringify({ foo: null });
  assert.ok(out.includes('foo: null'));
});

// ---------------------------------------------------------------------------
// stringify: 배열
// ---------------------------------------------------------------------------

console.log('\n[stringify] 배열');

test('배열 inline 직렬화', () => {
  const out = stringify({ tags: ['a', 'b', 'c'] });
  assert.ok(out.includes('tags: [a, b, c]'));
});

test('빈 배열 직렬화', () => {
  const out = stringify({ tags: [] });
  assert.ok(out.includes('tags: []'));
});

// ---------------------------------------------------------------------------
// stringify: 중첩 객체
// ---------------------------------------------------------------------------

console.log('\n[stringify] 중첩 객체');

test('2단계 객체 직렬화', () => {
  const out = stringify({ constraints: { technical: 'Node.js', budget: 'tight' } });
  assert.ok(out.includes('constraints:'));
  assert.ok(out.includes('  technical: Node.js'));
  assert.ok(out.includes('  budget: tight'));
});

// ---------------------------------------------------------------------------
// stringify: content 포함
// ---------------------------------------------------------------------------

console.log('\n[stringify] content 포함');

test('content 포함 직렬화', () => {
  const out = stringify({ title: 'Test' }, '# Heading\n\nBody.');
  assert.ok(out.startsWith('---\n'));
  assert.ok(out.includes('---\n# Heading'));
});

test('content 없으면 개행으로 끝남', () => {
  const out = stringify({ title: 'Test' });
  assert.ok(out.endsWith('---\n'));
});

// ---------------------------------------------------------------------------
// 왕복 변환 (parse → stringify → parse)
// ---------------------------------------------------------------------------

console.log('\n[round-trip] parse → stringify → parse');

test('스칼라 왕복', () => {
  const data = { title: 'Hello', count: 5, active: true, note: null };
  const text = stringify(data, 'body');
  const { data: d2, content } = parse(text);
  assert.deepStrictEqual(d2, data);
  assert.strictEqual(content, 'body');
});

test('inline 배열 왕복', () => {
  const data = { tags: ['x', 'y', 'z'] };
  const text = stringify(data, '');
  const { data: d2 } = parse(text);
  assert.deepStrictEqual(d2, data);
});

test('중첩 객체 왕복', () => {
  const data = { meta: { version: 1, stable: false } };
  const text = stringify(data, '');
  const { data: d2 } = parse(text);
  assert.deepStrictEqual(d2, data);
});

test('복합 데이터 왕복', () => {
  const data = {
    title: 'Feature: auth',
    status: 'approved',
    priority: 3,
    done: false,
    tags: ['auth', 'security'],
    constraints: { technical: 'Node.js', budget: 'low' },
  };
  const body = '## 목표\n\n사용자 인증 구현.';
  const text = stringify(data, body);
  const { data: d2, content } = parse(text);
  assert.deepStrictEqual(d2, data);
  assert.strictEqual(content, body);
});

// ---------------------------------------------------------------------------
// 결과
// ---------------------------------------------------------------------------

console.log(`\n결과: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
