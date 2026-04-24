#!/usr/bin/env node
/**
 * hooks-runner.js
 *
 * Pipeline hooks 실행 엔진.
 * hooks.json + hooks.local.json을 로드·병합하여 파이프라인 단계별 훅을 실행한다.
 *
 * ## iter 연동 설계
 *
 * iter.js는 check-result.md의 frontmatter status만 읽으므로,
 * 훅 실패 정보를 check-result.md에 주입해야 iter 루프가 인지할 수 있다.
 *
 * before_do 실패 (halt_on_fail: true):
 *   - Do 실행 전에 파이프라인을 중단시킨다.
 *   - check-result.md를 needs_changes로 강제하고 issues[]에 실패 내용 추가.
 *   - iter.js가 check-result.md를 읽어 needs_changes 확인 → iter 루프 진입.
 *   - iter 재실행 프롬프트에 check-result.md가 포함되므로 Claude가 수정 방향을 알 수 있음.
 *
 * after_check 실패 (halt_on_fail: true):
 *   - check-result.md status가 approved여도 훅 실패 시 needs_changes로 강제 변경.
 *   - issues[]에 훅 실패 상세 내용 추가 → iter 루프 트리거.
 *
 * halt_on_fail: false 실패:
 *   - check-result.md issues[]에 경고 수준으로만 기록 (status는 유지).
 *
 * API:
 *   loadHooks(projectRoot)                          -> hooks (병합된 훅 설정)
 *   runHooks(hookPoint, options)                    -> HookRunResult
 *   injectFailuresIntoCheckResult(featureDir, ...)  -> void
 */

'use strict';

const fs           = require('fs');
const path         = require('path');
const childProcess = require('child_process');

const { parse: parseFrontmatter, stringify: stringifyFrontmatter } = require('./frontmatter');

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

const HOOK_POINTS = ['before_do', 'after_do', 'before_check', 'after_check', 'before_report', 'after_report'];
const DEFAULT_TIMEOUT_MS = 30000; // 30초

// ---------------------------------------------------------------------------
// 스키마 검증 (외부 패키지 없음)
// ---------------------------------------------------------------------------

const MODEL_VALUES  = new Set(['opus', 'sonnet', 'haiku']);
const EFFORT_VALUES = new Set(['low', 'medium', 'high']);

function failValidation(hookPath, msg) {
  throw new Error(`hooks config: ${hookPath} — ${msg}`);
}

function validateCommandHook(h, hookPath) {
  if (typeof h.run !== 'string' || h.run.length === 0)
    failValidation(hookPath, "'run' must be non-empty string");
  if ('halt_on_fail' in h && typeof h.halt_on_fail !== 'boolean')
    failValidation(hookPath, "'halt_on_fail' must be boolean");
  if ('condition' in h && typeof h.condition !== 'string')
    failValidation(hookPath, "'condition' must be string");
  if ('timeout' in h && (typeof h.timeout !== 'number' || h.timeout <= 0))
    failValidation(hookPath, "'timeout' must be positive number");
  if ('capture_output' in h && typeof h.capture_output !== 'boolean')
    failValidation(hookPath, "'capture_output' must be boolean");
  if ('expect_exit_code' in h && !Number.isInteger(h.expect_exit_code))
    failValidation(hookPath, "'expect_exit_code' must be integer");
  return {
    type: 'command',
    halt_on_fail: false,
    capture_output: false,
    expect_exit_code: 0,
    ...h,
  };
}

function validateSkillHook(h, hookPath) {
  if (typeof h.skill !== 'string' || h.skill.length === 0)
    failValidation(hookPath, "'skill' must be non-empty string");
  if ('halt_on_fail' in h && typeof h.halt_on_fail !== 'boolean')
    failValidation(hookPath, "'halt_on_fail' must be boolean");
  if ('condition' in h && typeof h.condition !== 'string')
    failValidation(hookPath, "'condition' must be string");
  if ('model' in h && !MODEL_VALUES.has(h.model))
    failValidation(hookPath, `'model' must be one of ${[...MODEL_VALUES]}`);
  if ('effort' in h && !EFFORT_VALUES.has(h.effort))
    failValidation(hookPath, `'effort' must be one of ${[...EFFORT_VALUES]}`);
  return { type: 'skill', halt_on_fail: false, ...h };
}

