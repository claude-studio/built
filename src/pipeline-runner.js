#!/usr/bin/env node
/**
 * pipeline-runner.js
 *
 * claude -p 서브세션을 실행하고 stream-json stdout을 progress-writer.js로 파이프하는 메인 실행기.
 * MULTICA_AGENT_TIMEOUT 환경 변수 지원 (기본값 30분).
 *
 * API:
 *   runPipeline({ prompt, model, runtimeRoot, phase, featureId, resultOutputPath, jsonSchema })
 *     → Promise<{ success: boolean, exitCode: number, error?: string, structuredOutput?: object }>
 *
 *   jsonSchema 제공 시: --bare -p --output-format json --json-schema '<schema>' 모드로 실행.
 *   응답 JSON의 structured_output 필드를 파싱해 structuredOutput으로 반환.
 *
 * 외부 npm 패키지 없음 (Node.js 표준 라이브러리만). BUILT-DESIGN.md §8 기준.
 */

'use strict';

const childProcess    = require('child_process');
const { createWriter } = require('./progress-writer');

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30분

// ---------------------------------------------------------------------------
// runPipeline
// ---------------------------------------------------------------------------

/**
 * claude -p 서브세션을 실행한다.
 *
 * @param {object} opts
 * @param {string} opts.prompt            claude에 전달할 프롬프트 문자열
 * @param {string} [opts.model]           사용할 모델 (미제공 시 claude 기본값)
 * @param {string} opts.runtimeRoot       .built/runtime/runs/<feature>/ 절대경로
 * @param {string} [opts.phase='do']      현재 phase 이름
 * @param {string} opts.featureId         feature 식별자
 * @param {string} [opts.resultOutputPath] result 이벤트 시 do-result.md 저장 경로
 * @param {string} [opts.jsonSchema]      제공 시 --output-format json + --json-schema 모드 사용
 * @returns {Promise<{success: boolean, exitCode: number, error?: string, structuredOutput?: object}>}
 */
function runPipeline({ prompt, model, runtimeRoot, phase = 'do', featureId, resultOutputPath, jsonSchema }) {
  if (!prompt)      throw new TypeError('runPipeline: prompt is required');
  if (!runtimeRoot) throw new TypeError('runPipeline: runtimeRoot is required');
  if (!featureId)   throw new TypeError('runPipeline: featureId is required');

  if (jsonSchema) {
    return _runPipelineJson({ prompt, model, runtimeRoot, phase, featureId, jsonSchema });
  }

  return new Promise((resolve) => {
    // timeout 설정
    const timeoutMs = _parseTimeout(process.env.MULTICA_AGENT_TIMEOUT, DEFAULT_TIMEOUT_MS);

    // claude CLI 인자 구성
    const args = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (model) {
      args.push('--model', model);
    }

    // progress-writer 인스턴스 생성
    const writer = createWriter({ runtimeRoot, phase, featureId, resultOutputPath });

    // 서브프로세스 실행
    const child = childProcess.spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let settled = false;
    let timedOut = false;
    let stderrBuf = '';

    // 타임아웃 타이머
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    // stdin으로 프롬프트 전달
    try {
      child.stdin.write(prompt, 'utf8');
      child.stdin.end();
    } catch (e) {
      // stdin 쓰기 실패 무시 (process 오류로 처리됨)
    }

    // stdout 줄 단위 처리
    let lineBuf = '';
    child.stdout.on('data', (chunk) => {
      lineBuf += chunk.toString('utf8');
      const lines = lineBuf.split('\n');
      // 마지막 요소는 불완전한 줄이므로 버퍼에 보존
      lineBuf = lines.pop();
      for (const line of lines) {
        writer.handleLine(line);
      }
    });

    child.stdout.on('end', () => {
      // 남은 버퍼 처리
      if (lineBuf) {
        writer.handleLine(lineBuf);
        lineBuf = '';
      }
    });

    // stderr 수집 (에러 메시지용)
    child.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString('utf8');
    });

    // 프로세스 종료 처리
    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;

      writer.close();

      const exitCode = code === null ? 1 : code;
      const success  = exitCode === 0;

      if (success) {
        resolve({ success: true, exitCode: 0 });
      } else {
        let errorMsg;
        if (timedOut) {
          errorMsg = `Process timed out after ${timeoutMs}ms`;
        } else {
          errorMsg = stderrBuf.trim() || `Process exited with code ${exitCode}`;
        }
        resolve({ success: false, exitCode, error: errorMsg });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;

      writer.close();
      resolve({ success: false, exitCode: 1, error: err.message });
    });
  });
}

/**
 * --json-schema 모드: --bare -p --output-format json --json-schema '<schema>'
 * stdout 전체를 JSON으로 파싱해 structured_output 반환.
 *
 * @private
 */
function _runPipelineJson({ prompt, model, runtimeRoot, phase, featureId, jsonSchema }) {
  return new Promise((resolve) => {
    const timeoutMs = _parseTimeout(process.env.MULTICA_AGENT_TIMEOUT, DEFAULT_TIMEOUT_MS);

    const args = ['--bare', '-p', '--output-format', 'json', '--json-schema', jsonSchema];
    if (model) {
      args.push('--model', model);
    }

    const child = childProcess.spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
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
        const errorMsg = timedOut
          ? `Process timed out after ${timeoutMs}ms`
          : stderrBuf.trim() || `Process exited with code ${exitCode}`;
        resolve({ success: false, exitCode, error: errorMsg });
        return;
      }

      // stdout을 JSON으로 파싱해 structured_output 추출
      let structuredOutput;
      try {
        const parsed = JSON.parse(stdoutBuf.trim());
        structuredOutput = parsed.structured_output ?? parsed;
      } catch (e) {
        resolve({ success: false, exitCode: 1, error: `JSON parse failed: ${e.message}` });
        return;
      }

      resolve({ success: true, exitCode: 0, structuredOutput });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ success: false, exitCode: 1, error: err.message });
    });
  });
}

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
function _parseTimeout(raw, defaultMs) {
  if (!raw) return defaultMs;
  const trimmed = raw.trim();

  // 단위 접미사 파싱
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
// exports
// ---------------------------------------------------------------------------

module.exports = { runPipeline, _parseTimeout };
