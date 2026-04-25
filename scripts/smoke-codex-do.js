#!/usr/bin/env node
/**
 * Real Codex do phase smoke.
 *
 * 기본 테스트에서는 실행하지 않는다. 다음처럼 명시적으로 opt-in한다.
 *   BUILT_CODEX_DO_SMOKE=1 node scripts/smoke-codex-do.js
 *
 * 완료 기준:
 *   - scripts/do.js가 Codex provider로 정상 종료 (exit 0)
 *   - do-result.md에 feature_id, status 필드 존재
 *   - progress.json에 status=completed
 *
 * 실패 시 원인 기록:
 *   - Codex CLI 미설치: "Codex CLI를 찾을 수 없습니다" 메시지 출력
 *   - 인증 실패: "Codex 인증이 필요합니다" 메시지 출력
 *   - do 실행 실패: exit code와 stderr 전체 출력
 *   - 산출물 구조 불일치: 누락 필드 명시 출력
 */

'use strict';

const fs           = require('fs');
const os           = require('os');
const path         = require('path');
const childProcess = require('child_process');

if (process.env.BUILT_CODEX_DO_SMOKE !== '1') {
  console.log('[built:smoke-do] skip: BUILT_CODEX_DO_SMOKE=1 설정 시 실제 Codex do smoke를 실행합니다.');
  process.exit(0);
}

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'built-codex-do-smoke-'));
const feature     = 'codex-do-smoke';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const data = {};
  for (const line of match[1].split('\n')) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const val = line.slice(sep + 1).trim().replace(/^"(.*)"$/, '$1');
    data[key] = val;
  }
  return data;
}

try {
  // feature spec 작성 (파일 변경 없는 간단한 hello helper)
  fs.mkdirSync(path.join(projectRoot, '.built', 'features'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, '.built', 'features', `${feature}.md`),
    [
      '# Codex do smoke',
      '',
      '## 목표',
      'src/hello.js 파일에 hello(name) 함수를 구현한다.',
      '',
      '## 구현 내용',
      '- hello(name) 함수: "Hello, <name>!" 문자열을 반환한다.',
      '- module.exports로 내보낸다.',
      '',
      '## 완료 기준',
      '- src/hello.js 파일이 존재한다.',
      '- hello("World")가 "Hello, World!"를 반환한다.',
    ].join('\n') + '\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ name: 'codex-do-smoke' }),
    'utf8',
  );

  // run-request.json 작성 — Codex do provider 설정
  writeJson(path.join(projectRoot, '.built', 'runtime', 'runs', feature, 'run-request.json'), {
    featureId:  feature,
    createdAt:  new Date().toISOString(),
    providers: {
      do: {
        name:       'codex',
        sandbox:    'workspace-write',
        timeout_ms: 900000,
      },
    },
    acceptance_criteria: ['src/hello.js 존재', 'hello("World") === "Hello, World!"'],
  });

  // scripts/do.js 실행
  const scriptPath = path.join(__dirname, 'do.js');
  const result = childProcess.spawnSync(process.execPath, [scriptPath, feature], {
    cwd:     projectRoot,
    env:     process.env,
    stdio:   'inherit',
    timeout: 1000 * 60 * 20,
  });

  const exitCode = result.status === null ? 1 : result.status;
  if (exitCode !== 0) {
    console.error(`[built:smoke-do] do.js 실패 (exit ${exitCode})`);
    if (result.error) {
      console.error(`[built:smoke-do] 오류: ${result.error.message}`);
      if (result.error.message.includes('찾을 수 없')) {
        console.error('[built:smoke-do] 원인: Codex CLI 미설치. @openai/codex를 설치하세요.');
      }
    }
    process.exit(exitCode);
  }

  // do-result.md 검증
  const resultPath = path.join(projectRoot, '.built', 'features', feature, 'do-result.md');
  if (!fs.existsSync(resultPath)) {
    console.error('[built:smoke-do] do-result.md가 생성되지 않았습니다.');
    process.exit(1);
  }

  const content    = fs.readFileSync(resultPath, 'utf8');
  const frontmatter = parseFrontmatter(content);

  const REQUIRED_FIELDS = ['feature_id', 'status', 'model', 'cost_usd', 'duration_ms', 'created_at'];
  const missing = REQUIRED_FIELDS.filter((k) => !(k in frontmatter));
  if (missing.length > 0) {
    console.error(`[built:smoke-do] do-result.md 필수 frontmatter 필드 누락: ${missing.join(', ')}`);
    process.exit(1);
  }

  if (frontmatter.feature_id !== feature) {
    console.error(`[built:smoke-do] feature_id 불일치: 예상=${feature}, 실제=${frontmatter.feature_id}`);
    process.exit(1);
  }

  if (frontmatter.status !== 'completed') {
    console.error(`[built:smoke-do] status 불일치: 예상=completed, 실제=${frontmatter.status}`);
    process.exit(1);
  }

  // progress.json 검증
  const progressPath = path.join(projectRoot, '.built', 'features', feature, 'progress.json');
  if (fs.existsSync(progressPath)) {
    const progress = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
    if (progress.status !== 'completed') {
      console.error(`[built:smoke-do] progress.json status 불일치: 예상=completed, 실제=${progress.status}`);
      process.exit(1);
    }
  }

  console.log(`[built:smoke-do] ok: ${resultPath}`);
  process.exit(0);

} catch (err) {
  console.error(`[built:smoke-do] 예외 발생: ${err.message}`);
  process.exit(1);
} finally {
  if (process.env.BUILT_KEEP_SMOKE_DIR !== '1') {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}
