#!/usr/bin/env node
/**
 * poc-2-progress-writer.js
 *
 * claude -p --output-format stream-json --verbose 의 stdout을 stdin으로 받아
 * 다음 세 파일을 갱신한다:
 *   - logs/<phase>.jsonl  : 이벤트 원본 append
 *   - progress.json       : 실시간 진행 snapshot (atomic write)
 *   - state.json          : phase / status / heartbeat / pid (atomic write)
 *
 * 사용법:
 *   claude -p --output-format stream-json --verbose <prompt> \
 *     | node scripts/poc-2-progress-writer.js \
 *         --runtime-root .built/runtime/runs/<feature> \
 *         --phase do \
 *         --feature <feature-name>
 *
 * 옵션:
 *   --runtime-root <path>  런타임 루트 경로 (기본: .built/runtime/runs/poc-test)
 *   --phase <name>         현재 phase (기본: do)
 *   --feature <name>       feature 이름 (기본: poc-test)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// --- CLI 인자 파싱 ---
const args = process.argv.slice(2);
function getArg(flag, fallback) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const RUNTIME_ROOT = path.resolve(getArg('--runtime-root', '.built/runtime/runs/poc-test'));
const PHASE        = getArg('--phase', 'do');
const FEATURE      = getArg('--feature', 'poc-test');
const PID          = process.pid;

// --- 경로 ---
const LOGS_DIR      = path.join(RUNTIME_ROOT, 'logs');
const LOG_FILE      = path.join(LOGS_DIR, `${PHASE}.jsonl`);
const PROGRESS_FILE = path.join(RUNTIME_ROOT, 'progress.json');
const STATE_FILE    = path.join(RUNTIME_ROOT, 'state.json');
const TMP_SUFFIX    = '.tmp';

// --- 디렉토리 초기화 ---
fs.mkdirSync(LOGS_DIR, { recursive: true });

// --- Atomic write 헬퍼 ---
function atomicWrite(filePath, obj) {
  const tmp = filePath + TMP_SUFFIX;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filePath);
}

// --- 초기 state.json ---
function initState() {
  const existing = readJSON(STATE_FILE);
  if (existing && existing.status === 'running') return; // 이미 실행 중이면 유지
  atomicWrite(STATE_FILE, {
    feature:    FEATURE,
    phase:      PHASE,
    status:     'running',
    worker:     { pid: PID, session_id: null, worktree_path: process.cwd() },
    heartbeat_at: new Date().toISOString(),
    attempt:    1,
    last_error: null,
  });
}

function readJSON(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

// --- 진행 상태 추적 ---
let sessionId    = null;
let turnCount    = 0;
let toolUseCount = 0;
let lastText     = '';
let totalCostUsd = 0;
let inputTokens  = 0;
let outputTokens = 0;
let startedAt    = new Date().toISOString();

function updateHeartbeat(extra = {}) {
  const now = new Date().toISOString();
  const state = readJSON(STATE_FILE) || {};
  atomicWrite(STATE_FILE, {
    ...state,
    heartbeat_at: now,
    ...extra,
  });
}

function updateProgress(extra = {}) {
  atomicWrite(PROGRESS_FILE, {
    feature:      FEATURE,
    phase:        PHASE,
    session_id:   sessionId,
    turn:         turnCount,
    tool_calls:   toolUseCount,
    last_text:    lastText.slice(0, 200),
    cost_usd:     totalCostUsd,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    started_at:   startedAt,
    updated_at:   new Date().toISOString(),
    ...extra,
  });
}

// --- 이벤트 핸들러 ---
function handleEvent(event) {
  const { type, subtype } = event;

  // 1. logs/<phase>.jsonl 에 원본 append
  fs.appendFileSync(LOG_FILE, JSON.stringify(event) + '\n', 'utf8');

  // 2. 이벤트별 상태 추적
  if (type === 'system' && subtype === 'init') {
    sessionId = event.session_id || null;
    updateHeartbeat({ 'worker.session_id': sessionId });
    updateProgress();
    return;
  }

  if (type === 'assistant') {
    turnCount++;
    const content = event.message?.content || [];
    for (const block of content) {
      if (block.type === 'text') lastText = block.text || '';
      if (block.type === 'tool_use') toolUseCount++;
    }
    const usage = event.message?.usage || {};
    if (usage.input_tokens)  inputTokens  += usage.input_tokens;
    if (usage.output_tokens) outputTokens += usage.output_tokens;
    updateProgress();
    updateHeartbeat();
    return;
  }

  if (type === 'tool_result') {
    updateHeartbeat();
    return;
  }

  if (type === 'result') {
    totalCostUsd = event.total_cost_usd || 0;
    const usage  = event.usage || {};
    inputTokens  = usage.input_tokens  || inputTokens;
    outputTokens = usage.output_tokens || outputTokens;

    const isError = event.is_error || event.subtype === 'error';
    const finalStatus = isError ? 'failed' : 'completed';

    updateProgress({
      result:     event.result || '',
      stop_reason: event.stop_reason,
      cost_usd:   totalCostUsd,
    });
    atomicWrite(STATE_FILE, {
      feature:    FEATURE,
      phase:      PHASE,
      status:     finalStatus,
      worker:     { pid: PID, session_id: sessionId, worktree_path: process.cwd() },
      heartbeat_at: new Date().toISOString(),
      attempt:    1,
      last_error: isError ? (event.result || 'unknown error') : null,
    });
    return;
  }
}

// --- stdin readline 루프 ---
initState();
updateProgress();

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const event = JSON.parse(trimmed);
    handleEvent(event);
  } catch {
    // JSON 파싱 실패 줄은 raw-error.log 에 기록
    fs.appendFileSync(path.join(LOGS_DIR, 'raw-error.log'), line + '\n', 'utf8');
  }
});

rl.on('close', () => {
  // stdin이 닫혔는데 아직 running 이면 crashed로 처리
  const state = readJSON(STATE_FILE);
  if (state && state.status === 'running') {
    atomicWrite(STATE_FILE, {
      ...state,
      status:     'crashed',
      last_error: 'stdin closed unexpectedly',
      heartbeat_at: new Date().toISOString(),
    });
    updateProgress({ status: 'crashed' });
  }
});
