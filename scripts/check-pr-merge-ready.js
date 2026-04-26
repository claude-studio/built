#!/usr/bin/env node
/**
 * check-pr-merge-ready.js
 *
 * Finisher pre-merge gate: G3~G6 상태를 한 번에 조회한다.
 * 참고: docs/ops/pr-merge-gate.md
 *
 * 사용법:
 *   node scripts/check-pr-merge-ready.js --pr <PR_NUMBER>
 *   node scripts/check-pr-merge-ready.js --pr <PR_NUMBER> --repo owner/repo
 *   node scripts/check-pr-merge-ready.js --pr <PR_NUMBER> --json
 *
 * 종료 코드:
 *   0 — MERGE_OK
 *   1 — NEEDS_BUILDER  (conflict, BEHIND, CI 실패, CHANGES_REQUESTED)
 *   2 — NEEDS_REVIEWER (base 변경으로 재검토 필요)
 *   3 — BLOCKED        (권한/인증/외부 승인)
 *   4 — COORDINATOR    (중복 PR, UNKNOWN, canonical 불명확)
 *   5 — 스크립트 오류
 */

'use strict';

const { execSync } = require('child_process');

// ── CLI 파싱 ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let prNumber = null;
let repoFlag = '';
let jsonOutput = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--pr' && args[i + 1]) {
    prNumber = args[++i];
  } else if (args[i] === '--repo' && args[i + 1]) {
    repoFlag = `--repo ${args[++i]}`;
  } else if (args[i] === '--json') {
    jsonOutput = true;
  }
}