function validateHook(h, hookPath) {
  if (h === null || typeof h !== 'object') failValidation(hookPath, 'must be object');
  const hasRun   = 'run' in h;
  const hasSkill = 'skill' in h;
  if (hasRun && hasSkill)  failValidation(hookPath, "cannot have both 'run' and 'skill'");
  if (!hasRun && !hasSkill) failValidation(hookPath, "must have either 'run' or 'skill'");
  return hasRun ? validateCommandHook(h, hookPath) : validateSkillHook(h, hookPath);
}

// ---------------------------------------------------------------------------
// 훅 로드 및 병합
// ---------------------------------------------------------------------------

/**
 * hooks.json과 hooks.local.json을 로드하여 병합한 훅 맵을 반환한다.
 *
 * 병합 규칙:
 * - local은 team에 추가만 (덮어쓰지 않음)
 * - 같은 hookpoint 배열은 concat (team 먼저, local 뒤)
 * - 각 hook에 source: 'team' | 'local' 메타데이터 추가
 *
 * @param {string} projectRoot   프로젝트 루트 경로
 * @returns {Record<string, import('.').Hook[]>}  hookPoint → 훅 배열
 */
function loadHooks(projectRoot) {
  const builtDir         = path.join(projectRoot, '.built');
  const teamHooksPath    = path.join(builtDir, 'hooks.json');
  const localHooksPath   = path.join(builtDir, 'hooks.local.json');

  const merged = /** @type {Record<string, any[]>} */ {};
  for (const point of HOOK_POINTS) merged[point] = [];

  function loadFile(filePath, source) {
    if (!fs.existsSync(filePath)) return;

    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      throw new Error(`hooks: ${filePath} 읽기 실패 — ${e.message}`);
    }

    let config;
    try {
      config = JSON.parse(raw);
    } catch (e) {
      throw new Error(`hooks: ${filePath} JSON 파싱 실패 — ${e.message}`);
    }

    const pipeline = config && config.pipeline;
    if (!pipeline || typeof pipeline !== 'object') return;

    for (const point of HOOK_POINTS) {
      const arr = pipeline[point];
      if (!Array.isArray(arr)) continue;

      arr.forEach((h, idx) => {
        const hookPath = `${filePath}#pipeline.${point}[${idx}]`;
        const validated = validateHook(h, hookPath);
        merged[point].push({ ...validated, source });
      });
    }
  }

  loadFile(teamHooksPath,  'team');
  loadFile(localHooksPath, 'local');

  return merged;
}

// ---------------------------------------------------------------------------
// condition 평가
// ---------------------------------------------------------------------------

/**
 * 간단한 condition 표현식을 평가한다.
 *
 * 지원 형식:
 *   "feature.touches_auth == true"
 *   "check.status == 'approved'"
 *   "check.status == 'needs_changes'"
 *
 * @param {string} condStr     조건 표현식 문자열
 * @param {object} ctx         평가 컨텍스트 { feature: {…}, check: {…} }
 * @returns {boolean}
 */
function evaluateCondition(condStr, ctx) {
  if (!condStr || typeof condStr !== 'string') return true;

  const trimmed = condStr.trim();

  // "path.to.key == value" 패턴
  const eqMatch = trimmed.match(/^([a-zA-Z_][\w.]*)\s*==\s*(.+)$/);
  if (eqMatch) {
    const lhsPath = eqMatch[1].split('.');
    const rhsRaw  = eqMatch[2].trim();

    let lhsVal = ctx;
    for (const key of lhsPath) {
      if (lhsVal == null || typeof lhsVal !== 'object') { lhsVal = undefined; break; }
      lhsVal = lhsVal[key];
    }

    let rhsVal;
    if (rhsRaw === 'true')  rhsVal = true;
    else if (rhsRaw === 'false') rhsVal = false;
    else if (rhsRaw === 'null')  rhsVal = null;
    else if (!isNaN(rhsRaw) && rhsRaw !== '') rhsVal = Number(rhsRaw);
    else if ((rhsRaw.startsWith("'") && rhsRaw.endsWith("'")) ||
             (rhsRaw.startsWith('"') && rhsRaw.endsWith('"'))) {
      rhsVal = rhsRaw.slice(1, -1);
    } else {
      rhsVal = rhsRaw;
    }

    return lhsVal === rhsVal;
  }

  // 지원하지 않는 표현식은 true (실행 허용)
  console.warn(`[hooks-runner] 지원하지 않는 condition 표현식, 기본 true 처리: "${condStr}"`);
  return true;
}

