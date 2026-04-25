#!/usr/bin/env node
/**
 * src/providers/claude.js
 *
 * Claude CLI provider — `claude -p` 프로세스를 실행하고 이벤트를 onEvent 콜백으로 전달한다.
 * Provider는 파일을 직접 쓰지 않는다. 파일 기록은 runner(pipeline-runner.js)가 담당한다.
 *
 * API:
 *   runClaude({ prompt, model, onEvent, jsonSchema })
 *     → Promise<{ success: boolean, exitCode: number, error?: string, structuredOutput?: object }>
 *
 * 계약:
 *   - onEvent(event)는 모든 stream-json 이벤트 줄이 파싱될 때마다 호출된다.
 *   - jsonSchema 제공 시 --output-format json --json-schema 모드 실행. onEvent 미사용.
 *   - MULTICA_AGENT_TIMEOUT 환경변수 지원 (기본 30분).
 *
 * docs/contracts/provider-events.md, docs/contracts/provider-config.md 참고.
 */

'use strict';

const childProcess = require('child_process');

const {
  classifyClaudeFailure,
  failureToEventFields,
} = require('./failure');

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30분

// ---------------------------------------------------------------------------
// 내부 유틸
// ---------------------------------------------------------------------------

/**
 * MULTICA_AGENT_TIMEOUT 환경 변수 파싱.
 * 숫자(ms), "30m", "1h", "90s" 형식 지원.
 *
 * @param {string|undefined} raw
 * @param {number} defaultMs
 * @returns {number}
 */
function parseTimeout(raw, defaultMs) {
  if (!raw) return defaultMs;
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i);
  if (!match) return defaultMs;
  const value = parseFloat(match[1]);
  const unit  = (match[2] || 'ms').toLowerCase();
  switch (unit) {
    case 'h':  return Math.floor(value * 3600 * 1000);
    case 'm':  return Math.floor(value * 60 * 1000);
    case 's':  return Math.floor(value * 1000);
    case 'ms': return Math.floor(value);
    default:   return defaultMs;
  }
}

// ---------------------------------------------------------------------------
// stream-json 모드 실행
// ---------------------------------------------------------------------------

/**
 * stream-json 모드로 claude를 실행한다.
 * stdout 줄마다 JSON 파싱 후 onEvent 콜백 호출.
 *
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} [opts.model]
 * @param {function} [opts.onEvent]   파싱된 이벤트 객체를 받는 콜백
 * @returns {Promise<{success: boolean, exitCode: number, error?: string}>}
 */
function _runStream({ prompt, model, onEvent }) {
  return new Promise((resolve) => {
    const timeoutMs = parseTimeout(process.env.MULTICA_AGENT_TIMEOUT, DEFAULT_TIMEOUT_MS);

    const args = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (model) args.push('--model', model);

    const child = childProcess.spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env:   process.env,
    });

    let settled  = false;
    let timedOut = false;
    let stderrBuf = '';

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    try {
      child.stdin.write(prompt, 'utf8');
      child.stdin.end();
    } catch (_) {}

    // stdout 줄 단위 처리 → onEvent 콜백
    let lineBuf = '';
    child.stdout.on('data', (chunk) => {
      lineBuf += chunk.toString('utf8');
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop(); // 마지막 불완전 줄 보존
      for (const line of lines) {
        _dispatchLine(line, onEvent);
      }
    });

    child.stdout.on('end', () => {
      if (lineBuf) {
        _dispatchLine(lineBuf, onEvent);
        lineBuf = '';
      }
    });

    child.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString('utf8');
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;

      const exitCode = code === null ? 1 : code;
      const success  = exitCode === 0;

      if (success) {
        resolve({ success: true, exitCode: 0 });
      } else {
        const failure = classifyClaudeFailure({
          timedOut,
          timeoutMs,
          exitCode,
          stderrBuf,
        });
        resolve({ success: false, exitCode, error: failure.user_message, failure });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const failure = classifyClaudeFailure({ spawnError: err });
      resolve({ success: false, exitCode: 1, error: failure.user_message, failure });
    });
  });
}

