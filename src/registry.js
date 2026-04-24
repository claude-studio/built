#!/usr/bin/env node
/**
 * registry.js
 *
 * Multi-feature 동시성을 위한 registry.json 관리 + lock 파일 시스템.
 * 외부 npm 패키지 없음 (Node.js fs/path/os만).
 *
 * registry.json 위치: .built/runtime/registry.json
 * lock 파일 위치:     .built/runtime/locks/<feature>.lock
 *
 * registry.json 스키마:
 *   {
 *     "version": 1,
 *     "features": {
 *       "<featureId>": {
 *         "featureId":    string,
 *         "status":       "running" | "completed" | "failed",
 *         "startedAt":    ISO8601,
 *         "worktreePath": string | null,
 *         "pid":          number | null
 *       }
 *     }
 *   }
 *
 * API (registry):
 *   register(runtimeDir, featureId, data)   -> entry 객체
 *   update(runtimeDir, featureId, updates)  -> 갱신된 entry 객체
 *   getFeature(runtimeDir, featureId)       -> entry 객체 | null
 *   getAll(runtimeDir)                      -> { [featureId]: entry }
 *   unregister(runtimeDir, featureId)       -> void
 *
 * API (locks):
 *   acquire(runtimeDir, featureId)          -> void  (이미 잠긴 경우 Error)
 *   release(runtimeDir, featureId)          -> void
 *   isLocked(runtimeDir, featureId)         -> boolean
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ---------------------------------------------------------------------------
// 내부 유틸
// ---------------------------------------------------------------------------

/**
 * JSON 객체를 tmp 파일에 쓴 후 rename으로 교체 — 파일 손상 방지.
 *
 * @param {string} filePath  대상 파일 절대경로
 * @param {object} data      직렬화할 객체
 */
