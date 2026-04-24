/**
 * test/e2e/helpers.js
 *
 * E2E 테스트 공통 헬퍼.
 * - 임시 프로젝트 디렉토리 생성/정리
 * - .built/ 구조 초기화
 * - feature spec 생성
 * - 패치된 run.js 생성 (scripts/*.js를 fake로 교체)
 * - 패치된 run.js 실행
 * - 결과 파일 읽기
 *
 * 외부 npm 패키지 없음 (Node.js 내장 fs/os/path/child_process만 사용).
 */

'use strict';

const assert       = require('assert');
const fs           = require('fs');
const os           = require('os');
const path         = require('path');
const childProcess = require('child_process');

// ---------------------------------------------------------------------------
// 프로젝트 루트 (built 레포)
// ---------------------------------------------------------------------------

const BUILT_ROOT = path.join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// 임시 디렉토리 관리
// ---------------------------------------------------------------------------

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), (prefix || 'e2e') + '-'));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 프로젝트 픽스처 설정
// ---------------------------------------------------------------------------

/**
 * 최소 .built/ 구조를 초기화한다.
 * scripts/init.js의 init()을 직접 호출하는 대신 파일만 생성해
 * 테스트 의존성을 최소화한다.
 *
 * @param {string} projectRoot
 */
function initProject(projectRoot) {
  const dirs = [
    path.join(projectRoot, '.built', 'features'),
    path.join(projectRoot, '.built', 'runtime', 'runs'),
    path.join(projectRoot, '.built', 'runtime', 'locks'),
  ];
  for (const d of dirs) fs.mkdirSync(d, { recursive: true });

  // config.json (최소)
  fs.writeFileSync(
    path.join(projectRoot, '.built', 'config.json'),
    JSON.stringify({ version: 1, max_parallel: 1, default_model: 'claude-opus-4-5' }, null, 2) + '\n',
    'utf8'
  );

  // hooks.json (빈 훅)
  fs.writeFileSync(
    path.join(projectRoot, '.built', 'hooks.json'),
    JSON.stringify({ pipeline: {} }, null, 2) + '\n',
    'utf8'
  );
}

/**
 * feature spec 파일(.md)을 생성한다.
 *
 * @param {string} projectRoot
 * @param {string} feature
 * @param {string} [content]
 */
function createFeatureSpec(projectRoot, feature, content) {
  const featuresDir = path.join(projectRoot, '.built', 'features');
  fs.mkdirSync(featuresDir, { recursive: true });
  fs.writeFileSync(
    path.join(featuresDir, `${feature}.md`),
    content || `# Feature: ${feature}\n\n테스트용 최소 feature spec.\n`,
    'utf8'
  );
}

/**
 * feature 출력 디렉토리에 파일을 쓴다.
 *
 * @param {string} projectRoot
 * @param {string} feature
 * @param {string} filename
 * @param {string} content
 */
function writeFeatureFile(projectRoot, feature, filename, content) {
  const featureDir = path.join(projectRoot, '.built', 'features', feature);
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(path.join(featureDir, filename), content, 'utf8');
}

/**
 * check-result.md를 생성한다.
 *
 * @param {string} projectRoot
 * @param {string} feature
 * @param {'approved'|'needs_changes'} status
 * @param {string[]} [issues]
 */
function writeCheckResult(projectRoot, feature, status, issues) {
  const issueLines = (issues || []).map((i) => `- ${i}`).join('\n');
  const content = [
    '---',
    `feature: ${feature}`,
    `status: ${status}`,
    `checked_at: ${new Date().toISOString()}`,
    '---',
    '',
    '## 검토 결과',
    '',
    status === 'approved' ? '모든 항목 통과' : '수정이 필요합니다',
    '',
    ...(issues && issues.length > 0 ? ['## 수정 필요 항목', '', issueLines, ''] : []),
  ].join('\n');
  writeFeatureFile(projectRoot, feature, 'check-result.md', content);
}

// ---------------------------------------------------------------------------
// state.json 읽기
// ---------------------------------------------------------------------------