/**
 * JSON 줄 파싱 후 onEvent 콜백 호출. 파싱 실패 시 무시.
 *
 * @param {string} line
 * @param {function|undefined} onEvent
 */
function _dispatchLine(line, onEvent) {
  const trimmed = (line || '').trim();
  if (!trimmed) return;
  if (typeof onEvent !== 'function') return;
  try {
    onEvent(JSON.parse(trimmed));
  } catch (_) {
    // 파싱 불가 줄은 무시 (raw-error.log는 runner/writer 책임)
  }
}

// ---------------------------------------------------------------------------
// json-schema 모드 실행
// ---------------------------------------------------------------------------

/**
 * --json-schema 모드로 claude를 실행한다.
 * stdout 전체를 JSON으로 파싱해 structured_output 반환.
 *
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} [opts.model]
 * @param {string} opts.jsonSchema
 * @returns {Promise<{success: boolean, exitCode: number, error?: string, structuredOutput?: object}>}
 */
function _runJson({ prompt, model, jsonSchema }) {
  return new Promise((resolve) => {
    const timeoutMs = parseTimeout(process.env.MULTICA_AGENT_TIMEOUT, DEFAULT_TIMEOUT_MS);

    const args = ['-p', '--output-format', 'json', '--json-schema', jsonSchema];
    if (model) args.push('--model', model);

    const child = childProcess.spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env:   process.env,
    });

    let settled  = false;
    let timedOut = false;
    let stdoutBuf = '';
    let stderrBuf = '';

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    try {
      child.stdin.write(prompt, 'utf8');
      child.stdin.end();
    } catch (_) {}

    child.stdout.on('data', (chunk) => { stdoutBuf += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderrBuf += chunk.toString('utf8'); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;

      const exitCode = code === null ? 1 : code;
      const success  = exitCode === 0;

      if (!success) {
        const failure = classifyClaudeFailure({ timedOut, timeoutMs, exitCode, stderrBuf });
        resolve({ success: false, exitCode, error: failure.user_message, failure });
        return;
      }

      let structuredOutput;
      try {
        const parsed = JSON.parse(stdoutBuf.trim());
        structuredOutput = parsed.structured_output ?? parsed;
      } catch (e) {
        const failure = classifyClaudeFailure({ jsonParseError: e.message });
        resolve({ success: false, exitCode: 1, error: failure.user_message, failure });
        return;
      }

      resolve({ success: true, exitCode: 0, structuredOutput });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const failure = classifyClaudeFailure({ spawnError: err });
      resolve({ success: false, exitCode: 1, error: failure.user_message, failure });
    });
  });
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * Claude CLI provider 실행 함수.
 *
 * stream-json 모드 (기본):
 *   claude -p --output-format stream-json --verbose [--model <model>]
 *   각 이벤트 줄을 onEvent(event) 콜백으로 전달.
 *
 * json-schema 모드 (jsonSchema 제공 시):
 *   claude -p --output-format json --json-schema '<schema>' [--model <model>]
 *   structuredOutput으로 반환.
 *
 * @param {object} opts
 * @param {string}   opts.prompt       Claude에 전달할 프롬프트
 * @param {string}   [opts.model]      모델 ID (미제공 시 Claude 기본값)
 * @param {function} [opts.onEvent]    이벤트 콜백 (stream-json 모드 전용)
 * @param {string}   [opts.jsonSchema] JSON schema 문자열 (제공 시 json 모드)
 * @returns {Promise<{success: boolean, exitCode: number, error?: string, structuredOutput?: object}>}
 */
function runClaude({ prompt, model, onEvent, jsonSchema } = {}) {
  if (!prompt) throw new TypeError('runClaude: prompt is required');

  if (jsonSchema) {
    return _runJson({ prompt, model, jsonSchema });
  }
  return _runStream({ prompt, model, onEvent });
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = { runClaude, parseTimeout };
