#!/usr/bin/env node
/**
 * Real provider full lifecycle smoke.
 *
 * 기본 실행에서는 provider를 호출하지 않는다.
 *   BUILT_FULL_PIPELINE_SMOKE=1 node scripts/smoke-full-pipeline.js
 *   BUILT_FULL_PIPELINE_SMOKE=1 BUILT_FULL_PIPELINE_PROFILE=codex \
 *     node scripts/smoke-full-pipeline.js
 *
 * 실제 init으로 disposable target project를 만든 뒤
 * plan_synthesis -> Do -> Check -> Iter -> Report를 scripts/run.js로 실행한다.
 * lifecycle 결과 파일은 기존 runner/writer가 소유하며 이 스크립트는 입력 준비와
 * 완료 검증, redacted aggregate summary 저장만 담당한다.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const { init } = require('./init');
const { parse } = require('../src/frontmatter');
const { checkLogin } = require('../src/providers/codex');
const { buildRunRequest, writeRunRequest } = require('../src/providers/presets');
const { sanitizeText } = require('./sanitize');
const {
  createSummary,
  saveSummary,
  formatFailureSummary,
} = require('./smoke-artifact');

const BUILT_ROOT = path.resolve(__dirname, '..');
const FEATURE = 'full-pipeline-smoke';
const OPT_IN_ENV = 'BUILT_FULL_PIPELINE_SMOKE';
const PROFILE_ENV = 'BUILT_FULL_PIPELINE_PROFILE';
const MODEL_ENV = 'BUILT_FULL_PIPELINE_MODEL';
const PHASE_TIMEOUT_ENV = 'BUILT_FULL_PIPELINE_PHASE_TIMEOUT_MS';
const TOTAL_TIMEOUT_ENV = 'BUILT_FULL_PIPELINE_TIMEOUT_MS';
const DEFAULT_PHASE_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_TOTAL_TIMEOUT_MS = 60 * 60 * 1000;
const VERIFICATION_COMMAND = 'npm test';
const ACCEPTANCE_CRITERIA = [
  'src/greeting.js가 greeting(name) 함수를 CommonJS로 export한다.',
  'greeting("Built")가 "Hello, Built!"를 반환한다.',
  '빈 문자열 또는 공백만 전달하면 "Hello, World!"를 반환한다.',
  'npm test가 통과한다.',
];

class SmokeFailure extends Error {
  constructor(kind, message, stage) {
    super(message);
    this.name = 'SmokeFailure';
    this.kind = kind;
    this.stage = stage || null;
  }
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveProfile(value) {
  const profile = String(value || 'claude').trim().toLowerCase();
  if (profile !== 'claude' && profile !== 'codex') {
    throw new SmokeFailure(
      'unknown',
      `${PROFILE_ENV}는 claude 또는 codex여야 합니다.`,
      'profile'
    );
  }
  return profile;
}

function providerSpecsFor(profile, phaseTimeoutMs) {
  if (profile === 'claude') return undefined;
  return {
    plan_synthesis: { name: 'codex', sandbox: 'read-only', timeout_ms: phaseTimeoutMs },
    do:             { name: 'codex', sandbox: 'workspace-write', timeout_ms: phaseTimeoutMs },
    check:          { name: 'codex', sandbox: 'read-only', timeout_ms: phaseTimeoutMs },
    iter:           { name: 'codex', sandbox: 'workspace-write', timeout_ms: phaseTimeoutMs },
    report:         { name: 'codex', sandbox: 'read-only', timeout_ms: phaseTimeoutMs },
  };
}

function buildProfileRunRequest(profile, options = {}) {
  const phaseTimeoutMs = options.phaseTimeoutMs || DEFAULT_PHASE_TIMEOUT_MS;
  const model = options.model || (profile === 'codex' ? 'gpt-5.5' : undefined);
  const req = buildRunRequest({
    featureId: FEATURE,
    planPath: `.built/features/${FEATURE}.md`,
    model,
    providers: providerSpecsFor(profile, phaseTimeoutMs),
    preset: profile === 'claude' ? 'claude-default' : undefined,
  });

  req.plan_synthesis = true;
  req.acceptance_criteria = [...ACCEPTANCE_CRITERIA];
  req.verification = { commands: [VERIFICATION_COMMAND] };
  return req;
}

function featureSpec() {
  return [
    '# 전체 pipeline smoke greeting',
    '',
    '## 목표',
    '',
    '`src/greeting.js`에 작은 greeting helper를 구현한다.',
    '',
    '## 구현 요구사항',
    '',
    '- `greeting(name)` 함수를 CommonJS(`module.exports`)로 export한다.',
    '- 일반 문자열은 앞뒤 공백을 제거해 `Hello, <name>!`을 반환한다.',
    '- 빈 문자열, 공백 문자열, 인자 생략은 `Hello, World!`를 반환한다.',
    '- 기존 `test/greeting.test.js`를 변경하지 않고 통과시킨다.',
    '- 다른 파일은 불필요하게 변경하지 않는다.',
    '',
    '## 완료 기준',
    '',
    ...ACCEPTANCE_CRITERIA.map((criterion) => `- ${criterion}`),
    '',
  ].join('\n');
}

function testSource() {
  return [
    "'use strict';",
    '',
    "const test = require('node:test');",
    "const assert = require('node:assert/strict');",
    "const { greeting } = require('../src/greeting');",
    '',
    "test('이름을 포함한 인사를 반환한다', () => {",
    "  assert.equal(greeting('Built'), 'Hello, Built!');",
    '});',
    '',
    "test('빈 입력은 World로 대체한다', () => {",
    "  assert.equal(greeting('   '), 'Hello, World!');",
    "  assert.equal(greeting(), 'Hello, World!');",
    '});',
    '',
  ].join('\n');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function runCommand(command, args, options = {}) {
  return childProcess.spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout,
  });
}

function requireCommandOk(result, label) {
  if (result.status === 0) return;
  throw new SmokeFailure('unknown', `${label}에 실패했습니다.`, 'setup');
}

function setupTargetProject(projectRoot, profile, options = {}) {
  init(projectRoot, FEATURE);

  fs.writeFileSync(
    path.join(projectRoot, '.built', 'features', `${FEATURE}.md`),
    featureSpec(),
    'utf8'
  );
  writeJson(path.join(projectRoot, '.built', 'hooks.json'), {
    pipeline: {
      after_do: [{ run: VERIFICATION_COMMAND, halt_on_fail: true }],
      after_check: [],
      after_report: [],
    },
  });
  writeJson(path.join(projectRoot, 'package.json'), {
    name: 'built-full-pipeline-smoke',
    version: '0.0.0',
    private: true,
    scripts: { test: 'node --test test/greeting.test.js' },
  });
  fs.mkdirSync(path.join(projectRoot, 'test'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'test', 'greeting.test.js'), testSource(), 'utf8');

  requireCommandOk(runCommand('git', ['init', '-q'], { cwd: projectRoot }), 'git init');
  requireCommandOk(
    runCommand('git', ['config', 'user.email', 'smoke@built.local'], { cwd: projectRoot }),
    'git user.email 설정'
  );
  requireCommandOk(
    runCommand('git', ['config', 'user.name', 'built smoke'], { cwd: projectRoot }),
    'git user.name 설정'
  );
  requireCommandOk(runCommand('git', ['add', '-A'], { cwd: projectRoot }), '초기 파일 stage');
  requireCommandOk(
    runCommand('git', ['commit', '-q', '-m', '초기화: 전체 pipeline smoke 대상 구성'], { cwd: projectRoot }),
    '초기 commit'
  );

  const baseResult = runCommand('git', ['rev-parse', 'HEAD'], { cwd: projectRoot });
  requireCommandOk(baseResult, '초기 commit 조회');

  const runDir = path.join(projectRoot, '.built', 'runtime', 'runs', FEATURE);
  const req = buildProfileRunRequest(profile, options);
  writeRunRequest(runDir, req);

  return {
    baseCommit: String(baseResult.stdout || '').trim(),
    runDir,
    runRequest: req,
  };
}

function preflightProvider(profile, projectRoot, options = {}) {
  const commandRunner = options.commandRunner || runCommand;
  const codexLoginCheck = options.codexLoginCheck || checkLogin;
  if (profile === 'codex') {
    const result = codexLoginCheck(projectRoot);
    if (!result.available) {
      const kind = String(result.detail || '').includes('app-server')
        ? 'app_server'
        : 'provider_unavailable';
      throw new SmokeFailure(kind, result.detail || 'Codex CLI를 사용할 수 없습니다.', 'preflight');
    }
    if (!result.loggedIn) {
      throw new SmokeFailure('auth', 'Codex 로그인이 필요합니다.', 'preflight');
    }
    return { version: result.detail || 'codex' };
  }

  const result = commandRunner('claude', ['--version'], { cwd: projectRoot });
  if (result.error || result.status !== 0) {
    throw new SmokeFailure(
      'provider_unavailable',
      'Claude CLI가 설치되지 않았거나 PATH에 없습니다.',
      'preflight'
    );
  }

  const authResult = commandRunner('claude', ['auth', 'status'], { cwd: projectRoot });
  let authStatus = null;
  try {
    authStatus = JSON.parse(String(authResult.stdout || '').trim());
  } catch (_) {}
  if (authResult.status !== 0 || !authStatus || authStatus.loggedIn !== true) {
    throw new SmokeFailure('auth', 'Claude 로그인이 필요합니다.', 'preflight');
  }

  return { version: String(result.stdout || '').trim() || 'claude' };
}

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new SmokeFailure('model_response', `${label}가 생성되지 않았습니다.`, 'verification');
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    throw new SmokeFailure('model_response', `${label}를 JSON으로 읽을 수 없습니다.`, 'verification');
  }
}

function readFrontmatter(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new SmokeFailure('model_response', `${label}가 생성되지 않았습니다.`, 'verification');
  }
  try {
    return parse(fs.readFileSync(filePath, 'utf8')).data;
  } catch (_) {
    throw new SmokeFailure('model_response', `${label} frontmatter를 읽을 수 없습니다.`, 'verification');
  }
}

function ensureWithin(root, target, label) {
  let resolvedRoot;
  let resolvedTarget;
  try {
    resolvedRoot = fs.realpathSync(path.resolve(root));
    resolvedTarget = fs.realpathSync(path.resolve(target || ''));
  } catch (_) {
    throw new SmokeFailure('sandbox', `${label}의 canonical path를 확인할 수 없습니다.`, 'verification');
  }
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (!target || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new SmokeFailure('sandbox', `${label}가 disposable target 밖을 가리킵니다.`, 'verification');
  }
  return resolvedTarget;
}

function existingPhaseLogs(resultDir) {
  const logsDir = path.join(resultDir, 'logs');
  const logs = {};
  for (const phase of ['plan_synthesis', 'do', 'check', 'iter', 'report']) {
    logs[phase] = fs.existsSync(path.join(logsDir, `${phase}.jsonl`));
  }
  return logs;
}

function verifyProviderRouting(profile, runRequest, state) {
  const expectedSandboxes = {
    plan_synthesis: 'read-only',
    do: 'workspace-write',
    check: 'read-only',
    iter: 'workspace-write',
    report: 'read-only',
  };
  const phases = ['plan_synthesis', 'do', 'check', 'iter', 'report'];

  if (profile === 'claude' && Object.prototype.hasOwnProperty.call(runRequest, 'providers')) {
    throw new SmokeFailure('model_response', 'Claude 기본 profile에 providers override가 남았습니다.', 'verification');
  }

  for (const phase of phases) {
    const routed = state.provider_routing && state.provider_routing.phases
      ? state.provider_routing.phases[phase]
      : null;
    if (!routed || routed.name !== profile) {
      throw new SmokeFailure(
        'model_response',
        `${phase} provider routing이 ${profile}과 일치하지 않습니다.`,
        'verification'
      );
    }
    if (profile === 'codex' && routed.sandbox !== expectedSandboxes[phase]) {
      throw new SmokeFailure(
        'sandbox',
        `${phase} sandbox가 ${expectedSandboxes[phase]}가 아닙니다.`,
        'verification'
      );
    }
  }
}

function verifyLifecycle({ projectRoot, runDir, baseCommit, profile }) {
  const runRequestPath = path.join(runDir, 'run-request.json');
  const statePath = path.join(runDir, 'state.json');
  const runRootContextPath = path.join(runDir, 'root-context.json');
  const runRequest = readJson(runRequestPath, 'run-request.json');
  const state = readJson(statePath, 'state.json');
  readJson(runRootContextPath, 'run root-context.json');

  if (state.status !== 'completed' || state.phase !== 'report') {
    throw new SmokeFailure(
      'model_response',
      `state.json terminal 상태가 completed/report가 아닙니다 (status=${state.status}, phase=${state.phase}).`,
      'verification'
    );
  }
  verifyProviderRouting(profile, runRequest, state);

  const execution = state.execution_worktree || {};
  const executionRoot = ensureWithin(projectRoot, execution.path, 'execution worktree');
  const resultDir = ensureWithin(projectRoot, execution.result_dir, 'result root');
  if (!execution.enabled) {
    throw new SmokeFailure('sandbox', 'worktree-first 실행이 활성화되지 않았습니다.', 'verification');
  }

  const progress = readJson(path.join(resultDir, 'progress.json'), 'progress.json');
  if (progress.status !== 'completed') {
    throw new SmokeFailure(
      'model_response',
      `progress.json snapshot이 completed가 아닙니다 (status=${progress.status}).`,
      'verification'
    );
  }

  const planJson = readJson(path.join(resultDir, 'plan-synthesis.json'), 'plan-synthesis.json');
  if (!planJson.output || !Array.isArray(planJson.output.steps)) {
    throw new SmokeFailure('model_response', 'plan-synthesis.json steps가 없습니다.', 'verification');
  }
  if (!fs.existsSync(path.join(resultDir, 'plan-synthesis.md'))) {
    throw new SmokeFailure('model_response', 'plan-synthesis.md가 생성되지 않았습니다.', 'verification');
  }
  readJson(path.join(resultDir, 'root-context.json'), 'result root-context.json');

  const doData = readFrontmatter(path.join(resultDir, 'do-result.md'), 'do-result.md');
  if (doData.status !== 'completed' || doData.feature_id !== FEATURE) {
    throw new SmokeFailure('model_response', 'do-result.md 완료 계약이 일치하지 않습니다.', 'verification');
  }

  const checkData = readFrontmatter(path.join(resultDir, 'check-result.md'), 'check-result.md');
  if (checkData.status !== 'approved') {
    throw new SmokeFailure(
      'model_response',
      `approved check가 확인되지 않았습니다 (status=${checkData.status || 'missing'}).`,
      'verification'
    );
  }

  const reportData = readFrontmatter(path.join(resultDir, 'report.md'), 'report.md');
  if (reportData.status !== 'completed' || reportData.provider !== profile) {
    throw new SmokeFailure('model_response', 'report.md 완료/provider 계약이 일치하지 않습니다.', 'verification');
  }

  const trackedDiff = runCommand(
    'git',
    ['diff', '--name-only', baseCommit, '--', 'src/greeting.js'],
    { cwd: executionRoot }
  );
  const worktreeStatus = runCommand(
    'git',
    ['status', '--porcelain', '--untracked-files=all', '--', 'src/greeting.js'],
    { cwd: executionRoot }
  );
  requireCommandOk(trackedDiff, '구현 diff 확인');
  requireCommandOk(worktreeStatus, '구현 status 확인');
  const implementationChanged = Boolean(
    String(trackedDiff.stdout || '').trim() || String(worktreeStatus.stdout || '').trim()
  );
  if (!implementationChanged || !fs.existsSync(path.join(executionRoot, 'src', 'greeting.js'))) {
    throw new SmokeFailure(
      'model_response',
      'Do가 completed이지만 src/greeting.js 실제 변경이 확인되지 않았습니다.',
      'verification'
    );
  }

  const verification = runCommand('npm', ['test'], {
    cwd: executionRoot,
    timeout: 2 * 60 * 1000,
  });
  if (verification.status !== 0) {
    throw new SmokeFailure('model_response', '최종 npm test가 실패했습니다.', 'verification');
  }

  const phaseLogs = existingPhaseLogs(resultDir);
  if (!phaseLogs.do || !phaseLogs.report) {
    throw new SmokeFailure('model_response', 'Do 또는 Report phase log가 없습니다.', 'verification');
  }
  if (profile === 'codex' && (!phaseLogs.plan_synthesis || !phaseLogs.check)) {
    throw new SmokeFailure('model_response', 'Codex read-only phase log가 없습니다.', 'verification');
  }

  const model = reportData.model || progress.model || doData.model || null;
  if (!model) {
    throw new SmokeFailure('model_response', 'provider model 메타가 기록되지 않았습니다.', 'verification');
  }

  return {
    model,
    verification: {
      init_created: fs.existsSync(path.join(projectRoot, '.built', 'config.json')),
      run_request_exists: true,
      state_terminal: 'completed',
      lifecycle_ssot: 'state.json',
      progress_role: 'snapshot',
      progress_completed: true,
      root_context: { run: true, result: true },
      phases: {
        plan_synthesis: { result: true, log: phaseLogs.plan_synthesis },
        do: { result: true, log: phaseLogs.do },
        check: { result: true, log: phaseLogs.check, status: 'approved' },
        iter: { status: 'approved_noop_or_completed' },
        report: { result: true, log: phaseLogs.report },
      },
      implementation_changed: true,
      implementation_file: 'src/greeting.js',
      verification_command: VERIFICATION_COMMAND,
      verification_passed: true,
      usage_optional: true,
    },
  };
}

function classifyPipelineFailure({ signal, error, state }) {
  if (signal) return 'timeout';
  if (error && error.code === 'ENOENT') return 'provider_unavailable';
  const kind = state && state.last_failure ? state.last_failure.kind : null;
  if (['provider_unavailable', 'app_server', 'auth', 'sandbox', 'timeout', 'model_response'].includes(kind)) {
    return kind;
  }
  return 'model_response';
}

function readStateIfPresent(runDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

function createLifecycleSummary(params) {
  return createSummary({
    provider: params.provider,
    phase: 'full_lifecycle',
    model: params.model || null,
    duration_ms: params.duration_ms,
    skipped: Boolean(params.skipped),
    success: Boolean(params.success),
    failure_kind: params.failure_kind || null,
    failure_message: params.failure_message || null,
    verification: params.verification || null,
  });
}

function artifactDisplayPath(summary) {
  return `.built/runtime/smoke/${summary.id}/summary.json`;
}

function outputFailureAxis(logger, kind) {
  const labels = {
    app_server: 'app-server',
    auth: '인증(auth)',
  };
  logger.error(`[built:smoke-pipeline] 원인축: ${labels[kind] || kind}`);
}

function runSmoke(options = {}) {
  const env = options.env || process.env;
  const artifactRoot = options.artifactRoot || BUILT_ROOT;
  const logger = options.logger || console;
  let profile = 'claude';

  try {
    profile = resolveProfile(env[PROFILE_ENV]);
  } catch (err) {
    const message = formatFailureSummary('unknown', 'full_lifecycle', sanitizeText(err.message), 'unknown');
    const summary = createLifecycleSummary({
      provider: 'unknown', duration_ms: 0, skipped: false, success: false,
      failure_kind: 'unknown', failure_message: message,
    });
    saveSummary(artifactRoot, summary);
    outputFailureAxis(logger, 'unknown');
    logger.error(message);
    return 1;
  }

  if (env[OPT_IN_ENV] !== '1') {
    const summary = createLifecycleSummary({
      provider: profile,
      duration_ms: 0,
      skipped: true,
      success: true,
    });
    saveSummary(artifactRoot, summary);
    logger.log(
      `[built:smoke-pipeline] skip: ${OPT_IN_ENV}=1 설정 시 ${profile} 전체 lifecycle smoke를 실행합니다.`
    );
    logger.log(`[built:smoke-pipeline] artifact: ${artifactDisplayPath(summary)}`);
    return 0;
  }

  const startedAt = Date.now();
  const phaseTimeoutMs = parsePositiveInt(env[PHASE_TIMEOUT_ENV], DEFAULT_PHASE_TIMEOUT_MS);
  const totalTimeoutMs = parsePositiveInt(env[TOTAL_TIMEOUT_ENV], DEFAULT_TOTAL_TIMEOUT_MS);
  const model = env[MODEL_ENV] || (profile === 'codex' ? 'gpt-5.5' : undefined);
  let projectRoot;
  let runDir;

  try {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), `built-${profile}-pipeline-smoke-`));
    logger.log(`[built:smoke-pipeline] profile: ${profile}`);
    logger.log('[built:smoke-pipeline] provider 사전 점검...');
    preflightProvider(profile, projectRoot);

    logger.log('[built:smoke-pipeline] disposable target init...');
    const setup = setupTargetProject(projectRoot, profile, { phaseTimeoutMs, model });
    runDir = setup.runDir;

    logger.log('[built:smoke-pipeline] plan_synthesis -> Do -> Check -> Iter -> Report 실행...');
    const runResult = runCommand(
      process.execPath,
      [path.join(__dirname, 'run.js'), FEATURE, '--allow-cost-overrun'],
      {
        cwd: projectRoot,
        env: {
          ...env,
          NO_NOTIFY: '1',
          MULTICA_AGENT_TIMEOUT: String(phaseTimeoutMs),
          BUILT_MAX_ITER: env.BUILT_MAX_ITER || '2',
        },
        stdio: 'inherit',
        timeout: totalTimeoutMs,
      }
    );

    if (runResult.status !== 0) {
      const state = readStateIfPresent(runDir);
      const kind = classifyPipelineFailure({
        signal: runResult.signal || (runResult.status === null ? 'timeout' : null),
        error: runResult.error,
        state,
      });
      const phase = state && state.phase ? state.phase : 'unknown';
      throw new SmokeFailure(
        kind,
        `전체 pipeline이 완료되지 않았습니다 (phase=${phase}, exit=${runResult.status ?? 'timeout'}).`,
        phase
      );
    }

    const checked = verifyLifecycle({
      projectRoot,
      runDir,
      baseCommit: setup.baseCommit,
      profile,
    });
    const summary = createLifecycleSummary({
      provider: profile,
      model: checked.model,
      duration_ms: Date.now() - startedAt,
      skipped: false,
      success: true,
      verification: checked.verification,
    });
    saveSummary(artifactRoot, summary);
    logger.log(`[built:smoke-pipeline] ok: ${profile} 전체 lifecycle 검증 완료`);
    logger.log(`[built:smoke-pipeline] artifact: ${artifactDisplayPath(summary)}`);
    return 0;
  } catch (err) {
    const kind = err instanceof SmokeFailure ? err.kind : 'unknown';
    const safeDetail = sanitizeText(err && err.message ? err.message : '미분류 실패');
    const message = formatFailureSummary(kind, 'full_lifecycle', safeDetail, profile);
    const summary = createLifecycleSummary({
      provider: profile,
      model: model || null,
      duration_ms: Date.now() - startedAt,
      skipped: false,
      success: false,
      failure_kind: kind,
      failure_message: message,
      verification: err && err.stage ? { failed_stage: err.stage } : null,
    });
    saveSummary(artifactRoot, summary);
    outputFailureAxis(logger, kind);
    logger.error(message);
    logger.error(`[built:smoke-pipeline] artifact: ${artifactDisplayPath(summary)}`);
    return 1;
  } finally {
    if (projectRoot && env.BUILT_KEEP_SMOKE_DIR !== '1') {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    } else if (projectRoot) {
      logger.log('[built:smoke-pipeline] BUILT_KEEP_SMOKE_DIR=1: disposable target을 유지했습니다.');
    }
  }
}

if (require.main === module) {
  process.exitCode = runSmoke();
}

module.exports = {
  ACCEPTANCE_CRITERIA,
  DEFAULT_PHASE_TIMEOUT_MS,
  FEATURE,
  MODEL_ENV,
  OPT_IN_ENV,
  PROFILE_ENV,
  SmokeFailure,
  buildProfileRunRequest,
  classifyPipelineFailure,
  createLifecycleSummary,
  ensureWithin,
  preflightProvider,
  resolveProfile,
  runSmoke,
  verifyLifecycle,
};
