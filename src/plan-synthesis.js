/**
 * src/plan-synthesis.js
 *
 * plan_synthesis phase의 입력 payload와 산출물 정규화 helper.
 * Provider는 payload를 받아 계획을 작성하고, runner가 canonical 파일을 쓴다.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const PLAN_SYNTHESIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'steps', 'acceptance_criteria', 'risks', 'out_of_scope'],
  properties: {
    summary: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'files', 'intent'],
        properties: {
          id:     { type: 'string' },
          title:  { type: 'string' },
          files:  { type: 'array', items: { type: 'string' } },
          intent: { type: 'string' },
        },
      },
    },
    acceptance_criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['criterion', 'verification'],
        properties: {
          criterion:    { type: 'string' },
          verification: { type: 'string' },
        },
      },
    },
    risks:        { type: 'array', items: { type: 'string' } },
    out_of_scope: { type: 'array', items: { type: 'string' } },
  },
};

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return null;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function resolveFeatureSpecPath(projectRoot, feature, runRequest) {
  if (runRequest && runRequest.planPath) {
    return path.isAbsolute(runRequest.planPath)
      ? runRequest.planPath
      : path.join(projectRoot, runRequest.planPath);
  }
  return path.join(projectRoot, '.built', 'features', `${feature}.md`);
}

function buildRepoContext(projectRoot, runRequest) {
  if (runRequest && runRequest.repo_context && typeof runRequest.repo_context === 'object') {
    return runRequest.repo_context;
  }

  const packageJson = readJsonIfExists(path.join(projectRoot, 'package.json'));
  const relevantFiles = [];
  for (const relPath of ['package.json', 'README.md', 'BUILT-DESIGN.md']) {
    if (fs.existsSync(path.join(projectRoot, relPath))) {
      relevantFiles.push({ path: relPath, summary: '프로젝트 컨텍스트 파일' });
    }
  }

  return {
    root: projectRoot,
    summary: packageJson && packageJson.name
      ? `${packageJson.name} 프로젝트`
      : '프로젝트 구조 요약 없음',
    relevant_files: relevantFiles,
  };
}

function buildPlanSynthesisInput({ projectRoot, feature, runRequest }) {
  if (!projectRoot) throw new TypeError('buildPlanSynthesisInput: projectRoot is required');
  if (!feature) throw new TypeError('buildPlanSynthesisInput: feature is required');

  const featureSpecPath = resolveFeatureSpecPath(projectRoot, feature, runRequest);
  const featureSpec = readTextIfExists(featureSpecPath);
  if (!featureSpec) {
    throw new Error(`feature spec not found: ${featureSpecPath}`);
  }

  const relativeSpecPath = path.relative(projectRoot, featureSpecPath) || featureSpecPath;

  return {
    feature_id: feature,
    feature_spec_path: relativeSpecPath,
    feature_spec: featureSpec,
    questions: asArray(runRequest && runRequest.questions),
    answers: asArray(runRequest && runRequest.answers),
    repo_context: buildRepoContext(projectRoot, runRequest),
    prior_art: asArray(runRequest && runRequest.prior_art),
    acceptance_criteria: asArray(runRequest && runRequest.acceptance_criteria),
    constraints: asArray(runRequest && runRequest.constraints),
  };
}

function buildPlanSynthesisPrompt(payload) {
  return [
    'You are running the built plan_synthesis phase.',
    'Return only JSON matching the provided schema.',
    'Do not modify files. Produce an implementation plan that the do phase can use.',
    '',
    'Input payload:',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

function coerceStringArray(value) {
  return asArray(value).map((item) => String(item));
}

function normalizePlanSynthesisOutput(raw, payload) {
  let output = raw;

  if (typeof output === 'string') {
    try {
      output = JSON.parse(output);
    } catch (_) {
      output = { summary: output };
    }
  }
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    output = {};
  }

  const steps = asArray(output.steps).map((step, index) => ({
    id:     String((step && step.id) || `step-${index + 1}`),
    title:  String((step && step.title) || `Step ${index + 1}`),
    files:  coerceStringArray(step && step.files),
    intent: String((step && step.intent) || ''),
  }));

  const criteriaSource = asArray(output.acceptance_criteria).length > 0
    ? output.acceptance_criteria
    : asArray(payload && payload.acceptance_criteria);

  const acceptanceCriteria = criteriaSource.map((item) => {
    if (typeof item === 'string') {
      return { criterion: item, verification: '' };
    }
    return {
      criterion:    String((item && item.criterion) || ''),
      verification: String((item && item.verification) || ''),
    };
  });

  return {
    summary: String(output.summary || ''),
    steps,
    acceptance_criteria: acceptanceCriteria,
    risks: coerceStringArray(output.risks),
    out_of_scope: coerceStringArray(output.out_of_scope),
  };
}

function planSynthesisPaths(projectRoot, feature, opts = {}) {
  const featureDir = opts.resultRoot || path.join(projectRoot, '.built', 'features', feature);
  return {
    featureDir,
    jsonPath: path.join(featureDir, 'plan-synthesis.json'),
    mdPath:   path.join(featureDir, 'plan-synthesis.md'),
  };
}

function writePlanSynthesisOutput({ projectRoot, feature, resultRoot, output, providerSpec }) {
  const paths = planSynthesisPaths(projectRoot, feature, { resultRoot });
  fs.mkdirSync(paths.featureDir, { recursive: true });

  const jsonDoc = {
    feature_id: feature,
    phase: 'plan_synthesis',
    provider: providerSpec && providerSpec.name ? providerSpec.name : 'claude',
    model: providerSpec && providerSpec.model ? providerSpec.model : null,
    created_at: new Date().toISOString(),
    output,
  };

  fs.writeFileSync(paths.jsonPath, JSON.stringify(jsonDoc, null, 2) + '\n', 'utf8');
  fs.writeFileSync(paths.mdPath, renderPlanSynthesisMarkdown(jsonDoc), 'utf8');
  return paths;
}

function renderPlanSynthesisMarkdown(doc) {
  const output = doc.output || {};
  const lines = [
    '---',
    `feature_id: ${doc.feature_id}`,
    `phase: ${doc.phase}`,
    `provider: ${doc.provider}`,
    `model: ${doc.model || ''}`,
    `created_at: "${doc.created_at}"`,
    '---',
    '',
    '# Plan Synthesis',
    '',
    output.summary || '',
    '',
    '## Steps',
  ];

  for (const step of asArray(output.steps)) {
    lines.push('', `### ${step.id}: ${step.title}`, '', step.intent || '');
    if (asArray(step.files).length > 0) {
      lines.push('', 'Files:');
      for (const file of step.files) lines.push(`- ${file}`);
    }
  }

  lines.push('', '## Acceptance Criteria');
  for (const item of asArray(output.acceptance_criteria)) {
    const verification = item.verification ? ` (${item.verification})` : '';
    lines.push(`- ${item.criterion}${verification}`);
  }

  lines.push('', '## Risks');
  for (const risk of asArray(output.risks)) lines.push(`- ${risk}`);

  lines.push('', '## Out Of Scope');
  for (const item of asArray(output.out_of_scope)) lines.push(`- ${item}`);

  return lines.join('\n').trimEnd() + '\n';
}

function readPlanSynthesisOutput(projectRoot, feature) {
  const paths = planSynthesisPaths(projectRoot, feature);
  const doc = readJsonIfExists(paths.jsonPath);
  return doc && doc.output ? doc.output : null;
}

module.exports = {
  PLAN_SYNTHESIS_SCHEMA,
  buildPlanSynthesisInput,
  buildPlanSynthesisPrompt,
  normalizePlanSynthesisOutput,
  writePlanSynthesisOutput,
  readPlanSynthesisOutput,
  planSynthesisPaths,
};