// ---------------------------------------------------------------------------
// check-result.md 업데이트 헬퍼
// ---------------------------------------------------------------------------

/**
 * check-result.md에 훅 실패 정보를 주입한다.
 *
 * halt_on_fail: true 실패:
 *   - status를 needs_changes로 강제 (forceNeedsChanges: true 시)
 *   - issues[]에 실패 내용 추가
 *
 * halt_on_fail: false 실패:
 *   - issues[]에 경고 접두어로 추가 (status 유지)
 *
 * @param {string} featureDir        .built/features/<feature> 경로
 * @param {Array<{label: string, message: string, isHalt: boolean}>} failures
 * @param {boolean} forceNeedsChanges  true이면 status를 needs_changes로 강제
 */
function injectFailuresIntoCheckResult(featureDir, failures, forceNeedsChanges) {
  if (!failures || failures.length === 0) return;

  const checkResultPath = path.join(featureDir, 'check-result.md');

  // check-result.md가 없으면 새로 생성
  if (!fs.existsSync(checkResultPath)) {
    const haltFailures = failures.filter(f => f.isHalt);
    const warnFailures = failures.filter(f => !f.isHalt);

    const issueLines = [
      ...haltFailures.map(f => `[hook-failure] ${f.label}: ${f.message}`),
      ...warnFailures.map(f => `[hook-warning] ${f.label}: ${f.message}`),
    ];

    const status = forceNeedsChanges ? 'needs_changes' : 'approved';
    const fm = `---\nstatus: ${status}\nissues: ${JSON.stringify(issueLines)}\n---\n`;
    const content = haltFailures.length > 0
      ? `\n## Hook 실패 내역\n\n${haltFailures.map(f => `- **${f.label}**: ${f.message}`).join('\n')}\n`
      : '';

    fs.writeFileSync(checkResultPath, fm + content, 'utf8');
    return;
  }

  // 기존 파일 파싱
  const raw = fs.readFileSync(checkResultPath, 'utf8');
  let parsed;
  try {
    parsed = parseFrontmatter(raw);
  } catch (_) {
    parsed = { data: {}, content: raw };
  }

  const { data, content } = parsed;

  // status 갱신
  if (forceNeedsChanges) {
    data.status = 'needs_changes';
  }

  // issues[] 갱신
  const existingIssues = Array.isArray(data.issues) ? data.issues : [];

  const haltFailures = failures.filter(f => f.isHalt);
  const warnFailures = failures.filter(f => !f.isHalt);

  const newIssues = [
    ...existingIssues,
    ...haltFailures.map(f => `[hook-failure] ${f.label}: ${f.message}`),
    ...warnFailures.map(f => `[hook-warning] ${f.label}: ${f.message}`),
  ];

  data.issues = newIssues;

  // hook 실패 상세 내용을 본문에도 추가 (iter 재실행 프롬프트에 포함되도록)
  const hookSection = haltFailures.length > 0
    ? `\n## Hook 실패 내역 (iter 재실행 전 수정 필요)\n\n` +
      haltFailures.map(f => `### ${f.label}\n\`\`\`\n${f.message}\n\`\`\``).join('\n\n') + '\n'
    : '';

  const updatedContent = hookSection
    ? (content.trim() ? content.trimEnd() + '\n' + hookSection : hookSection)
    : content;

  const output = stringifyFrontmatter(data, updatedContent);
  fs.writeFileSync(checkResultPath, output, 'utf8');
}

// ---------------------------------------------------------------------------
// command hook 실행
// ---------------------------------------------------------------------------

