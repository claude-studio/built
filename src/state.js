#!/usr/bin/env node
/**
 * state.js
 *
 * run-request.json (Plan→Run handoff) 및 state.json (phase/status/heartbeat/pid) 초기화 및 갱신.
 * 외부 npm 패키지 없음 (Node.js fs/path만).
 * atomic write (tmp파일 → rename) 방식으로 파일 손상 방지.
 *
 * API:
 *   atomicWrite(filePath, data)
 *   readJson(filePath)
 *
 *   initRunRequest(runDir, { featureId, planPath, model, preset?, providers?, defaultRunProfile? })
 *     -> run-request.json 생성
 *   readRunRequest(runDir)                                  -> run-request 객체
 *
 *   initState(runDir, featureId)                            -> state.json 초기 생성
 *   updateState(runDir, updates)                            -> state.json 부분 갱신
 *   readState(runDir)                                       -> state 객체
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildRunRequest } = require('./providers/presets');

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

  const tmp = path.join(os.tmpdir(), `state-${process.pid}-${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');

  // rename은 같은 파일시스템 내에서 atomic
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    // 크로스-디바이스 fallback: copy 후 삭제
    fs.copyFileSync(tmp, filePath);
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

/**
 * JSON 파일을 읽어 파싱.
 *
 * @param {string} filePath
 * @returns {object}
 * @throws {Error} 파일이 없거나 파싱 실패 시
 */
function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// run-request.json
// ---------------------------------------------------------------------------

const RUN_REQUEST_FILE = 'run-request.json';

function inferProjectRootFromRunDir(runDir) {
  const parts = path.resolve(runDir).split(path.sep);
  const builtIdx = parts.lastIndexOf('.built');
  if (builtIdx <= 0) return null;
  return parts.slice(0, builtIdx).join(path.sep) || path.sep;
}

function readDefaultRunProfile(runDir, explicitProfile) {
  if (explicitProfile) return explicitProfile;

  const projectRoot = inferProjectRootFromRunDir(runDir);
  if (!projectRoot) return null;

  const configPath = path.join(projectRoot, '.built', 'config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config.default_run_profile || null;
  } catch (_) {
    return null;
  }
}

/**
 * run-request.json 생성. Plan → Run handoff 스냅샷.
 *
 * @param {string} runDir  .built/runtime/runs/<feature>/ 절대경로
 * @param {{
 *   featureId: string,
 *   planPath: string,
 *   model: string,
 *   preset?: string,
 *   providers?: object,
 *   defaultRunProfile?: object
 * }} opts
 * @returns {object}  생성된 run-request 객체
 */
function initRunRequest(runDir, { featureId, planPath, model, preset, providers, defaultRunProfile }) {
  if (!featureId) throw new TypeError('initRunRequest: featureId is required');
  if (!planPath)  throw new TypeError('initRunRequest: planPath is required');
  if (!model)     throw new TypeError('initRunRequest: model is required');

  const providerSource = preset || providers
    ? null
    : readDefaultRunProfile(runDir, defaultRunProfile);
  const data = buildRunRequest({
    featureId,
    planPath,
    model,
    preset,
    providers,
    defaultRunProfile: providerSource || undefined,
  });

  atomicWrite(path.join(runDir, RUN_REQUEST_FILE), data);
  return data;
}

/**
 * run-request.json 읽기.
 *
 * @param {string} runDir
 * @returns {{ featureId: string, planPath: string, model: string, createdAt: string }}
 */
function readRunRequest(runDir) {
  return readJson(path.join(runDir, RUN_REQUEST_FILE));
}

// ---------------------------------------------------------------------------
// state.json
// ---------------------------------------------------------------------------

const STATE_FILE = 'state.json';

/**
 * state.json 초기 생성. status: "planned".
 *
 * @param {string} runDir
 * @param {string} featureId
 * @returns {object}  생성된 state 객체
 */
function initState(runDir, featureId) {
  if (!featureId) throw new TypeError('initState: featureId is required');

  const now = new Date().toISOString();
  const data = {
    feature:     featureId,
    phase:       'planned',
    status:      'planned',
    pid:         null,
    heartbeat:   null,
    startedAt:   now,
    updatedAt:   now,
    attempt:     0,
    last_error:  null,
  };

  atomicWrite(path.join(runDir, STATE_FILE), data);
  return data;
}

/**
 * state.json 부분 갱신. updatedAt은 자동 설정.
 *
 * @param {string} runDir
 * @param {object} updates  갱신할 필드 (phase, status, pid, heartbeat, attempt, last_error 등)
 * @returns {object}  갱신된 state 객체
 */
function updateState(runDir, updates) {
  const filePath = path.join(runDir, STATE_FILE);
  const current = readJson(filePath);
  const next = Object.assign({}, current, updates, {
    updatedAt: new Date().toISOString(),
  });

  atomicWrite(filePath, next);
  return next;
}

/**
 * state.json 읽기.
 *
 * @param {string} runDir
 * @returns {object}
 */
function readState(runDir) {
  return readJson(path.join(runDir, STATE_FILE));
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = {
  atomicWrite,
  readJson,
  initRunRequest,
  readRunRequest,
  initState,
  updateState,
  readState,
};
