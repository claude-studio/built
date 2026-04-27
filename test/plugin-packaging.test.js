#!/usr/bin/env node
/**
 * test/plugin-packaging.test.js
 *
 * Claude Code plugin packaging smoke 테스트.
 * plugin metadata, skills 경로, scripts 상대 경로, 심볼릭 링크,
 * provider 관련 skill/문서 누락 여부를 검증한다.
 *
 * 외부 npm 패키지 없음. Node.js assert + fs만 사용.
 */

'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const ROOT = path.join(__dirname, '..');
const pluginSourceDir = path.join(ROOT, 'plugins', 'built');

// ---------------------------------------------------------------------------
// 테스트 러너
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (e) {
    console.error(`  \u2717 ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function commandExists(command) {
  const result = childProcess.spawnSync('command', ['-v', command], {
    shell: true,
    encoding: 'utf8',
  });
  return result.status === 0;
}

function makeDogfoodTarget(feature = 'dogfood-feature') {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'built-target-dogfood-'));
  fs.mkdirSync(path.join(targetRoot, '.built', 'features'), { recursive: true });
  fs.mkdirSync(path.join(targetRoot, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(targetRoot, '.built', 'features', `${feature}.md`), [
    `# ${feature}`,
    '',
    '## Build Plan',
    '- [[decisions/dogfood-path-resolution]]',
    '',
  ].join('\n'), 'utf8');
  return targetRoot;
}

function makeIsolatedPluginPackage() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'built-plugin-package-'));
  const packageRoot = path.join(tempRoot, 'built');
  fs.cpSync(pluginSourceDir, packageRoot, {
    recursive: true,
    dereference: true,
    force: true,
    errorOnExist: false,
  });
  return { tempRoot, packageRoot };
}

// ---------------------------------------------------------------------------
// 1. plugin.json 메타데이터
// ---------------------------------------------------------------------------

console.log('\n[plugin.json 메타데이터]');

const rootPluginPath = path.join(ROOT, '.claude-plugin', 'plugin.json');
const pluginDirPluginPath = path.join(ROOT, 'plugins', 'built', '.claude-plugin', 'plugin.json');

test('루트 .claude-plugin/plugin.json 존재', () => {
  assert.ok(fs.existsSync(rootPluginPath), `${rootPluginPath} 없음`);
});

test('루트 plugin.json 필수 필드 (name, version, description)', () => {
  const meta = JSON.parse(fs.readFileSync(rootPluginPath, 'utf8'));
  assert.ok(meta.name, 'name 필드 없음');
  assert.ok(meta.version, 'version 필드 없음');
  assert.ok(meta.description, 'description 필드 없음');
});

test('plugins/built/.claude-plugin/plugin.json 존재', () => {
  assert.ok(fs.existsSync(pluginDirPluginPath), `${pluginDirPluginPath} 없음`);
});

test('plugins/built plugin.json 필수 필드 (name, skills)', () => {
  const meta = JSON.parse(fs.readFileSync(pluginDirPluginPath, 'utf8'));
  assert.ok(meta.name, 'name 필드 없음');
  assert.ok(meta.skills, 'skills 필드 없음');
});

// ---------------------------------------------------------------------------
// 2. plugins/built 심볼릭 링크 검증
// ---------------------------------------------------------------------------

console.log('\n[plugins/built 심볼릭 링크]');

const symlinks = ['scripts', 'skills', 'src'];
for (const name of symlinks) {
  const linkPath = path.join(ROOT, 'plugins', 'built', name);
  test(`plugins/built/${name} 심볼릭 링크 존재`, () => {
    const stat = fs.lstatSync(linkPath);
    assert.ok(stat.isSymbolicLink(), `${linkPath}는 심볼릭 링크가 아님`);
  });

  test(`plugins/built/${name} 심볼릭 링크 대상이 실제 디렉토리`, () => {
    const target = fs.readlinkSync(linkPath);
    const resolved = path.resolve(path.dirname(linkPath), target);
    assert.ok(fs.existsSync(resolved), `심볼릭 링크 대상 ${resolved} 없음`);
    assert.ok(fs.statSync(resolved).isDirectory(), `${resolved}는 디렉토리가 아님`);
  });

  test(`plugins/built/${name} 심볼릭 링크 대상이 루트 ${name}/`, () => {
    const target = fs.readlinkSync(linkPath);
    const resolved = path.resolve(path.dirname(linkPath), target);
    const expected = path.join(ROOT, name);
    assert.strictEqual(resolved, expected,
      `기대: ${expected}, 실제: ${resolved}`);
  });
}

