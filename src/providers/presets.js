/**
 * src/providers/presets.js
 *
 * provider preset 정의와 run-request.json 생성.
 *
 * 사용자가 수동 JSON 편집 없이 대표 provider preset을 적용할 수 있게 한다.
 * 생성된 설정은 .built/runtime/runs/<feature>/run-request.json에만 기록한다.
 * providers가 있으면 run-request snapshot 계약에 맞춰 ProviderSpec으로 정규화한다.
 * .built/config.json에는 절대 쓰지 않는다.
 *
 * API:
 *   PRESETS                    — preset 이름 → providers 맵
 *   listPresets()              — 사용 가능한 preset 이름 배열
 *   getPreset(name)            — preset providers 맵 반환
 *   buildRunRequest(opts)      — normalized run-request.json 객체 생성
 *   writeRunRequest(dir, req)  — run-request.json 파일 기록
 *
 * docs/ops/provider-setup-guide.md 참고.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  normalizeDefaultRunProfileProviders,
  parseProviderConfig,
} = require('./config');

// ---------------------------------------------------------------------------
// Preset 정의
// ---------------------------------------------------------------------------

/**
 * 대표 provider preset 맵.
 * 각 값은 run-request.json의 providers 필드 형식과 동일하다.
 */
const PRESETS = {
  /** 모든 phase Claude 기본값. providers 필드 없음과 동일. */
  'claude-default': {},

  /** Do+Iter는 Codex, Check+Report는 Claude. 교차 검증 패턴. */
  'codex-do': {
    do:    { name: 'codex', sandbox: 'workspace-write' },
    check: 'claude',
    iter:  { name: 'codex', sandbox: 'workspace-write' },
    report: 'claude',
  },

  /** 일반 run 4단계(Do/Check/Iter/Report)는 Codex. plan_synthesis는 포함하지 않는다. */
  'codex-run': {
    do:     { name: 'codex', sandbox: 'workspace-write' },
    check:  { name: 'codex', sandbox: 'read-only' },
    iter:   { name: 'codex', sandbox: 'workspace-write' },
    report: { name: 'codex', sandbox: 'read-only' },
  },

  /** plan_synthesis만 Codex. 나머지 Claude 기본값. */
  'codex-plan': {
    plan_synthesis: { name: 'codex', sandbox: 'read-only' },
  },

  /** plan_synthesis까지 포함한 모든 구현 phase Codex. advanced/internal preset. */
  'codex-all': {
    plan_synthesis: { name: 'codex', sandbox: 'read-only' },
    do:             { name: 'codex', sandbox: 'workspace-write' },
    check:          { name: 'codex', sandbox: 'read-only' },
    iter:           { name: 'codex', sandbox: 'workspace-write' },
    report:         { name: 'codex', sandbox: 'read-only' },
  },
};

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * 사용 가능한 preset 이름 목록.
 * @returns {string[]}
 */
function listPresets() {
  return Object.keys(PRESETS);
}

/**
 * preset 이름으로 providers 맵을 반환한다.
 *
 * @param {string} name  preset 이름
 * @returns {{ [phase: string]: string|object }}
 * @throws {Error} 알 수 없는 preset
 */
function getPreset(name) {
  if (!PRESETS.hasOwnProperty(name)) {
    throw new Error(
      `알 수 없는 preset "${name}". 사용 가능한 preset: ${listPresets().join(', ')}.`
    );
  }
  return JSON.parse(JSON.stringify(PRESETS[name]));
}

/**
 * run-request.json 객체를 생성한다.
 *
 * preset, 직접 providers, default_run_profile 중 하나를 받아 검증 후 완성된
 * 요청 객체를 반환한다. providers는 저장 시점의 ProviderSpec snapshot으로 정규화한다.
 *
 * @param {object} opts
 * @param {string} opts.featureId         feature 이름 (필수)
 * @param {string} [opts.planPath]        plan 파일 경로 (기본: .built/features/<featureId>.md)
 * @param {string} [opts.preset]          preset 이름
 * @param {object} [opts.providers]       직접 providers 맵 (preset과 동시 사용 불가)
 * @param {object} [opts.defaultRunProfile] config.default_run_profile 문자열 맵
 * @param {string} [opts.model]           전역 모델 (Claude provider용)
 * @returns {object}  run-request.json 객체
 * @throws {Error} 검증 실패
 */
function buildRunRequest(opts) {
  if (!opts || !opts.featureId) {
    throw new Error('featureId는 필수입니다.');
  }

  const providerSources = [opts.preset, opts.providers, opts.defaultRunProfile].filter(Boolean);
  if (providerSources.length > 1) {
    throw new Error('preset, providers, defaultRunProfile은 동시에 지정할 수 없습니다. 하나만 선택하세요.');
  }

  let providers;
  if (opts.preset) {
    providers = getPreset(opts.preset);
  } else if (opts.providers) {
    providers = opts.providers;
  } else if (opts.defaultRunProfile) {
    providers = normalizeDefaultRunProfileProviders(opts.defaultRunProfile);
  } else {
    providers = {};
  }

  // parseProviderConfig로 검증하고 run-request snapshot용 ProviderSpec으로 정규화한다.
  const normalizedProviders = parseProviderConfig({ providers });

  const req = {
    featureId: opts.featureId,
    planPath: opts.planPath || `.built/features/${opts.featureId}.md`,
    createdAt: new Date().toISOString(),
  };

  if (opts.model) {
    req.model = opts.model;
  }

  if (Object.keys(normalizedProviders).length > 0) {
    req.providers = normalizedProviders;
  }

  return req;
}

/**
 * run-request.json 파일을 지정 디렉토리에 기록한다.
 * 디렉토리가 없으면 재귀적으로 생성한다.
 *
 * @param {string} dir   .built/runtime/runs/<feature> 디렉토리 경로
 * @param {object} req   buildRunRequest 반환값
 * @returns {string}      기록된 파일 경로
 */
function writeRunRequest(dir, req) {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'run-request.json');
  fs.writeFileSync(filePath, JSON.stringify(req, null, 2) + '\n', 'utf8');
  return filePath;
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = { PRESETS, listPresets, getPreset, buildRunRequest, writeRunRequest };
