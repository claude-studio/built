#!/usr/bin/env node
/**
 * test/registry.test.js
 *
 * registry.js 단위 테스트 (Node.js assert + fs만 사용, 외부 패키지 없음)
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

const {
  register,
  update,
  getFeature,
  getAll,
  unregister,
  acquire,
  release,
  isLocked,
} = require('../src/registry');

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

/** 테스트용 임시 디렉토리 생성 */
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'registry-test-'));
}

/** 디렉토리 재귀 삭제 */
function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// registry: register / getFeature / getAll
// ---------------------------------------------------------------------------

console.log('\n[register / getFeature / getAll]');

test('register: 새 feature 등록', () => {
  const dir = makeTmpDir();
  try {
    const entry = register(dir, 'user-auth', { status: 'running', pid: 1234 });
    assert.strictEqual(entry.featureId,    'user-auth');
    assert.strictEqual(entry.status,       'running');
    assert.strictEqual(entry.pid,          1234);
    assert.ok(entry.startedAt);
  } finally { rmDir(dir); }
});

test('register: registry.json 파일이 생성된다', () => {
  const dir = makeTmpDir();
  try {
    register(dir, 'payments', { status: 'running' });
    assert.ok(fs.existsSync(path.join(dir, 'registry.json')));
  } finally { rmDir(dir); }
});

test('register: 여러 feature 등록 시 모두 저장된다', () => {
  const dir = makeTmpDir();
  try {
    register(dir, 'feat-a', { status: 'running' });
    register(dir, 'feat-b', { status: 'running' });
    const all = getAll(dir);
    assert.ok('feat-a' in all);
    assert.ok('feat-b' in all);
  } finally { rmDir(dir); }
});

test('register: 동일 feature 재등록 시 startedAt은 유지된다', () => {
  const dir = makeTmpDir();
  try {
    const first = register(dir, 'feat-x', { status: 'running' });
    // 짧은 시간 경과 후 재등록
    const second = register(dir, 'feat-x', { status: 'completed' });
    assert.strictEqual(second.startedAt, first.startedAt);
    assert.strictEqual(second.status, 'completed');
  } finally { rmDir(dir); }
});

test('getFeature: 등록된 feature를 조회할 수 있다', () => {
  const dir = makeTmpDir();
  try {
    register(dir, 'my-feat', { status: 'running', pid: 999 });
    const entry = getFeature(dir, 'my-feat');
    assert.ok(entry !== null);
    assert.strictEqual(entry.featureId, 'my-feat');
    assert.strictEqual(entry.pid,       999);
  } finally { rmDir(dir); }
});

test('getFeature: 존재하지 않는 feature는 null 반환', () => {
  const dir = makeTmpDir();
  try {
    const entry = getFeature(dir, 'nonexistent');
    assert.strictEqual(entry, null);
  } finally { rmDir(dir); }
});

test('getAll: registry가 없으면 빈 객체 반환', () => {
  const dir = makeTmpDir();
  try {
    const all = getAll(dir);
    assert.deepStrictEqual(all, {});
  } finally { rmDir(dir); }
});

// ---------------------------------------------------------------------------
// registry: update
// ---------------------------------------------------------------------------

console.log('\n[update]');

test('update: 등록된 feature의 필드를 갱신한다', () => {
  const dir = makeTmpDir();
  try {
    register(dir, 'feat-u', { status: 'running', pid: 111 });
    const updated = update(dir, 'feat-u', { status: 'completed', pid: null });
    assert.strictEqual(updated.status, 'completed');
    assert.strictEqual(updated.pid,    null);
    assert.strictEqual(updated.featureId, 'feat-u');
  } finally { rmDir(dir); }
});

test('update: 갱신 후 updatedAt이 설정된다', () => {
  const dir = makeTmpDir();
  try {
    register(dir, 'feat-u2', { status: 'running' });
    const entry = update(dir, 'feat-u2', { status: 'failed' });
    assert.ok(entry.updatedAt);
  } finally { rmDir(dir); }
});

test('update: 등록되지 않은 feature 갱신 시 에러', () => {
  const dir = makeTmpDir();
  try {
    assert.throws(
      () => update(dir, 'ghost-feat', { status: 'completed' }),
      /not registered/
    );
  } finally { rmDir(dir); }
});

// ---------------------------------------------------------------------------
// registry: unregister
// ---------------------------------------------------------------------------

console.log('\n[unregister]');

test('unregister: feature를 registry에서 제거한다', () => {
  const dir = makeTmpDir();
  try {
    register(dir, 'to-remove', { status: 'running' });
    unregister(dir, 'to-remove');
    assert.strictEqual(getFeature(dir, 'to-remove'), null);
  } finally { rmDir(dir); }
});

test('unregister: 다른 feature는 영향받지 않는다', () => {
  const dir = makeTmpDir();
  try {
    register(dir, 'keep-me',   { status: 'running' });
    register(dir, 'remove-me', { status: 'running' });
    unregister(dir, 'remove-me');
    assert.ok(getFeature(dir, 'keep-me') !== null);
    assert.strictEqual(getFeature(dir, 'remove-me'), null);
  } finally { rmDir(dir); }
});

