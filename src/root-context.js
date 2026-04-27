'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;

function abs(p) {
  return p ? path.resolve(p) : null;
}

function isSubPath(parent, child) {
  if (!parent || !child) return false;
  const rel = path.relative(abs(parent), abs(child));
  return rel === '' || (rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function inferPluginRoot(fromDir) {
  let dir = abs(fromDir || __dirname);
  while (dir && dir !== path.dirname(dir)) {
    if (
      fs.existsSync(path.join(dir, '.claude-plugin', 'plugin.json')) ||
      fs.existsSync(path.join(dir, '.codex-plugin', 'plugin.json')) ||
      (fs.existsSync(path.join(dir, 'skills')) && fs.existsSync(path.join(dir, 'scripts')))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

function looksLikePluginRoot(projectRoot) {
  const root = abs(projectRoot);
  if (!root) return false;
  return Boolean(
    fs.existsSync(path.join(root, '.claude-plugin', 'plugin.json')) ||
    fs.existsSync(path.join(root, '.codex-plugin', 'plugin.json')) ||
    (
      fs.existsSync(path.join(root, 'skills')) &&
      fs.existsSync(path.join(root, 'scripts')) &&
      fs.existsSync(path.join(root, 'package.json'))
    )
  );
}

function buildRootContext(opts) {
  const projectRoot = abs(opts.projectRoot);
  const pluginRoot = abs(opts.pluginRoot || inferPluginRoot(__dirname));
  const runtimeRoot = abs(opts.runtimeRoot);
  const executionRoot = abs(opts.executionRoot || projectRoot);
  const resultRoot = abs(opts.resultRoot);
  const artifactPaths = {};
  for (const [key, value] of Object.entries(opts.artifactPaths || {})) {
    artifactPaths[key] = abs(value);
  }

  const warnings = [];
  if (projectRoot && pluginRoot && projectRoot === pluginRoot) {
    warnings.push('project_root_matches_plugin_root');
  }
  if (projectRoot && runtimeRoot && !isSubPath(projectRoot, runtimeRoot)) {
    warnings.push('runtime_root_outside_project_root');
  }
  if (projectRoot && resultRoot && !isSubPath(projectRoot, resultRoot)) {
    warnings.push('result_root_outside_project_root');
  }

  const context = {
    schema_version: SCHEMA_VERSION,
    phase: opts.phase,
    feature: opts.feature || null,
    project_root: projectRoot,
    plugin_root: pluginRoot,
    execution_root: executionRoot,
    runtime_root: runtimeRoot,
    result_root: resultRoot,
    artifact_paths: artifactPaths,
    warnings,
  };
  if (opts.providerRouting) {
    context.provider_routing = opts.providerRouting;
  }
  return context;
}

function writeRootContext(filePath, context) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(context, null, 2) + '\n', 'utf8');
  return filePath;
}

function formatRootContext(context) {
  const lines = [
    `[built:${context.phase}] root context`,
    `  project_root: ${context.project_root || '(unknown)'}`,
    `  plugin_root:  ${context.plugin_root || '(unknown)'}`,
    `  execution_root: ${context.execution_root || '(unknown)'}`,
    `  runtime_root: ${context.runtime_root || '(none)'}`,
    `  result_root:  ${context.result_root || '(none)'}`,
  ];
  for (const [key, value] of Object.entries(context.artifact_paths || {})) {
    lines.push(`  ${key}: ${value}`);
  }
  if (context.warnings && context.warnings.length > 0) {
    lines.push(`  warnings: ${context.warnings.join(', ')}`);
  }
  return lines.join('\n');
}

module.exports = {
  SCHEMA_VERSION,
  buildRootContext,
  writeRootContext,
  formatRootContext,
  inferPluginRoot,
  looksLikePluginRoot,
  isSubPath,
};