function atomicWrite(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmp = path.join(os.tmpdir(), `registry-${process.pid}-${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');

  try {
    fs.renameSync(tmp, filePath);
  } catch (_) {
    // 크로스-디바이스 fallback
    fs.copyFileSync(tmp, filePath);
    try { fs.unlinkSync(tmp); } catch (__) {}
  }
}

/**
 * registry.json 경로 반환.
 * @param {string} runtimeDir
 * @returns {string}
 */
function registryPath(runtimeDir) {
  return path.join(runtimeDir, 'registry.json');
}

/**
 * lock 파일 경로 반환.
 * @param {string} runtimeDir
 * @param {string} featureId
 * @returns {string}
 */
function lockPath(runtimeDir, featureId) {
  return path.join(runtimeDir, 'locks', `${featureId}.lock`);
}

/**
 * registry.json 읽기. 없으면 빈 구조 반환.
 * @param {string} runtimeDir
 * @returns {{ version: number, features: object }}
 */
function readRegistry(runtimeDir) {
  const filePath = registryPath(runtimeDir);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { version: 1, features: {} };
    if (!parsed.features || typeof parsed.features !== 'object') parsed.features = {};
    return parsed;
  } catch (_) {
    return { version: 1, features: {} };
  }
}

// ---------------------------------------------------------------------------
// registry API
// ---------------------------------------------------------------------------

/**
 * feature를 registry에 등록. 이미 존재하면 덮어씀.
 *
 * @param {string} runtimeDir
 * @param {string} featureId
 * @param {{ status?: string, worktreePath?: string|null, pid?: number|null }} data
 * @returns {{ featureId: string, status: string, startedAt: string, worktreePath: string|null, pid: number|null }}
 */
function register(runtimeDir, featureId, data) {
  if (!featureId) throw new TypeError('register: featureId is required');

  const registry = readRegistry(runtimeDir);
  const now = new Date().toISOString();

  const existing = registry.features[featureId] || {};
  const entry = {
    featureId,
    status:       data.status       !== undefined ? data.status       : (existing.status       || 'running'),
    startedAt:    existing.startedAt || now,
    worktreePath: data.worktreePath !== undefined ? data.worktreePath : (existing.worktreePath || null),
    pid:          data.pid          !== undefined ? data.pid          : (existing.pid          || null),
    updatedAt:    now,
  };

  registry.features[featureId] = entry;
  atomicWrite(registryPath(runtimeDir), registry);
  return entry;
}

/**
 * 기존 feature 엔트리를 부분 갱신.
 *
 * @param {string} runtimeDir
 * @param {string} featureId
 * @param {object} updates  갱신할 필드
 * @returns {{ featureId: string, status: string, startedAt: string, worktreePath: string|null, pid: number|null }}
 * @throws {Error} feature가 등록되지 않은 경우
 */
function update(runtimeDir, featureId, updates) {
  if (!featureId) throw new TypeError('update: featureId is required');

  const registry = readRegistry(runtimeDir);
  const existing = registry.features[featureId];

  if (!existing) {
    throw new Error(`update: feature not registered: ${featureId}`);
  }

  const next = Object.assign({}, existing, updates, {
    featureId,
    updatedAt: new Date().toISOString(),
  });

  registry.features[featureId] = next;
  atomicWrite(registryPath(runtimeDir), registry);
  return next;
}

/**
 * feature 엔트리 조회.
 *
 * @param {string} runtimeDir
 * @param {string} featureId
 * @returns {object|null}
 */
function getFeature(runtimeDir, featureId) {
  if (!featureId) throw new TypeError('getFeature: featureId is required');
  const registry = readRegistry(runtimeDir);
  return registry.features[featureId] || null;
}

/**
 * 전체 feature 엔트리 조회.
 *
 * @param {string} runtimeDir
 * @returns {{ [featureId: string]: object }}
 */
function getAll(runtimeDir) {
  return readRegistry(runtimeDir).features;
}

/**
 * feature를 registry에서 제거.
 *
 * @param {string} runtimeDir
 * @param {string} featureId
 * @returns {void}
 */
function unregister(runtimeDir, featureId) {
  if (!featureId) throw new TypeError('unregister: featureId is required');

  const registry = readRegistry(runtimeDir);
  delete registry.features[featureId];
  atomicWrite(registryPath(runtimeDir), registry);
}

// ---------------------------------------------------------------------------
// lock API
// ---------------------------------------------------------------------------

/**
 * feature에 대한 lock을 획득한다.
 * O_EXCL 플래그(wx)를 사용하여 atomic하게 lock 파일을 생성.
 * 이미 lock이 존재하면 Error를 throw한다.
 *
 * @param {string} runtimeDir
 * @param {string} featureId
 * @throws {Error} 이미 lock이 존재하는 경우
 */
function acquire(runtimeDir, featureId) {
  if (!featureId) throw new TypeError('acquire: featureId is required');

  const lPath = lockPath(runtimeDir, featureId);
  fs.mkdirSync(path.dirname(lPath), { recursive: true });

  let fd;
  try {
    // O_EXCL: 파일이 이미 존재하면 EEXIST 에러 (atomic)
    fd = fs.openSync(lPath, 'wx');
  } catch (err) {
    if (err.code === 'EEXIST') {
      // lock 파일에서 pid 읽어 정보 제공
      let info = '';
      try {
        info = fs.readFileSync(lPath, 'utf8').trim();
      } catch (_) {}
      throw new Error(
        `acquire: feature already locked: ${featureId}` +
        (info ? ` (${info})` : '')
      );
    }
    throw err;
  }

  // lock 파일에 pid와 시각 기록
  const content = JSON.stringify({ pid: process.pid, lockedAt: new Date().toISOString() }) + '\n';
  try {
    fs.writeSync(fd, content, 0, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * feature의 lock을 해제한다 (lock 파일 삭제).
 * lock 파일이 없어도 에러 없이 통과한다.
 *
 * @param {string} runtimeDir
 * @param {string} featureId
 */
function release(runtimeDir, featureId) {
  if (!featureId) throw new TypeError('release: featureId is required');

  const lPath = lockPath(runtimeDir, featureId);
  try {
    fs.unlinkSync(lPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // ENOENT: 이미 삭제됨 — 무시
  }
}

/**
 * feature의 lock 존재 여부 확인.
 *
 * @param {string} runtimeDir
 * @param {string} featureId
 * @returns {boolean}
 */
function isLocked(runtimeDir, featureId) {
  if (!featureId) throw new TypeError('isLocked: featureId is required');
  return fs.existsSync(lockPath(runtimeDir, featureId));
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = {
  // registry
  register,
  update,
  getFeature,
  getAll,
  unregister,
  // locks
  acquire,
  release,
  isLocked,
};
