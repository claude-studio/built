'use strict';

const fs   = require('fs');
const path = require('path');

function nowIso() {
  return new Date().toISOString();
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeJsonSafe(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function resolveRuntimeDir(projectRoot) {
  return path.join(projectRoot || process.cwd(), '.built', 'runtime');
}

function resolveRunDir(projectRoot, feature) {
  return path.join(resolveRuntimeDir(projectRoot), 'runs', feature);
}

function resolveFeatureDir(projectRoot, feature) {
  return path.join(projectRoot || process.cwd(), '.built', 'features', feature);
}

function normalizeActiveProvider(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.provider !== 'codex') return null;
  const threadId = value.threadId || value.thread_id || null;
  const turnId = value.turnId || value.turn_id || null;
  if (!threadId || !turnId) return null;
  return {
    provider: 'codex',
    threadId,
    turnId,
    phase: value.phase || null,
    status: value.status || 'running',
    cwd: value.cwd || value.workDir || null,
    updatedAt: value.updatedAt || value.updated_at || nowIso(),
    interrupt: value.interrupt || null,
  };
}

function updateActiveCodexTurn(runDir, metadata) {
  if (!runDir || !metadata) return null;
  const stateFile = path.join(runDir, 'state.json');
  const state = readJsonSafe(stateFile);
  if (!state) return null;

  const active = normalizeActiveProvider({
    provider: 'codex',
    status: 'running',
    ...metadata,
    updatedAt: nowIso(),
  });
  if (!active) return null;

  const next = {
    ...state,
    active_provider: active,
    updatedAt: nowIso(),
  };
  writeJsonSafe(stateFile, next);
  return active;
}

function markActiveCodexTurnFinished(runDir, status = 'completed') {
  if (!runDir) return null;
  const stateFile = path.join(runDir, 'state.json');
  const state = readJsonSafe(stateFile);
  if (!state || !state.active_provider || state.active_provider.provider !== 'codex') return null;

  const next = {
    ...state,
    active_provider: {
      ...state.active_provider,
      status,
      updatedAt: nowIso(),
    },
    updatedAt: nowIso(),
  };
  writeJsonSafe(stateFile, next);
  return next.active_provider;
}

function recordCodexInterruptResult(runDir, result) {
  if (!runDir) return null;
  const stateFile = path.join(runDir, 'state.json');
  const state = readJsonSafe(stateFile);
  if (!state) return null;

  const active = state.active_provider && state.active_provider.provider === 'codex'
    ? state.active_provider
    : { provider: 'codex' };
  const interrupt = {
    attempted: Boolean(result && result.attempted),
    interrupted: Boolean(result && result.interrupted),
    detail: result && result.detail ? result.detail : null,
    updatedAt: nowIso(),
  };

  const next = {
    ...state,
    active_provider: {
      ...active,
      status: interrupt.interrupted ? 'interrupted' : 'interrupt_failed',
      interrupt,
      updatedAt: nowIso(),
    },
    codex_interrupt: interrupt,
    updatedAt: nowIso(),
  };
  writeJsonSafe(stateFile, next);
  return interrupt;
}

function loadActiveCodexTurn(projectRoot, feature) {
  const state = readJsonSafe(path.join(resolveRunDir(projectRoot, feature), 'state.json'));
  const fromState = normalizeActiveProvider(state && state.active_provider);
  if (fromState) return fromState;

  const progress = readJsonSafe(path.join(resolveFeatureDir(projectRoot, feature), 'progress.json'));
  return normalizeActiveProvider(progress && progress.active_provider);
}

module.exports = {
  loadActiveCodexTurn,
  markActiveCodexTurnFinished,
  recordCodexInterruptResult,
  resolveRunDir,
  updateActiveCodexTurn,
  _normalizeActiveProvider: normalizeActiveProvider,
};
