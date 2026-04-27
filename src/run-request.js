/**
 * src/run-request.js
 *
 * Shared run-request.json reader and provider routing helpers.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
  parseProviderConfig,
  getProviderForPhase,
  normalizeDefaultRunProfileProviders,
} = require('./providers/config');

class RunRequestParseError extends Error {
  constructor(filePath, cause) {
    super(`${filePath}: ${cause.message}`);
    this.name = 'RunRequestParseError';
    this.filePath = filePath;
    this.cause = cause;
  }
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readRunRequest(runRequestPath) {
  if (!fs.existsSync(runRequestPath)) return null;
  try {
    return readJsonFile(runRequestPath);
  } catch (err) {
    throw new RunRequestParseError(runRequestPath, err);
  }
}

function readBuiltConfig(projectRoot) {
  const configPath = path.join(projectRoot, '.built', 'config.json');
  try {
    return readJsonFile(configPath);
  } catch (_) {
    return null;
  }
}

function hasRunRequestProvidersField(req) {
  return Boolean(req && Object.prototype.hasOwnProperty.call(req, 'providers'));
}

function resolveProviderConfig(req, config) {
  if (hasRunRequestProvidersField(req)) {
    return {
      source: 'run-request.providers',
      config: parseProviderConfig(req),
    };
  }

  if (config && config.default_run_profile) {
    return {
      source: 'config.default_run_profile',
      config: normalizeDefaultRunProfileProviders(config.default_run_profile),
    };
  }

  return {
    source: 'built.default',
    config: parseProviderConfig(null),
  };
}

function resolvePhaseProvider({ runRequest, builtConfig, phase, fallbackPhase }) {
  const resolution = resolveProviderConfig(runRequest, builtConfig);
  const config = resolution.config;

  let providerSpec;
  if (config[phase]) {
    providerSpec = config[phase];
  } else if (fallbackPhase && config[fallbackPhase]) {
    providerSpec = config[fallbackPhase];
  } else {
    providerSpec = getProviderForPhase(config, phase);
  }

  return {
    source: resolution.source,
    config,
    providerSpec,
  };
}

function printRunRequestParseFailure(label, err) {
  console.error(`[${label}] run-request.json 파싱 실패: ${err.message}`);
  console.error(`[${label}] run-request.json의 JSON 형식과 provider 설정을 확인하세요.`);
}

function printProviderConfigFailure(label, configPath, err) {
  console.error(`[${label}] provider 설정 오류: ${configPath}: ${err.message}`);
  console.error(`[${label}] docs/contracts/provider-config.md의 providers phase와 필드 목록을 확인하세요.`);
}

module.exports = {
  RunRequestParseError,
  readRunRequest,
  readBuiltConfig,
  hasRunRequestProvidersField,
  resolveProviderConfig,
  resolvePhaseProvider,
  printRunRequestParseFailure,
  printProviderConfigFailure,
};