if (!prNumber) {
  console.error('Usage: node scripts/check-pr-merge-ready.js --pr <PR_NUMBER> [--repo owner/repo] [--json]');
  process.exit(5);
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function gh(subCmd) {
  try {
    const out = execSync(`gh ${subCmd} ${repoFlag}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return out.trim();
  } catch (err) {
    const msg = (err.stderr || err.message || '').trim();
    throw new Error(`gh 명령 실패: gh ${subCmd}\n${msg}`);
  }
}

function git(subCmd) {
  try {
    const out = execSync(`git ${subCmd}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return out.trim();
  } catch (err) {
    return null;
  }
}

// ── Gate 실행 ─────────────────────────────────────────────────────────────────

const result = {
  pr: prNumber,
  verdict: null,
  gates: {},
  messages: [],
};

try {
  // G3: mergeability
  const prJson = gh(`pr view ${prNumber} --json mergeable,mergeStateStatus,headRefName,headRefOid,baseRefName,baseRefOid,reviewDecision,reviews,statusCheckRollup,title,url`);
  const pr = JSON.parse(prJson);

  result.prUrl = pr.url;
  result.headRefName = pr.headRefName;
  result.headRefOid = pr.headRefOid;

  // G3: mergeable
  const mergeable = pr.mergeable;       // MERGEABLE | CONFLICTING | UNKNOWN
  const mergeState = pr.mergeStateStatus; // CLEAN | DIRTY | BEHIND | BLOCKED | UNKNOWN

  if (mergeable === 'UNKNOWN') {
    result.gates.G3 = { status: 'WARN', detail: `mergeable=UNKNOWN / mergeStateStatus=${mergeState}` };
    result.messages.push('G3: GitHub이 mergeability를 아직 계산 중입니다. 잠시 후 재실행하세요.');
    result.verdict = 'COORDINATOR';
  } else if (mergeable === 'CONFLICTING' || mergeState === 'DIRTY') {
    result.gates.G3 = { status: 'FAIL', detail: `mergeable=${mergeable} / mergeStateStatus=${mergeState}` };
    result.messages.push('G3: conflict 발생 — Builder로 되돌려 해결 요청.');
    result.verdict = 'NEEDS_BUILDER';
  } else if (mergeState === 'BEHIND') {
    result.gates.G3 = { status: 'FAIL', detail: `mergeStateStatus=BEHIND — head branch가 base보다 뒤처짐` };
    result.messages.push('G3: branch가 base(main)보다 뒤처져 있습니다 — Builder로 되돌려 rebase/merge 요청.');
    result.verdict = 'NEEDS_BUILDER';
  } else if (mergeState === 'BLOCKED') {
    result.gates.G3 = { status: 'FAIL', detail: `mergeStateStatus=BLOCKED — 권한 또는 외부 승인 문제` };
    result.messages.push('G3: GitHub 보호 규칙 또는 외부 승인 문제 — BLOCKED 처리.');
    result.verdict = 'BLOCKED';
  } else {
    result.gates.G3 = { status: 'PASS', detail: `mergeable=${mergeable} / mergeStateStatus=${mergeState}` };
  }

  // G4: CI/checks (required checks만 blocking)
  const checks = pr.statusCheckRollup || [];
  const required = checks.filter(c => c.isRequired !== false); // gh가 isRequired를 반환하지 않으면 전체 사용
  const allChecks = checks.length > 0 ? checks : [];

  const failed = allChecks.filter(c => c.conclusion === 'FAILURE' || c.conclusion === 'ACTION_REQUIRED');
  const pending = allChecks.filter(c => c.status === 'IN_PROGRESS' || c.status === 'QUEUED' || c.status === 'PENDING');
  const passed = allChecks.filter(c => c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED');

  if (!result.verdict) {
    if (failed.length > 0) {
      result.gates.G4 = {
        status: 'FAIL',
        detail: `${failed.length}개 실패: ${failed.map(c => c.name).join(', ')}`,
      };
      result.messages.push(`G4: CI 실패 (${failed.length}개) — Builder로 되돌려 수정 요청.`);
      result.verdict = 'NEEDS_BUILDER';
    } else if (pending.length > 0) {
      result.gates.G4 = {
        status: 'PENDING',
        detail: `${pending.length}개 진행 중: ${pending.map(c => c.name).join(', ')}`,
      };
      result.messages.push(`G4: CI 진행 중 (${pending.length}개) — 완료 후 재실행하세요.`);
      result.verdict = 'COORDINATOR';
    } else {
      result.gates.G4 = {
        status: 'PASS',
        detail: `${passed.length}/${allChecks.length} SUCCESS/NEUTRAL/SKIPPED`,
      };
    }
  } else {
    result.gates.G4 = { status: 'SKIP', detail: 'G3 실패로 인해 확인 생략' };
  }

  // G5: review
  const reviewDecision = pr.reviewDecision; // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | null

  if (!result.verdict) {
    if (reviewDecision === 'APPROVED') {
      const approvers = (pr.reviews || [])
        .filter(r => r.state === 'APPROVED')
        .map(r => r.author?.login || 'unknown');
      result.gates.G5 = { status: 'PASS', detail: `APPROVED by: ${approvers.join(', ') || 'unknown'}` };
    } else if (reviewDecision === 'CHANGES_REQUESTED') {
      result.gates.G5 = { status: 'FAIL', detail: 'CHANGES_REQUESTED — 수정 요청 있음' };
      result.messages.push('G5: Reviewer가 수정을 요청했습니다 — Builder로 되돌려 반영 후 재검토 요청.');
      result.verdict = 'NEEDS_BUILDER';
    } else if (reviewDecision === 'REVIEW_REQUIRED' || reviewDecision === null) {
      result.gates.G5 = { status: 'FAIL', detail: `reviewDecision=${reviewDecision || 'null'} — 승인 없음` };
      result.messages.push('G5: review 승인이 없습니다 — Coordinator에게 에스컬레이션.');
      result.verdict = 'COORDINATOR';
    } else {
      result.gates.G5 = { status: 'PASS', detail: `reviewDecision=${reviewDecision}` };
    }
  } else {
    result.gates.G5 = { status: 'SKIP', detail: 'G3/G4 실패로 인해 확인 생략' };
  }

  // G6: branch freshness (git으로 직접 확인)
  if (!result.verdict) {
    git('fetch origin --quiet');
    const behind = git(`log origin/${pr.headRefName}..origin/${pr.baseRefName} --oneline`);
    if (behind && behind.length > 0) {
      result.gates.G6 = { status: 'FAIL', detail: `head branch가 ${pr.baseRefName}보다 뒤처짐` };
      result.messages.push(`G6: head branch(${pr.headRefName})가 ${pr.baseRefName}보다 뒤처져 있습니다 — Builder로 되돌려 업데이트 요청.`);
      result.verdict = 'NEEDS_BUILDER';
    } else {
      result.gates.G6 = { status: 'PASS', detail: `head branch가 ${pr.baseRefName} 기준 최신` };
    }
  } else {
    result.gates.G6 = { status: 'SKIP', detail: 'G3/G4/G5 실패로 인해 확인 생략' };
  }

  // 최종 판정
  if (!result.verdict) {
    result.verdict = 'MERGE_OK';
    result.messages.push('모든 gate 통과 — merge 진행 가능.');
  }

} catch (err) {
  result.verdict = 'COORDINATOR';
  result.error = err.message;
  result.messages.push(`스크립트 오류: ${err.message}`);
}

// ── 출력 ──────────────────────────────────────────────────────────────────────

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const verdictLine = result.verdict;
  console.log(verdictLine);
  console.log('---');
  for (const [gate, info] of Object.entries(result.gates)) {
    console.log(`${gate}: [${info.status}] ${info.detail}`);
  }
  if (result.messages.length > 0) {
    console.log('');
    result.messages.forEach(m => console.log(m));
  }
  if (result.prUrl) {
    console.log('');
    console.log(`PR: ${result.prUrl}`);
    console.log(`head branch: ${result.headRefName}`);
    console.log(`head commit: ${result.headRefOid}`);
  }
}

// ── 종료 코드 ─────────────────────────────────────────────────────────────────

const exitCodes = {
  MERGE_OK: 0,
  NEEDS_BUILDER: 1,
  NEEDS_REVIEWER: 2,
  BLOCKED: 3,
  COORDINATOR: 4,
};
process.exit(exitCodes[result.verdict] ?? 5);