test('unregister: 존재하지 않는 feature 제거는 에러 없이 처리된다', () => {
  const dir = makeTmpDir();
  try {
    // 에러 없이 완료되어야 함
    unregister(dir, 'ghost');
  } finally { rmDir(dir); }
});

// ---------------------------------------------------------------------------
// lock: acquire / release / isLocked
// ---------------------------------------------------------------------------

console.log('\n[acquire / release / isLocked]');

test('isLocked: lock 없으면 false 반환', () => {
  const dir = makeTmpDir();
  try {
    assert.strictEqual(isLocked(dir, 'feat-a'), false);
  } finally { rmDir(dir); }
});

test('acquire: lock 파일을 생성한다', () => {
  const dir = makeTmpDir();
  try {
    acquire(dir, 'feat-a');
    assert.ok(fs.existsSync(path.join(dir, 'locks', 'feat-a.lock')));
  } finally { rmDir(dir); }
});

test('isLocked: acquire 후 true 반환', () => {
  const dir = makeTmpDir();
  try {
    acquire(dir, 'feat-b');
    assert.strictEqual(isLocked(dir, 'feat-b'), true);
  } finally { rmDir(dir); }
});

test('acquire: 이미 lock 존재 시 에러를 throw한다', () => {
  const dir = makeTmpDir();
  try {
    acquire(dir, 'feat-dup');
    assert.throws(
      () => acquire(dir, 'feat-dup'),
      /already locked/
    );
  } finally { rmDir(dir); }
});

test('release: lock 파일을 삭제한다', () => {
  const dir = makeTmpDir();
  try {
    acquire(dir, 'feat-c');
    assert.strictEqual(isLocked(dir, 'feat-c'), true);
    release(dir, 'feat-c');
    assert.strictEqual(isLocked(dir, 'feat-c'), false);
  } finally { rmDir(dir); }
});

test('release: lock 없어도 에러 없이 처리된다', () => {
  const dir = makeTmpDir();
  try {
    // 에러 없이 완료되어야 함
    release(dir, 'no-lock-feat');
  } finally { rmDir(dir); }
});

test('acquire 후 release 후 재acquire 가능하다', () => {
  const dir = makeTmpDir();
  try {
    acquire(dir, 'feat-reacq');
    release(dir, 'feat-reacq');
    // 에러 없이 재획득 가능해야 함
    acquire(dir, 'feat-reacq');
    assert.strictEqual(isLocked(dir, 'feat-reacq'), true);
  } finally { rmDir(dir); }
});

test('서로 다른 feature는 독립적으로 lock된다', () => {
  const dir = makeTmpDir();
  try {
    acquire(dir, 'feat-1');
    acquire(dir, 'feat-2');
    assert.strictEqual(isLocked(dir, 'feat-1'), true);
    assert.strictEqual(isLocked(dir, 'feat-2'), true);
    release(dir, 'feat-1');
    assert.strictEqual(isLocked(dir, 'feat-1'), false);
    assert.strictEqual(isLocked(dir, 'feat-2'), true);
  } finally { rmDir(dir); }
});

test('acquire: lock 파일에 pid와 lockedAt이 기록된다', () => {
  const dir = makeTmpDir();
  try {
    acquire(dir, 'feat-meta');
    const lockFile = path.join(dir, 'locks', 'feat-meta.lock');
    const content  = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    assert.strictEqual(typeof content.pid,      'number');
    assert.strictEqual(typeof content.lockedAt, 'string');
    assert.ok(new Date(content.lockedAt).getTime() > 0);
  } finally { rmDir(dir); }
});

// ---------------------------------------------------------------------------
// 인자 유효성 검사
// ---------------------------------------------------------------------------

console.log('\n[인자 유효성]');

test('register: featureId 없으면 TypeError', () => {
  const dir = makeTmpDir();
  try {
    assert.throws(() => register(dir, '', {}), /featureId/);
    assert.throws(() => register(dir, null, {}), /featureId/);
  } finally { rmDir(dir); }
});

test('acquire: featureId 없으면 TypeError', () => {
  const dir = makeTmpDir();
  try {
    assert.throws(() => acquire(dir, ''), /featureId/);
  } finally { rmDir(dir); }
});

test('release: featureId 없으면 TypeError', () => {
  const dir = makeTmpDir();
  try {
    assert.throws(() => release(dir, ''), /featureId/);
  } finally { rmDir(dir); }
});

test('isLocked: featureId 없으면 TypeError', () => {
  const dir = makeTmpDir();
  try {
    assert.throws(() => isLocked(dir, ''), /featureId/);
  } finally { rmDir(dir); }
});

// ---------------------------------------------------------------------------
// 결과 요약
// ---------------------------------------------------------------------------

console.log(`\n총 ${passed + failed}개 테스트: ${passed}개 통과, ${failed}개 실패\n`);
process.exit(failed > 0 ? 1 : 0);