/**
 * command 타입 훅을 실행한다.
 *
 * @param {object} hook     검증된 훅 객체
 * @param {object} env      환경변수 맵
 * @param {object} options  { projectRoot, timeout }
 * @returns {{ success: boolean, output: string | null, error: string | null }}
 */
function executeCommandHook(hook, env, options) {
  const timeout     = hook.timeout || options.timeout || DEFAULT_TIMEOUT_MS;
  const expectCode  = hook.expect_exit_code || 0;

  try {
    const output = childProcess.execSync(hook.run, {
      env,
      cwd:      options.projectRoot,
      timeout,
      stdio:    hook.capture_output ? 'pipe' : 'inherit',
      encoding: 'utf8',
    });

    return {
      success: true,
      output:  hook.capture_output ? (output || '') : null,
      error:   null,
    };
  } catch (e) {
    // timeout, non-zero exit, etc.
    const exitCode = e.status !== undefined ? e.status : null;

    if (!hook.capture_output && exitCode !== null && exitCode !== expectCode) {
      // stderr는 이미 inherit로 출력됨
    }

    const errMsg = e.message || String(e);
    const outputSnippet = e.stdout
      ? e.stdout.slice(0, 500)
      : (e.stderr ? e.stderr.slice(0, 500) : '');

    return {
      success: false,
      output:  hook.capture_output ? outputSnippet : null,
      error:   outputSnippet || errMsg,
    };
  }
}

// ---------------------------------------------------------------------------
// skill hook 실행
// ---------------------------------------------------------------------------

/**
 * skill 타입 훅을 실행한다. `claude -p --skill <name>` 으로 호출.
 *
 * @param {object} hook     검증된 훅 객체
 * @param {object} env      환경변수 맵
 * @param {object} options  { projectRoot, timeout }
 * @returns {{ success: boolean, output: string | null, error: string | null }}
 */
function executeSkillHook(hook, env, options) {
  const timeout = hook.timeout || options.timeout || DEFAULT_TIMEOUT_MS;

  const skillArgs = ['claude', '-p', '--skill', hook.skill];
  if (hook.model) skillArgs.push('--model', hook.model);

  const cmd = skillArgs.join(' ');

  try {
    const output = childProcess.execSync(cmd, {
      env,
      cwd:      options.projectRoot,
      timeout,
      stdio:    'pipe',
      encoding: 'utf8',
    });

    return { success: true, output: output || null, error: null };
  } catch (e) {
    const errMsg = e.stderr
      ? e.stderr.slice(0, 500)
      : (e.message || String(e));

    return { success: false, output: null, error: errMsg };
  }
}

// ---------------------------------------------------------------------------
// 단일 훅 실행
// ---------------------------------------------------------------------------

/**
 * 단일 훅을 실행하고 결과를 반환한다.
 *
 * @param {object} hook       검증된 훅 (type 포함)
 * @param {object} env        환경변수 맵
 * @param {object} options    { projectRoot, timeout }
 * @returns {{ success: boolean, output: string | null, error: string | null }}
 */
function executeHook(hook, env, options) {
  if (hook.type === 'command') {
    return executeCommandHook(hook, env, options);
  }
  if (hook.type === 'skill') {
    return executeSkillHook(hook, env, options);
  }
  return { success: false, output: null, error: `알 수 없는 훅 타입: ${hook.type}` };
}

// ---------------------------------------------------------------------------
// runHooks — 메인 진입점
// ---------------------------------------------------------------------------