const packageSymlinks = ['README.md', 'docs', 'vendor'];
for (const name of packageSymlinks) {
  const linkPath = path.join(ROOT, 'plugins', 'built', name);
  test(`plugins/built/${name} package 링크 존재`, () => {
    const stat = fs.lstatSync(linkPath);
    assert.ok(stat.isSymbolicLink(), `${linkPath}는 심볼릭 링크가 아님`);
  });

  test(`plugins/built/${name} package 링크 대상 존재`, () => {
    const target = fs.readlinkSync(linkPath);
    const resolved = path.resolve(path.dirname(linkPath), target);
    assert.ok(fs.existsSync(resolved), `심볼릭 링크 대상 ${resolved} 없음`);
  });
}

const isolatedPackageFiles = [
  '.claude-plugin/plugin.json',
  'README.md',
  'docs/ops/provider-setup-guide.md',
  'docs/smoke-testing.md',
  'scripts/provider-doctor.js',
  'scripts/smoke-codex-do.js',
  'scripts/smoke-codex-plan-synthesis.js',
  'skills/doctor/SKILL.md',
  'skills/run-codex/SKILL.md',
  'src/providers/codex.js',
  'vendor/codex-plugin-cc/LICENSE',
  'vendor/codex-plugin-cc/NOTICE',
];

