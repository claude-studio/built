/**
 * pipeline-runner.js
 *
 * runner: provider(Claude 또는 Codex)로부터 이벤트를 받아 progress.json / do-result.md를 기록한다.
 * MULTICA_AGENT_TIMEOUT 환경 변수 지원 (기본값 30분).
 *
 * API:
 *   runPipeline({ prompt, model, runtimeRoot, phase, featureId, resultOutputPath,
 *                 jsonSchema, providerSpec, signal })
 *     → Promise<{ success: boolean, exitCode: number, error?: string, structuredOutput?: object }>
 *
 *   providerSpec.name === 'codex':
 *     runCodex + createStandardWriter를 사용한다. jsonSchema는 outputSchema로 전달한다.
 *   providerSpec.name === 'claude' (기본):
 *     jsonSchema 제공 시 json-schema 모드, 그 외 stream-json 모드로 실행.
 *
 * 외부 npm 패키지 없음. 책임 분리: 파일 기록은 writer, provider 호출은 providers/*.
 * docs/contracts/provider-events.md, docs/contracts/provider-config.md 참고.
 */

'use strict';

const fs                            = require('fs');
const path                          = require('path');
const { runClaude, parseTimeout }  = require('./providers/claude');
const { runCodex }                 = require('./providers/codex');
const { createWriter }             = require('./progress-writer');
const { createStandardWriter }     = require('./providers/standard-writer');
const {
  markActiveCodexTurnFinished,
  recordCodexInterruptResult,
  resolveRunDir,
  updateActiveCodexTurn,
} = require('./codex-active-turn');

// ---------------------------------------------------------------------------
// runPipeline
// ---------------------------------------------------------------------------

function isRunStateAborted(runDir) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));
    return state && state.status === 'aborted';
  } catch (_) {
    return false;
  }
}

/**
 * provider를 선택해 실행하고 산출물을 기록한다.
 *
 * @param {object} opts
 * @param {string}   opts.prompt             provider에 전달할 프롬프트 문자열
 * @param {string}   [opts.model]            사용할 모델
 * @param {string}   opts.runtimeRoot        .built/features/<feature>/ 절대경로
 * @param {string}   [opts.phase='do']       현재 phase 이름
 * @param {string}   opts.featureId          feature 식별자
 * @param {string}   [opts.resultOutputPath] result 이벤트 시 do-result.md 저장 경로
 * @param {string}   [opts.jsonSchema]       Claude json-schema 모드 / Codex outputSchema
 * @param {object}   [opts.providerSpec]     ProviderSpec ({ name, model?, sandbox?, effort?, timeout_ms?, max_retries? })
 * @param {AbortSignal} [opts.signal]        provider interrupt/cancel 신호
 * @returns {Promise<{success: boolean, exitCode: number, error?: string, structuredOutput?: object}>}
 */
function runPipeline({
  prompt, model, runtimeRoot, phase = 'do', featureId,
  resultOutputPath, jsonSchema, providerSpec, signal,
}) {
  if (!prompt)      throw new TypeError('runPipeline: prompt is required');
  if (!runtimeRoot) throw new TypeError('runPipeline: runtimeRoot is required');
  if (!featureId)   throw new TypeError('runPipeline: featureId is required');

  const providerName = (providerSpec && providerSpec.name) || 'claude';

  // ---------------------------------------------------------------------------
  // Codex 경로
  // ---------------------------------------------------------------------------
  if (providerName === 'codex') {
    const writer = createStandardWriter({ runtimeRoot, phase, featureId, resultOutputPath });
    const runDir = resolveRunDir(
      process.env.BUILT_PROJECT_ROOT || process.cwd(),
      featureId
    );
    const runtimeRunDir = process.env.BUILT_RUNTIME_ROOT
      ? path.join(process.env.BUILT_RUNTIME_ROOT, 'runs', featureId)
      : runDir;

    function handleCodexEvent(event) {
      if (event && event.type === 'provider_metadata' && event.active_provider) {
        updateActiveCodexTurn(runtimeRunDir, event.active_provider);
      } else if (event && (event.type === 'phase_end' || event.type === 'error')) {
        markActiveCodexTurnFinished(runtimeRunDir, event.type === 'phase_end' ? event.status : 'failed');
        if (event.type === 'error' && event.codex_interrupt) {
          recordCodexInterruptResult(runtimeRunDir, event.codex_interrupt);
        }
      }
      writer.handleEvent(event);
    }

    return runCodex({
      prompt,
      phase,
      model:        (providerSpec && providerSpec.model)      || model        || undefined,
      effort:       (providerSpec && providerSpec.effort)     || undefined,
      sandbox:      (providerSpec && providerSpec.sandbox)    || undefined,
      timeout_ms:   (providerSpec && providerSpec.timeout_ms) || undefined,
      max_retries:  (providerSpec && providerSpec.max_retries) || undefined,
      retry_delay_ms: (providerSpec && providerSpec.retry_delay_ms) || undefined,
      signal,
      shouldAbort:  () => isRunStateAborted(runtimeRunDir),
      outputSchema: jsonSchema,
      onEvent:      handleCodexEvent,
    })
      .then((result) => {
        writer.close();
        return result;
      })
      .catch((err) => {
        writer.close();
        throw err;
      });
  }

  // ---------------------------------------------------------------------------
  // Claude 경로 (기본)
  // ---------------------------------------------------------------------------

  // json-schema 모드: progress-writer 없이 provider에 직접 위임
  if (jsonSchema) {
    return runClaude({ prompt, model, jsonSchema });
  }

  // stream-json 모드: progress-writer 생성 후 onEvent로 연결
  const writer = createWriter({ runtimeRoot, phase, featureId, resultOutputPath });

  return runClaude({ prompt, model, onEvent: (event) => writer.handleEvent(event) })
    .then((result) => {
      writer.close();
      return result;
    })
    .catch((err) => {
      writer.close();
      throw err;
    });
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

// _parseTimeout은 기존 테스트 후방 호환을 위해 재익스포트
module.exports = { runPipeline, _parseTimeout: parseTimeout };