/**
 * 지정된 hookPoint의 모든 훅을 순서대로 실행한다.
 *
 * iter 연동:
 * - halt_on_fail: true 실패 → failures[]에 isHalt: true로 추가
 *   - before_do / after_check: 호출자가 injectFailuresIntoCheckResult를 사용해 iter 인지시킴
 * - halt_on_fail: false 실패 → failures[]에 isHalt: false로 추가
 *   - 호출자가 check-result.md에 경고로만 기록
 *
 * @param {string} hookPoint  'before_do' | 'after_do' | 'after_check' | 'after_report'
 * @param {object} options
 *   @param {string} options.projectRoot       프로젝트 루트
 *   @param {string} options.feature           feature 이름
 *   @param {string} options.featureDir        .built/features/<feature> 경로
 *   @param {string} options.runDir            .built/runtime/runs/<feature> 경로
 *   @param {string} [options.worktree]        execution worktree 절대 경로 (선택)
 *   @param {string} [options.previousResultPath]  BUILT_PREVIOUS_RESULT에 주입할 경로 (선택)
 *   @param {object} [options.conditionContext]    condition 평가용 컨텍스트 (선택)
 *     @param {object} [options.conditionContext.feature]  feature 메타데이터 (touches_auth 등)
 *     @param {object} [options.conditionContext.check]    check 결과 (status 등)
 *   @param {Record<string, any[]>} [options.hooks]  미리 로드된 훅 맵 (없으면 자동 로드)
 *
 * @returns {{
 *   halted: boolean,
 *   failures: Array<{hook: object, label: string, message: string, isHalt: boolean}>,
 *   capturedOutputs: Array<{hook: object, output: string}>
 * }}
 */
function runHooks(hookPoint, options) {
  const {
    projectRoot,
    feature,
    featureDir,
    runDir,
    worktree         = '',
    previousResultPath = '',
    conditionContext = {},
  } = options;

  // 훅 로드 (없으면 자동)
  let allHooks = options.hooks;
  if (!allHooks) {
    try {
      allHooks = loadHooks(projectRoot);
    } catch (e) {
      console.error(`[hooks-runner] 훅 로드 실패: ${e.message}`);
      return { halted: false, failures: [], capturedOutputs: [] };
    }
  }

  const hooksForPoint = allHooks[hookPoint] || [];

  if (hooksForPoint.length === 0) {
    return { halted: false, failures: [], capturedOutputs: [] };
  }

  console.log(`[hooks-runner] ${hookPoint}: ${hooksForPoint.length}개 훅 실행`);

  // 환경변수 구성
  const env = Object.assign({}, process.env, {
    BUILT_HOOK_POINT:       hookPoint,
    BUILT_FEATURE:          feature,
    BUILT_PREVIOUS_RESULT:  previousResultPath || '',
    BUILT_WORKTREE:         worktree || '',
    BUILT_PROJECT_ROOT:     projectRoot,
  });

  const failures        = [];
  const capturedOutputs = [];
  let   halted          = false;

  let previousOutput = null; // capture_output 체인

  for (let i = 0; i < hooksForPoint.length; i++) {
    const hook = hooksForPoint[i];

    // 이전 훅 출력 환경변수로 전달
    if (previousOutput !== null) {
      env.BUILT_PREVIOUS_HOOK_OUTPUT = previousOutput;
    }

    // condition 평가
    if (hook.condition) {
      const shouldRun = evaluateCondition(hook.condition, conditionContext);
      if (!shouldRun) {
        const label = hook.type === 'command' ? hook.run : hook.skill;
        console.log(`[hooks-runner] ${hookPoint}[${i}] 건너뜀 (condition false): ${label}`);
        continue;
      }
    }

    const label = hook.type === 'command'
      ? hook.run.slice(0, 80)
      : `skill:${hook.skill}`;

    console.log(`[hooks-runner] ${hookPoint}[${i}] 실행 (${hook.source}): ${label}`);

    const execOptions = {
      projectRoot,
      timeout: hook.timeout || DEFAULT_TIMEOUT_MS,
    };

    const result = executeHook(hook, env, execOptions);

    if (result.output !== null) {
      previousOutput = result.output;
      capturedOutputs.push({ hook, output: result.output });
    }

    if (!result.success) {
      const isHalt = hook.halt_on_fail === true;
      const errMsg = result.error || '훅 실행 실패';

      console.error(`[hooks-runner] ${hookPoint}[${i}] 실패 (halt_on_fail: ${isHalt}): ${label}`);
      console.error(`  오류: ${errMsg.slice(0, 300)}`);

      failures.push({ hook, label, message: errMsg, isHalt });

      if (isHalt) {
        halted = true;
        // halt_on_fail: true → 이후 훅은 실행하지 않음
        break;
      }
      // halt_on_fail: false → 계속 실행
    }
  }

  return { halted, failures, capturedOutputs };
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = {
  loadHooks,
  evaluateCondition,
  runHooks,
  injectFailuresIntoCheckResult,
};