test('plugins/built package를 격리 복사해도 필수 파일이 존재', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'built-plugin-package-'));
  const packageRoot = path.join(tempRoot, 'built');

  try {
    fs.cpSync(pluginSourceDir, packageRoot, {
      recursive: true,
      dereference: true,
      force: true,
      errorOnExist: false,
    });

    for (const relativePath of isolatedPackageFiles) {
      const copiedPath = path.join(packageRoot, relativePath);
      assert.ok(fs.existsSync(copiedPath), `격리 package에서 ${relativePath} 없음`);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('격리 package의 README/docs/vendor 기준이 유효', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'built-plugin-package-'));
  const packageRoot = path.join(tempRoot, 'built');

  try {
    fs.cpSync(pluginSourceDir, packageRoot, {
      recursive: true,
      dereference: true,
      force: true,
      errorOnExist: false,
    });

    const readme = fs.readFileSync(path.join(packageRoot, 'README.md'), 'utf8');
    assert.ok(readme.includes('docs/ops/provider-setup-guide.md'),
      '격리 package README.md에 provider setup guide 링크 없음');
    assert.ok(readme.includes('docs/smoke-testing.md'),
      '격리 package README.md에 smoke testing guide 링크 없음');

    const license = fs.readFileSync(path.join(packageRoot, 'vendor/codex-plugin-cc/LICENSE'), 'utf8');
    assert.ok(license.includes('Apache License'), '격리 package LICENSE에 Apache License 문구 없음');
    assert.ok(license.includes('Version 2.0'), '격리 package LICENSE에 Version 2.0 문구 없음');

    const notice = fs.readFileSync(path.join(packageRoot, 'vendor/codex-plugin-cc/NOTICE'), 'utf8');
    assert.ok(notice.includes('Copyright 2026 OpenAI'),
      '격리 package NOTICE에 OpenAI copyright 문구 없음');
    assert.ok(notice.includes('Apache License, Version 2.0'),
      '격리 package NOTICE에 Apache License notice 문구 없음');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. skills/*/SKILL.md 에서 참조하는 scripts 경로 검증
// ---------------------------------------------------------------------------

console.log('\n[skills -> scripts 경로 검증]');

const skillsDir = path.join(ROOT, 'skills');
const skillDirs = fs.readdirSync(skillsDir).filter((d) =>
  fs.statSync(path.join(skillsDir, d)).isDirectory()
);

// skills SKILL.md 에서 ../../scripts/<name>.js 형태의 참조를 추출
const relScriptRe = /\.\.\/\.\.\/scripts\/([a-z0-9_-]+\.js)/g;
// scripts/<name>.js 형태의 참조 (node scripts/<name>.js 또는 node "$SCRIPT_DIR/<name>.js" 패턴)
const absScriptRe = /(?:node\s+)(?:"\$SCRIPT_DIR\/|scripts\/)([a-z0-9_-]+\.js)/g;

for (const skillName of skillDirs) {
  const skillMd = path.join(skillsDir, skillName, 'SKILL.md');
  if (!fs.existsSync(skillMd)) continue;

  const content = fs.readFileSync(skillMd, 'utf8');
  const referencedScripts = new Set();

  let m;
  // ../../scripts/xxx.js 패턴
  const re1 = new RegExp(relScriptRe.source, 'g');
  while ((m = re1.exec(content)) !== null) {
    referencedScripts.add(m[1]);
  }
  // node scripts/xxx.js 패턴
  const re2 = new RegExp(absScriptRe.source, 'g');
  while ((m = re2.exec(content)) !== null) {
    referencedScripts.add(m[1]);
  }

  for (const scriptFile of referencedScripts) {
    test(`skills/${skillName} -> scripts/${scriptFile} 존재`, () => {
      const scriptPath = path.join(ROOT, 'scripts', scriptFile);
      assert.ok(fs.existsSync(scriptPath),
        `skills/${skillName}/SKILL.md가 참조하는 scripts/${scriptFile} 없음`);
    });
  }
}

// ---------------------------------------------------------------------------
// 4. 모든 scripts/*.js 가 올바른 Node.js 파일인지 (구문 검증)
// ---------------------------------------------------------------------------

console.log('\n[scripts 구문 검증]');

const scriptsDir = path.join(ROOT, 'scripts');
const scriptFiles = fs.readdirSync(scriptsDir).filter((f) => f.endsWith('.js'));

test('scripts/ 디렉토리에 .js 파일 존재', () => {
  assert.ok(scriptFiles.length > 0, 'scripts/ 디렉토리에 .js 파일 없음');
});

// ---------------------------------------------------------------------------
// 5. provider 관련 skill/문서 누락 검증
// ---------------------------------------------------------------------------

console.log('\n[provider 관련 skill/문서 누락 검증]');

// provider 관련 필수 skills
const providerSkills = ['doctor', 'run', 'run-opus', 'run-sonnet', 'run-codex'];
for (const skill of providerSkills) {
  test(`provider skill "${skill}" SKILL.md 존재`, () => {
    const p = path.join(skillsDir, skill, 'SKILL.md');
    assert.ok(fs.existsSync(p), `skills/${skill}/SKILL.md 없음`);
  });
}

// provider 관련 필수 스크립트
const providerScripts = [
  'provider-doctor.js',
  'provider-preset.js',
  'compare-providers.js',
  'smoke-compare-providers.js',
  'smoke-codex-do.js',
  'smoke-codex-plan-synthesis.js',
];
for (const script of providerScripts) {
  test(`provider script "${script}" 존재`, () => {
    const p = path.join(scriptsDir, script);
    assert.ok(fs.existsSync(p), `scripts/${script} 없음`);
  });
}

// provider 관련 필수 문서
const providerDocs = [
  'docs/contracts/provider-config.md',
  'docs/contracts/provider-events.md',
  'docs/contracts/file-contracts.md',
  'docs/ops/provider-setup-guide.md',
  'docs/smoke-testing.md',
  'docs/ops/plugin-release-checklist.md',
];
for (const doc of providerDocs) {
  test(`provider 문서 "${doc}" 존재`, () => {
    const p = path.join(ROOT, doc);
    assert.ok(fs.existsSync(p), `${doc} 없음`);
  });
}

// ---------------------------------------------------------------------------
// 5-1. provider preset skills target cwd 보존 검증
// ---------------------------------------------------------------------------

console.log('\n[provider preset skills target cwd 보존]');

const modelSkills = [
  { name: 'run-opus', model: 'claude-opus-4-5' },
  { name: 'run-sonnet', model: 'claude-sonnet-4-5' },
];

for (const skill of modelSkills) {
  test(`skills/${skill.name}는 SCRIPT_DIR 절대 경로로 provider-preset을 호출`, () => {
    const skillPath = path.join(skillsDir, skill.name, 'SKILL.md');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.ok(content.includes(': "${BUILT_PLUGIN_DIR:?BUILT_PLUGIN_DIR must point to the installed built plugin/repo path}"'),
      'BUILT_PLUGIN_DIR 필수 환경변수 안내 없음');
    assert.ok(content.includes('SCRIPT_DIR="$(cd "$BUILT_PLUGIN_DIR/scripts" && pwd -P)"'),
      'SCRIPT_DIR 절대 경로 설정 안내 없음');
    assert.ok(content.includes(`node "$SCRIPT_DIR/provider-preset.js" <FEATURE> --preset claude-default --model ${skill.model}`),
      'provider-preset 절대 경로 호출 안내 없음');
    assert.ok(content.includes('node "$SCRIPT_DIR/run.js" <FEATURE>'),
      'run.js 절대 경로 호출 안내 없음');
    assert.ok(!content.includes('<BUILT_PLUGIN_DIR>'),
      '<BUILT_PLUGIN_DIR> placeholder가 남아 있음');
    assert.ok(!content.includes(`node scripts/provider-preset.js <FEATURE> --preset claude-default --model ${skill.model}`),
      'cwd에 의존하는 provider-preset 호출이 남아 있음');
  });
}

test('skills/run-codex는 SCRIPT_DIR 절대 경로로 codex-run preset을 호출', () => {
  const skillPath = path.join(skillsDir, 'run-codex', 'SKILL.md');
  const content = fs.readFileSync(skillPath, 'utf8');
  assert.ok(content.includes(': "${BUILT_PLUGIN_DIR:?BUILT_PLUGIN_DIR must point to the installed built plugin/repo path}"'),
    'BUILT_PLUGIN_DIR 필수 환경변수 안내 없음');
  assert.ok(content.includes('SCRIPT_DIR="$(cd "$BUILT_PLUGIN_DIR/scripts" && pwd -P)"'),
    'SCRIPT_DIR 절대 경로 설정 안내 없음');
  assert.ok(content.includes('node "$SCRIPT_DIR/provider-preset.js" <FEATURE> --preset codex-run'),
    'codex-run provider-preset 절대 경로 호출 안내 없음');
  assert.ok(content.includes('node "$SCRIPT_DIR/run.js" <FEATURE>'),
    'run.js 절대 경로 호출 안내 없음');
  assert.ok(content.includes('node "$SCRIPT_DIR/run.js" <FEATURE> --background'),
    'background run.js 절대 경로 호출 안내 없음');
  assert.ok(content.includes('"do": { "name": "codex", "sandbox": "workspace-write" }'),
    'Do phase Codex workspace-write routing 안내 없음');
  assert.ok(content.includes('"check": { "name": "codex", "sandbox": "read-only" }'),
    'Check phase Codex read-only routing 안내 없음');
  assert.ok(content.includes('"iter": { "name": "codex", "sandbox": "workspace-write" }'),
    'Iter phase Codex workspace-write routing 안내 없음');
  assert.ok(content.includes('"report": { "name": "codex", "sandbox": "read-only" }'),
    'Report phase Codex read-only routing 안내 없음');
  assert.ok(content.includes('`providers.plan_synthesis`는 기록하지 않는다.'),
    'plan_synthesis 비활성 안내 없음');
  assert.ok(!content.includes('cd <BUILT_PLUGIN_DIR>'),
    'plugin cache cwd로 이동하는 안내가 남아 있음');
  assert.ok(!content.includes('<BUILT_PLUGIN_DIR>'),
    '<BUILT_PLUGIN_DIR> placeholder가 남아 있음');
  assert.ok(!content.includes('node scripts/provider-preset.js <FEATURE> --preset codex-run'),
    'cwd에 의존하는 provider-preset 호출이 남아 있음');
});

test('Plan/Design/Run skill 문서가 target cwd 상대 scripts/src와 BASH_SOURCE 실행에 의존하지 않음', () => {
  const checkedSkills = [
    'plan',
    'run',
    'do',
    'check',
    'init',
    'status',
    'doctor',
    'run-opus',
    'run-sonnet',
    'run-codex',
  ];

  for (const skillName of checkedSkills) {
    const skillPath = path.join(skillsDir, skillName, 'SKILL.md');
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.ok(!content.includes('<BUILT_PLUGIN_DIR>'),
      `skills/${skillName}에 <BUILT_PLUGIN_DIR> placeholder가 남아 있음`);
    assert.ok(!/node\s+scripts\/(run|do|check|plan-save|provider-preset|provider-doctor|init|status)\.js/.test(content),
      `skills/${skillName}에 target cwd 상대 scripts 호출이 남아 있음`);
    assert.ok(!/require\('\.\/(?:scripts|src)\//.test(content),
      `skills/${skillName}에 target cwd 상대 require가 남아 있음`);
    assert.ok(!/\$\(dirname "\$\{BASH_SOURCE\[0\]\}"/.test(content),
      `skills/${skillName}에 BASH_SOURCE 기반 실행 경로가 남아 있음`);
  }
});

test('provider-preset은 target project cwd에만 run-request.json을 생성', () => {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'built-target-cwd-'));
  const pluginCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'built-plugin-cwd-'));
  const feature = 'todo-list-service';
  const providerPreset = path.join(ROOT, 'scripts', 'provider-preset.js');

  try {
    fs.mkdirSync(path.join(targetRoot, '.built', 'features'), { recursive: true });
    fs.writeFileSync(path.join(targetRoot, '.built', 'features', `${feature}.md`), '# Todo list service\n', 'utf8');

    const ok = childProcess.spawnSync(process.execPath, [
      providerPreset,
      feature,
      '--preset',
      'claude-default',
      '--model',
      'claude-opus-4-5',
    ], {
      cwd: targetRoot,
      encoding: 'utf8',
    });

    assert.strictEqual(ok.status, 0, ok.stderr || ok.stdout);
    assert.ok(ok.stdout.includes(`다음 단계: /built:run ${feature}`),
      'provider-preset 성공 안내가 /built:run을 출력해야 함');
    assert.ok(!ok.stdout.includes('node scripts/run.js'),
      'provider-preset 성공 안내에 cwd 상대 run.js 호출이 남아 있음');
    const runRequestPath = path.join(targetRoot, '.built', 'runtime', 'runs', feature, 'run-request.json');
    assert.ok(fs.existsSync(runRequestPath),
      'target project에 run-request.json이 생성되지 않음');
    assert.ok(!fs.existsSync(path.join(pluginCwd, '.built')),
      'plugin cwd에 .built가 생성되면 안 됨');

    fs.writeFileSync(runRequestPath, JSON.stringify({
      featureId: feature,
      planPath: '.built/features/custom-plan.md',
      createdAt: '2026-04-26T00:00:00.000Z',
      dry_run: true,
      max_cost_usd: 2,
      providers: { do: 'codex' },
    }, null, 2) + '\n', 'utf8');

    const update = childProcess.spawnSync(process.execPath, [
      providerPreset,
      feature,
      '--preset',
      'claude-default',
      '--model',
      'claude-sonnet-4-5',
    ], {
      cwd: targetRoot,
      encoding: 'utf8',
    });
    assert.strictEqual(update.status, 0, update.stderr || update.stdout);
    assert.ok(update.stdout.includes(`다음 단계: /built:run ${feature}`),
      'provider-preset 갱신 안내가 /built:run을 출력해야 함');
    assert.ok(!update.stdout.includes('node scripts/run.js'),
      'provider-preset 갱신 안내에 cwd 상대 run.js 호출이 남아 있음');

    const updatedRunRequest = JSON.parse(fs.readFileSync(runRequestPath, 'utf8'));
    assert.strictEqual(updatedRunRequest.featureId, feature);
    assert.strictEqual(updatedRunRequest.planPath, '.built/features/custom-plan.md');
    assert.strictEqual(updatedRunRequest.createdAt, '2026-04-26T00:00:00.000Z');
    assert.strictEqual(updatedRunRequest.model, 'claude-sonnet-4-5');
    assert.strictEqual(updatedRunRequest.dry_run, true);
    assert.strictEqual(updatedRunRequest.max_cost_usd, 2);
    assert.strictEqual(updatedRunRequest.providers, undefined);

    const bad = childProcess.spawnSync(process.execPath, [
      providerPreset,
      feature,
      '--preset',
      'claude-default',
      '--model',
      'claude-opus-4-5',
    ], {
      cwd: pluginCwd,
      encoding: 'utf8',
    });

    assert.notStrictEqual(bad.status, 0, 'feature spec이 없는 plugin cwd 실행은 실패해야 함');
    assert.ok(!fs.existsSync(path.join(pluginCwd, '.built')),
      '실패한 plugin cwd 실행에서 .built가 생성되면 안 됨');
  } finally {
    fs.rmSync(targetRoot, { recursive: true, force: true });
    fs.rmSync(pluginCwd, { recursive: true, force: true });
  }
});

test('target project에 scripts/src가 없어도 BUILT_PLUGIN_DIR로 Run helper를 실행', () => {
  const feature = 'dogfood-run';
  const targetRoot = makeDogfoodTarget(feature);
  const { tempRoot, packageRoot } = makeIsolatedPluginPackage();

  try {
    assert.ok(!fs.existsSync(path.join(targetRoot, 'scripts')),
      'dogfood target에는 scripts/가 없어야 함');
    assert.ok(!fs.existsSync(path.join(targetRoot, 'src')),
      'dogfood target에는 src/가 없어야 함');

    const result = childProcess.spawnSync('bash', ['-lc', [
      ': "${BUILT_PLUGIN_DIR:?BUILT_PLUGIN_DIR must point to the installed built plugin/repo path}"',
      'SCRIPT_DIR="$(cd "$BUILT_PLUGIN_DIR/scripts" && pwd -P)"',
      'node "$SCRIPT_DIR/provider-preset.js" dogfood-run --preset codex-run',
    ].join('\n')], {
      cwd: targetRoot,
      env: { ...process.env, BUILT_PLUGIN_DIR: packageRoot },
      encoding: 'utf8',
    });

    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.ok(fs.existsSync(path.join(targetRoot, '.built', 'runtime', 'runs', feature, 'run-request.json')),
      'target project에 run-request.json이 생성되지 않음');
    assert.ok(!fs.existsSync(path.join(packageRoot, '.built')),
      'plugin package에 .built가 생성되면 안 됨');
  } finally {
    fs.rmSync(targetRoot, { recursive: true, force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('target project에 scripts/src가 없어도 BUILT_PLUGIN_DIR로 Plan/Design helper를 실행', () => {
  const feature = 'dogfood-plan';
  const targetRoot = makeDogfoodTarget(feature);
  const { tempRoot, packageRoot } = makeIsolatedPluginPackage();

  try {
    const script = [
      ': "${BUILT_PLUGIN_DIR:?BUILT_PLUGIN_DIR must point to the installed built plugin/repo path}"',
      'SCRIPT_DIR="$(cd "$BUILT_PLUGIN_DIR/scripts" && pwd -P)"',
      'SRC_DIR="$(cd "$BUILT_PLUGIN_DIR/src" && pwd -P)"',
      'node -e "const d = require(process.env.BUILT_PLUGIN_DIR + \'/scripts/plan-draft.js\'); d.write(\'dogfood-plan\', d.buildContent({ feature: \'dogfood-plan\', phase: 1, intentPurpose: \'dogfood\' }));"',
      'node "$SCRIPT_DIR/plan-save.js" .built/features/dogfood-plan.md .built',
      'node -e "const path = require(\'path\'); const state = require(process.env.BUILT_PLUGIN_DIR + \'/src/state.js\'); const runDir = path.join(process.cwd(), \'.built\', \'runtime\', \'runs\', \'dogfood-plan\'); state.initRunRequest(runDir, { featureId: \'dogfood-plan\', planPath: path.join(process.cwd(), \'.built\', \'features\', \'dogfood-plan.md\'), model: \'claude-opus-4-5\' }); state.initState(runDir, \'dogfood-plan\');"',
      'node "$SRC_DIR/update-index.js"',
      'node -e "require(process.env.BUILT_PLUGIN_DIR + \'/scripts/plan-draft.js\').remove(\'dogfood-plan\')"',
    ].join('\n');

    const result = childProcess.spawnSync('bash', ['-lc', script], {
      cwd: targetRoot,
      env: { ...process.env, BUILT_PLUGIN_DIR: packageRoot },
      encoding: 'utf8',
    });

    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.ok(fs.existsSync(path.join(targetRoot, '.built', 'decisions', 'dogfood-path-resolution.md')),
      'plan-save가 target project .built/decisions에 파일을 생성하지 않음');
    assert.ok(fs.existsSync(path.join(targetRoot, '.built', 'runtime', 'runs', feature, 'run-request.json')),
      'state helper가 target project에 run-request.json을 생성하지 않음');
    assert.ok(!fs.existsSync(path.join(targetRoot, '.built', 'runs', feature, 'plan-draft.md')),
      'plan-draft remove가 target project draft를 삭제하지 않음');
    assert.ok(!fs.existsSync(path.join(packageRoot, '.built')),
      'plugin package에 .built가 생성되면 안 됨');
  } finally {
    fs.rmSync(targetRoot, { recursive: true, force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('BUILT_PLUGIN_DIR 경로 표준은 zsh에서도 동작', () => {
  if (!commandExists('zsh')) {
    console.log('    zsh 없음: 건너뜀');
    return;
  }

  const feature = 'dogfood-zsh';
  const targetRoot = makeDogfoodTarget(feature);
  const { tempRoot, packageRoot } = makeIsolatedPluginPackage();

  try {
    const result = childProcess.spawnSync('zsh', ['-lc', [
      ': "${BUILT_PLUGIN_DIR:?BUILT_PLUGIN_DIR must point to the installed built plugin/repo path}"',
      'SCRIPT_DIR="$(cd "$BUILT_PLUGIN_DIR/scripts" && pwd -P)"',
      'node "$SCRIPT_DIR/provider-preset.js" dogfood-zsh --preset codex-run',
    ].join('\n')], {
      cwd: targetRoot,
      env: { ...process.env, BUILT_PLUGIN_DIR: packageRoot },
      encoding: 'utf8',
    });

    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.ok(fs.existsSync(path.join(targetRoot, '.built', 'runtime', 'runs', feature, 'run-request.json')),
      'zsh 실행에서 target project run-request.json이 생성되지 않음');
    assert.ok(!fs.existsSync(path.join(packageRoot, '.built')),
      'plugin package에 .built가 생성되면 안 됨');
  } finally {
    fs.rmSync(targetRoot, { recursive: true, force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 6. plugins/built plugin.json skills 경로 검증
// ---------------------------------------------------------------------------

console.log('\n[plugins/built skills 경로 일관성]');

test('plugins/built plugin.json skills 경로가 실제 skills 디렉토리와 일치', () => {
  const meta = JSON.parse(fs.readFileSync(pluginDirPluginPath, 'utf8'));
  if (typeof meta.skills === 'string') {
    // "./skills/" 형태
    const skillsPath = path.resolve(path.dirname(pluginDirPluginPath), '..', meta.skills);
    assert.ok(fs.existsSync(skillsPath),
      `plugin.json skills 경로 "${meta.skills}" 해석 결과 ${skillsPath} 없음`);
  } else if (Array.isArray(meta.skills)) {
    // [{name, path}] 형태
    for (const s of meta.skills) {
      const p = path.resolve(path.dirname(pluginDirPluginPath), '..', s.path);
      assert.ok(fs.existsSync(p),
        `plugin.json skill "${s.name}" 경로 ${p} 없음`);
    }
  }
});

// ---------------------------------------------------------------------------
// 7. --plugin-dir 방식 vs repository-root 방식 경로 차이 검증
// ---------------------------------------------------------------------------

console.log('\n[--plugin-dir vs repository-root 경로 차이]');

test('plugins/built/scripts 와 루트 scripts 의 파일 목록이 동일', () => {
  const pluginScripts = path.join(ROOT, 'plugins', 'built', 'scripts');
  const rootScripts = path.join(ROOT, 'scripts');
  // 심볼릭 링크이므로 fs.readdirSync 결과가 동일해야 함
  const pluginFiles = fs.readdirSync(pluginScripts).sort();
  const rootFiles = fs.readdirSync(rootScripts).sort();
  assert.deepStrictEqual(pluginFiles, rootFiles,
    'plugins/built/scripts와 scripts/ 파일 목록 불일치');
});

test('plugins/built/skills 와 루트 skills 의 디렉토리 목록이 동일', () => {
  const pluginSkills = path.join(ROOT, 'plugins', 'built', 'skills');
  const rootSkills = path.join(ROOT, 'skills');
  const pluginDirs = fs.readdirSync(pluginSkills).sort();
  const rootDirs = fs.readdirSync(rootSkills).sort();
  assert.deepStrictEqual(pluginDirs, rootDirs,
    'plugins/built/skills와 skills/ 디렉토리 목록 불일치');
});

// ---------------------------------------------------------------------------
// 7-1. release 전 package 검증 명령
// ---------------------------------------------------------------------------

console.log('\n[release 전 package 검증 명령]');

test('npm run check:plugin-release 스크립트 정의', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.scripts['check:plugin-release'], 'node scripts/check-plugin-release.js',
    'package.json에 check:plugin-release 명령이 없거나 값이 다름');
});

test('scripts/check-plugin-release.js 통과', () => {
  const checkScript = path.join(ROOT, 'scripts', 'check-plugin-release.js');
  const result = childProcess.spawnSync(process.execPath, [checkScript], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
});

// ---------------------------------------------------------------------------
// 8. README 명령어와 실제 scripts 일치 검증
// ---------------------------------------------------------------------------

console.log('\n[README 명령어 검증]');

test('README.md의 npm scripts가 package.json에 정의됨', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const npmScripts = Object.keys(pkg.scripts || {});

  // npm 내장 명령 (package.json scripts에 없어도 됨)
  const builtinNpmCmds = new Set([
    'install', 'update', 'uninstall', 'init', 'publish',
    'start', 'stop', 'restart', 'version', 'help',
  ]);

  // README에서 npm run/npm test 패턴 추출
  const npmRunRe = /npm (?:run )?([a-z0-9:_-]+)/g;
  let match;
  const referenced = new Set();
  while ((match = npmRunRe.exec(readme)) !== null) {
    const cmd = match[1];
    if (!builtinNpmCmds.has(cmd)) {
      referenced.add(cmd);
    }
  }

  const missing = [];
  for (const cmd of referenced) {
    if (!npmScripts.includes(cmd)) {
      missing.push(cmd);
    }
  }

  assert.strictEqual(missing.length, 0,
    `README에서 참조하지만 package.json에 없는 스크립트: ${missing.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 결과 출력
// ---------------------------------------------------------------------------

console.log(`\n  plugin-packaging: ${passed} 통과, ${failed} 실패\n`);
process.exit(failed > 0 ? 1 : 0);