function readState(projectRoot, feature) {
  const statePath = path.join(projectRoot, '.built', 'runtime', 'runs', feature, 'state.json');
  if (!fs.existsSync(statePath)) return null;
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

// ---------------------------------------------------------------------------
// 패치된 run.js 생성 (fake scripts 경로 주입)
// ---------------------------------------------------------------------------

/**
 * 임시 디렉토리에 fake 스크립트와 패치된 run.js를 생성한다.
 *
 * fake 스크립트는 각각 지정된 exit code로 종료하며,
 * successFiles에 명시된 파일을 feature 디렉토리에 생성한다.
 *
 * @param {string} baseDir  임시 프로젝트 디렉토리
 * @param {object} scriptDefs  각 스크립트 정의:
 *   { scriptName: { exitCode, outputFiles: [{name, content}] } }
 * @returns {{ fakeScriptsDir: string, fakeRunPath: string, callLogPath: string }}
 */
function setupFakeScripts(baseDir, scriptDefs) {
  const fakeScriptsDir = path.join(baseDir, '_fake_scripts');
  fs.mkdirSync(fakeScriptsDir, { recursive: true });

  const callLogPath = path.join(baseDir, '_call.log');
  const featureDir  = JSON.stringify(path.join(baseDir, '.built', 'features'));

  for (const [name, def] of Object.entries(scriptDefs)) {
    const exitCode    = typeof def.exitCode === 'number' ? def.exitCode : 0;
    const outputFiles = def.outputFiles || [];

    // 각 fake 스크립트: 호출 로그 → 출력 파일 생성 → exit
    const lines = [
      '#!/usr/bin/env node',
      "'use strict';",
      "const fs   = require('fs');",
      "const path = require('path');",
      `const feature = process.argv[2] || '';`,
      `const callLog = ${JSON.stringify(callLogPath)};`,
      `try { fs.appendFileSync(callLog, ${JSON.stringify(name)} + '\\n'); } catch(_) {}`,
      `const featureDir = path.join(${featureDir}, feature);`,
      `fs.mkdirSync(featureDir, { recursive: true });`,
    ];

    for (const { fileName, content } of outputFiles) {
      lines.push(
        `fs.writeFileSync(path.join(featureDir, ${JSON.stringify(fileName)}), ${JSON.stringify(content)}, 'utf8');`
      );
    }

    lines.push(`process.exit(${exitCode});`);
    fs.writeFileSync(path.join(fakeScriptsDir, `${name}.js`), lines.join('\n'), 'utf8');
  }

  // run.js를 복사해 두 경로를 교체:
  //   1. src/state require → 절대경로
  //   2. runScript() 내 scriptPath → fakeScriptsDir
  const realRunPath = path.join(BUILT_ROOT, 'scripts', 'run.js');
  const realSrcDir  = path.join(BUILT_ROOT, 'src');
  let src = fs.readFileSync(realRunPath, 'utf8');

  // require(path.join(__dirname, '..', 'src', 'X')) → require('/abs/src/X')
  src = src.replace(
    /require\(path\.join\(__dirname,\s*'\.\.', 'src', '([^']+)'\)\)/g,
    (_, mod) => `require(${JSON.stringify(path.join(realSrcDir, mod))})`
  );

  // runScript 내 scriptPath 주입
  src = src.replace(
    /const scriptPath = path\.join\(__dirname, scriptName\);/,
    `const scriptPath = path.join(${JSON.stringify(fakeScriptsDir)}, scriptName);`
  );

  const fakeRunPath = path.join(baseDir, '_run_patched.js');
  fs.writeFileSync(fakeRunPath, src, 'utf8');

  return { fakeScriptsDir, fakeRunPath, callLogPath };
}

// ---------------------------------------------------------------------------
// 패치된 run.js 실행
// ---------------------------------------------------------------------------

/**
 * 패치된 run.js를 서브프로세스로 실행한다.
 *
 * @param {string} feature
 * @param {string} projectRoot
 * @param {string} fakeRunPath
 * @param {object} [extraEnv]
 * @returns {{ exitCode: number, stdout: string, stderr: string }}
 */
function runPatchedRun(feature, projectRoot, fakeRunPath, extraEnv) {
  const result = childProcess.spawnSync(
    process.execPath,
    [fakeRunPath, feature, '--_forked'],  // _BUILT_RUN_FORKED 없이 포그라운드로 실행
    {
      cwd: projectRoot,
      env: Object.assign({}, process.env, {
        NO_NOTIFY:       '1',
        _BUILT_RUN_FORKED: '1',  // 백그라운드 재진입 방지
      }, extraEnv || {}),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20000,
    }
  );

  return {
    exitCode: result.status === null ? 1 : result.status,
    stdout:   (result.stdout || Buffer.alloc(0)).toString(),
    stderr:   (result.stderr  || Buffer.alloc(0)).toString(),
  };
}

// ---------------------------------------------------------------------------
// 호출 로그 읽기
// ---------------------------------------------------------------------------

function readCallLog(callLogPath) {
  if (!fs.existsSync(callLogPath)) return [];
  return fs.readFileSync(callLogPath, 'utf8').trim().split('\n').filter(Boolean);
}

// ---------------------------------------------------------------------------
// assert 헬퍼
// ---------------------------------------------------------------------------

function assertFileExists(filePath, msg) {
  assert.ok(fs.existsSync(filePath), msg || `파일이 존재해야 함: ${filePath}`);
}

function assertFileContains(filePath, substring, msg) {
  assertFileExists(filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(
    content.includes(substring),
    msg || `파일에 "${substring}" 포함 필요: ${filePath}\n내용: ${content.slice(0, 200)}`
  );
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

module.exports = {
  BUILT_ROOT,
  makeTmpDir,
  rmDir,
  initProject,
  createFeatureSpec,
  writeFeatureFile,
  writeCheckResult,
  readState,
  setupFakeScripts,
  runPatchedRun,
  readCallLog,
  assertFileExists,
  assertFileContains,
};
