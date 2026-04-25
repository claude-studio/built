#!/usr/bin/env node
/**
 * test/plan-synthesis.test.js
 *
 * plan_synthesis 입력/출력 계약 단위 테스트.
 */

'use strict';

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const {
  PLAN_SYNTHESIS_SCHEMA,
  buildPlanSynthesisInput,
  buildPlanSynthesisPrompt,
  normalizePlanSynthesisOutput,
  writePlanSynthesisOutput,
  readPlanSynthesisOutput,
  planSynthesisPaths,
} = require('../src/plan-synthesis');

const { createStandardWriter } = require('../src/providers/standard-writer');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-synthesis-test-'));
  fs.mkdirSync(path.join(dir, '.built', 'features'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.built', 'features', 'auth.md'), '# Auth\n\n로그인 구현\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'sample-app' }), 'utf8');
  return dir;
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function main() {
  console.log('\n[plan_synthesis 입력 계약]');

  await test('feature spec과 run-request 정보를 payload에 포함한다', async () => {
    const dir = makeProject();
    try {
      const payload = buildPlanSynthesisInput({
        projectRoot: dir,
        feature: 'auth',
        runRequest: {
          questions: [{ id: 'q1', question: '인증 방식은?' }],
          answers: [{ question_id: 'q1', answer: '이메일' }],
          acceptance_criteria: ['로그인 가능'],
          constraints: ['공개 API 유지'],
        },
      });

      assert.strictEqual(payload.feature_id, 'auth');
      assert.strictEqual(payload.feature_spec_path, path.join('.built', 'features', 'auth.md'));
      assert.ok(payload.feature_spec.includes('로그인 구현'));
      assert.strictEqual(payload.questions.length, 1);
      assert.strictEqual(payload.answers.length, 1);
      assert.deepStrictEqual(payload.acceptance_criteria, ['로그인 가능']);
      assert.deepStrictEqual(payload.constraints, ['공개 API 유지']);
      assert.strictEqual(payload.repo_context.summary, 'sample-app 프로젝트');
    } finally {
      rmDir(dir);
    }
  });

  await test('prompt는 payload JSON을 포함하고 파일 수정 금지를 명시한다', async () => {
    const prompt = buildPlanSynthesisPrompt({ feature_id: 'auth' });
    assert.ok(prompt.includes('"feature_id": "auth"'));
    assert.ok(prompt.includes('Do not modify files'));
  });

  await test('schema는 필수 출력 필드를 요구한다', async () => {
    assert.ok(PLAN_SYNTHESIS_SCHEMA.required.includes('summary'));
    assert.ok(PLAN_SYNTHESIS_SCHEMA.required.includes('steps'));
    assert.ok(PLAN_SYNTHESIS_SCHEMA.required.includes('acceptance_criteria'));
  });

  console.log('\n[plan_synthesis 출력 정규화]');

  await test('structured output을 canonical shape로 정규화한다', async () => {
    const output = normalizePlanSynthesisOutput({
      summary: '요약',
      steps: [{ id: 's1', title: '수정', files: ['src/auth.js'], intent: '인증 추가' }],
      acceptance_criteria: [{ criterion: '로그인 가능', verification: 'npm test' }],
      risks: ['세션 충돌'],
      out_of_scope: ['소셜 로그인'],
    }, {});

    assert.strictEqual(output.summary, '요약');
    assert.strictEqual(output.steps[0].files[0], 'src/auth.js');
    assert.strictEqual(output.acceptance_criteria[0].verification, 'npm test');
  });

  await test('문자열 JSON 응답도 정규화한다', async () => {
    const output = normalizePlanSynthesisOutput(
      '{"summary":"요약","steps":[],"acceptance_criteria":[],"risks":[],"out_of_scope":[]}',
      { acceptance_criteria: ['기준'] },
    );
    assert.strictEqual(output.summary, '요약');
  });

  await test('canonical plan-synthesis.json과 plan-synthesis.md를 기록한다', async () => {
    const dir = makeProject();
    try {
      const output = normalizePlanSynthesisOutput({
        summary: '요약',
        steps: [{ id: 'step-1', title: '수정', files: ['src/auth.js'], intent: '인증 추가' }],
        acceptance_criteria: [{ criterion: '로그인 가능', verification: 'npm test' }],
        risks: [],
        out_of_scope: [],
      }, {});

      const paths = writePlanSynthesisOutput({
        projectRoot: dir,
        feature: 'auth',
        output,
        providerSpec: { name: 'codex', model: 'gpt-5.5' },
      });

      assert.ok(fs.existsSync(paths.jsonPath), 'plan-synthesis.json 존재');
      assert.ok(fs.existsSync(paths.mdPath), 'plan-synthesis.md 존재');
      const doc = JSON.parse(fs.readFileSync(paths.jsonPath, 'utf8'));
      assert.strictEqual(doc.phase, 'plan_synthesis');
      assert.strictEqual(doc.provider, 'codex');
      assert.strictEqual(doc.output.summary, '요약');
      assert.strictEqual(readPlanSynthesisOutput(dir, 'auth').summary, '요약');
    } finally {
      rmDir(dir);
    }
  });

  console.log('\n[fake provider plan_synthesis file contract]');

  await test('fake Codex 표준 이벤트가 plan_synthesis progress/result 계약을 만족한다', async () => {
    const dir = makeProject();
    try {
      const paths = planSynthesisPaths(dir, 'auth');
      fs.mkdirSync(paths.featureDir, { recursive: true });

      const writer = createStandardWriter({
        runtimeRoot: paths.featureDir,
        phase: 'plan_synthesis',
        featureId: 'auth',
        resultOutputPath: path.join(paths.featureDir, 'plan-synthesis-result.md'),
      });

      writer.handleEvent({ type: 'phase_start', provider: 'codex', model: 'gpt-5.5' });
      writer.handleEvent({ type: 'text_delta', text: '{"summary":"요약"}' });
      writer.handleEvent({
        type: 'phase_end',
        status: 'completed',
        duration_ms: 100,
        result: '{"summary":"요약","steps":[],"acceptance_criteria":[],"risks":[],"out_of_scope":[]}',
      });
      writer.close();

      const progress = JSON.parse(fs.readFileSync(path.join(paths.featureDir, 'progress.json'), 'utf8'));
      assert.strictEqual(progress.phase, 'plan_synthesis');
      assert.strictEqual(progress.status, 'completed');
      assert.ok(fs.existsSync(path.join(paths.featureDir, 'plan-synthesis-result.md')));
    } finally {
      rmDir(dir);
    }
  });

  console.log(`\n[plan-synthesis.test] ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
