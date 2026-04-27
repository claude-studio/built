#!/usr/bin/env node
/**
 * cleanup.js
 *
 * /built:cleanup <feature> 스킬 헬퍼 — 완료된 feature의 worktree와 산출물을 정리한다.
 * 외부 npm 패키지 없음 (Node.js fs/path/child_process만).
 *
 * 동작:
 *   1. state.json status 확인 — running이면 경고 후 중단 (안전 장치)
 *   2. --archive이면 state.execution_worktree.result_dir를 archive로 복사
 *   3. git worktree remove .claude/worktrees/<feature> --force 실행
 *   4. .built/features/<feature>/ 아카이빙 또는 삭제 (--archive 플래그로 선택)
 *   5. .built/runtime/runs/<feature>/ 삭제
 *   6. .built/runtime/registry.json에서 feature unregister
 *   7. .built/runtime/locks/<feature>.lock 삭제
 *
 * 사용법:
 *   node scripts/cleanup.js <feature> [--archive]
 *   node scripts/cleanup.js --all [--archive]
 *
 * 옵션:
 *   --archive  .built/features/<feature>/ 와 worktree result_dir를 .built/archive/<feature>/ 로 보존
 *   --all      done 또는 aborted 상태의 feature 전체 일괄 정리
 *
 * Exit codes:
 *   0 — 성공
 *   1 — 오류 (running 상태 거부 등)
 *
 * API (모듈로도 사용 가능):
 *   cleanupFeature(projectRoot, feature, opts) -> CleanupResult
 *   cleanupAll(projectRoot, opts)              -> CleanupAllResult
 *
 * @typedef {{ feature: string, skipped: boolean, reason?: string, archived?: boolean, actions: string[] }} CleanupResult
 * @typedef {{ results: CleanupResult[], cleaned: number, skipped: number }} CleanupAllResult
 */

'use strict';

const fs           = require('fs');
const path         = require('path');
const childProcess = require('child_process');
const registryModule = require(path.join(__dirname, '..', 'src', 'registry'));

// ---------------------------------------------------------------------------
// 내부 유틸
// ---------------------------------------------------------------------------

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeJsonSafe(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * 디렉토리 또는 파일을 재귀 삭제한다. 없으면 무시.
 * @param {string} target
 * @returns {boolean} 삭제했으면 true
 */
function removeRecursive(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 디렉토리를 이동한다 (rename → copy+delete fallback).
 * @param {string} src
 * @param {string} dest
 */
function moveDir(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch (_) {
    // 크로스-디바이스 fallback: 복사 후 삭제
    copyDirRecursive(src, dest);
    removeRecursive(src);
  }
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcEntry  = path.join(src, entry.name);
    const destEntry = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcEntry, destEntry);
    } else {
      fs.copyFileSync(srcEntry, destEntry);
    }
  }
}

function sameResolvedPath(a, b) {
  if (!a || !b) return false;
  return path.resolve(a) === path.resolve(b);
}

function safeWorktreeName(featureId) {
  return String(featureId)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'feature';
}

function isPathInside(candidate, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(candidate));
  return rel === '' || (rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function gitOutput(cwd, args) {
  const result = childProcess.spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return {
    ok: result.status === 0,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

function expectedWorktreeRoots(projectRoot) {
  const projectName = path.basename(projectRoot);
  return [
    path.join(projectRoot, '.claude', 'worktrees'),
    path.join(path.dirname(projectRoot), `${projectName}-worktrees`),
  ].map((p) => path.resolve(p));
}

function validateWorktreeRemoval(projectRoot, feature, worktreePath, expectedBranch) {
  const resolvedPath = path.resolve(worktreePath);
  const allowedRoots = expectedWorktreeRoots(projectRoot);
  if (!allowedRoots.some((root) => isPathInside(resolvedPath, root))) {
    return {
      ok: false,
      reason: `worktree path is outside allowed roots: ${resolvedPath}`,
    };
  }

  const branch = gitOutput(resolvedPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch.ok) {
    return {
      ok: false,
      reason: `worktree path is not a readable git worktree: ${resolvedPath}`,
    };
  }

  const expected = expectedBranch || `built/worktree/${safeWorktreeName(feature)}`;
  if (branch.stdout !== expected) {
    return {
      ok: false,
      reason: `worktree branch mismatch: expected ${expected}, got ${branch.stdout || '-'}`,
    };
  }

  const status = gitOutput(resolvedPath, ['status', '--porcelain']);
  if (!status.ok) {
    return {
      ok: false,
      reason: `could not inspect worktree status: ${status.stderr || resolvedPath}`,
    };
  }
  if (status.stdout) {
    return {
      ok: false,
      reason: `worktree has uncommitted changes: ${resolvedPath}`,
    };
  }

  return { ok: true, reason: null };
}

/**
 * git worktree remove 실행.
 * @param {string} projectRoot
 * @param {string} feature
 * @returns {{ success: boolean, message: string }}
 */
function removeWorktree(projectRoot, feature, explicitPath, expectedBranch) {
  const worktreePath = explicitPath || path.join(projectRoot, '.claude', 'worktrees', feature);
  if (!fs.existsSync(worktreePath)) {
    return { success: true, message: `worktree not found (already removed): ${worktreePath}` };
  }

  const validation = validateWorktreeRemoval(projectRoot, feature, worktreePath, expectedBranch);
  if (!validation.ok) {
    return {
      success: false,
      message: validation.reason,
    };
  }

  try {
    childProcess.execFileSync('git', ['worktree', 'remove', worktreePath, '--force'], {
      cwd: projectRoot,
      stdio: 'pipe',
    });
    return { success: true, message: `worktree removed: ${worktreePath}` };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    return {
      success: false,
      message: `worktree remove failed: ${stderr.trim() || worktreePath}`,
    };
  }
}

/**
 * registry.json에서 feature를 unregister.
 * @param {string} runtimeDir
 * @param {string} feature
 * @returns {boolean} 제거했으면 true
 */
function unregisterFeature(runtimeDir, feature) {
  const registryFile = path.join(runtimeDir, 'registry.json');
  const registry = readJsonSafe(registryFile);
  if (!registry || !registry.features) return false;
  if (!(feature in registry.features)) return false;

  delete registry.features[feature];
  writeJsonSafe(registryFile, registry);
  return true;
}

/**
 * lock 파일 삭제.
 * @param {string} runtimeDir
 * @param {string} feature
 * @returns {boolean}
 */
function removeLock(runtimeDir, feature) {
  const lockFile = path.join(runtimeDir, 'locks', `${feature}.lock`);
  try {
    fs.unlinkSync(lockFile);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

function resolveCanonicalResultDir(state, registryEntry) {
  if (registryEntry && registryEntry.resultDir) return registryEntry.resultDir;
  if (state && state.execution_worktree && state.execution_worktree.result_dir) {
    return state.execution_worktree.result_dir;
  }
  return null;
}

function archiveFeatureResults(feature, featuresDir, archiveDir, canonicalResultDir, actions) {
  const hasRootFallback = fs.existsSync(featuresDir);
  const hasCanonical = canonicalResultDir && fs.existsSync(canonicalResultDir);
  const canonicalIsRoot = hasCanonical && sameResolvedPath(canonicalResultDir, featuresDir);

  if (hasCanonical && !canonicalIsRoot) {
    if (hasRootFallback) {
      const fallbackArchiveDir = path.join(archiveDir, '_root-fallback');
      copyDirRecursive(featuresDir, fallbackArchiveDir);
      actions.push(`root fallback features dir archived: ${featuresDir} → ${fallbackArchiveDir}`);
    }

    copyDirRecursive(canonicalResultDir, archiveDir);
    actions.push(`worktree result dir archived: ${canonicalResultDir} → ${archiveDir}`);

    if (hasRootFallback) {
      removeRecursive(featuresDir);
      actions.push(`root fallback features dir removed after archive: ${featuresDir}`);
    }
    return true;
  }

  if (hasRootFallback) {
    moveDir(featuresDir, archiveDir);
    actions.push(`features dir archived: ${featuresDir} → ${archiveDir}`);
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// 핵심 함수
// ---------------------------------------------------------------------------

/**
 * 단일 feature 정리.
 *
 * @param {string} projectRoot
 * @param {string} feature
 * @param {{ archive?: boolean }} opts
 * @returns {CleanupResult}
 */
function cleanupFeature(projectRoot, feature, opts = {}) {
  if (!feature) {
    return { feature: '', skipped: true, reason: 'feature name is required', actions: [] };
  }

  const archive    = !!opts.archive;
  const runtimeDir = path.join(projectRoot, '.built', 'runtime');
  const runsDir    = path.join(runtimeDir, 'runs');
  const runDir     = path.join(runsDir, feature);
  const stateFile  = path.join(runDir, 'state.json');
  const featuresDir = path.join(projectRoot, '.built', 'features', feature);
  const archiveDir  = path.join(projectRoot, '.built', 'archive', feature);

  const actions = [];

  // state.json 확인
  const state = readJsonSafe(stateFile);
  const registry = readJsonSafe(path.join(runtimeDir, 'registry.json'));
  const registryEntry = registry && registry.features ? registry.features[feature] : null;
  const explicitWorktreePath = (registryEntry && registryEntry.worktreePath) ||
    (state && state.execution_worktree && state.execution_worktree.enabled && state.execution_worktree.path) ||
    null;
  const expectedWorktreeBranch = (registryEntry && registryEntry.worktreeBranch) ||
    (state && state.execution_worktree && state.execution_worktree.branch) ||
    null;
  const canonicalResultDir = resolveCanonicalResultDir(state, registryEntry);
  const worktreePath = explicitWorktreePath || registryModule.getWorktreePath(projectRoot, safeWorktreeName(feature));

  // running 상태이면 거부 (안전 장치)
  if (state && state.status === 'running') {
    return {
      feature,
      skipped: true,
      reason: `feature '${feature}' is currently running (status=running). Stop it first with /built:abort.`,
      actions,
    };
  }

  if (fs.existsSync(worktreePath)) {
    const validation = validateWorktreeRemoval(projectRoot, feature, worktreePath, expectedWorktreeBranch);
    if (!validation.ok) {
      actions.push(validation.reason);
      return {
        feature,
        skipped: true,
        reason: validation.reason,
        actions,
      };
    }
  }

  // 1. --archive이면 worktree 제거 전에 canonical result_dir를 archive에 보존
  if (archive) {
    const archived = archiveFeatureResults(feature, featuresDir, archiveDir, canonicalResultDir, actions);
    if (!archived) {
      actions.push(`features dir not found (skipped): ${featuresDir}`);
    }
  }

  // 2. git worktree 제거
  const worktreeResult = removeWorktree(projectRoot, feature, worktreePath, expectedWorktreeBranch);
  actions.push(worktreeResult.message);
  if (!worktreeResult.success) {
    return {
      feature,
      skipped: true,
      reason: worktreeResult.message,
      actions,
    };
  }

  // 3. .built/features/<feature>/ 삭제. --archive에서는 이미 worktree 제거 전에 보존한다.
  if (!archive && fs.existsSync(featuresDir)) {
    removeRecursive(featuresDir);
    actions.push(`features dir removed: ${featuresDir}`);
  } else if (!archive) {
    actions.push(`features dir not found (skipped): ${featuresDir}`);
  } else {
    actions.push(`features dir archive step completed before worktree removal: ${archiveDir}`);
  }

  // 4. .built/runtime/runs/<feature>/ 삭제
  if (fs.existsSync(runDir)) {
    removeRecursive(runDir);
    actions.push(`runtime run dir removed: ${runDir}`);
  } else {
    actions.push(`runtime run dir not found (skipped): ${runDir}`);
  }

  // 5. registry에서 unregister
  const unregistered = unregisterFeature(runtimeDir, feature);
  actions.push(unregistered
    ? `registry: unregistered '${feature}'`
    : `registry: '${feature}' not found (skipped)`
  );

  // 6. lock 파일 삭제
  const lockRemoved = removeLock(runtimeDir, feature);
  if (lockRemoved) actions.push(`lock removed: ${feature}.lock`);

  return {
    feature,
    skipped: false,
    archived: archive,
    actions,
  };
}

/**
 * done / aborted / failed 상태의 모든 feature를 일괄 정리.
 *
 * @param {string} projectRoot
 * @param {{ archive?: boolean }} opts
 * @returns {CleanupAllResult}
 */
function cleanupAll(projectRoot, opts = {}) {
  const runtimeDir   = path.join(projectRoot, '.built', 'runtime');
  const registryFile = path.join(runtimeDir, 'registry.json');
  const registry     = readJsonSafe(registryFile);

  const eligibleStatuses = new Set(['done', 'completed', 'aborted', 'failed']);
  const results  = [];
  let cleaned  = 0;
  let skipped  = 0;

  // registry에 등록된 feature 순회
  if (registry && registry.features) {
    for (const [featureId, entry] of Object.entries(registry.features)) {
      if (eligibleStatuses.has(entry.status)) {
        const result = cleanupFeature(projectRoot, featureId, opts);
        results.push(result);
        if (result.skipped) skipped++; else cleaned++;
      } else {
        results.push({
          feature: featureId,
          skipped: true,
          reason: `status is '${entry.status}' (not eligible for cleanup)`,
          actions: [],
        });
        skipped++;
      }
    }
  }

  // registry에 없지만 runs/ 디렉토리에 있는 feature도 확인
  const runsDir = path.join(runtimeDir, 'runs');
  if (fs.existsSync(runsDir)) {
    for (const name of fs.readdirSync(runsDir)) {
      // 이미 처리한 feature 건너뜀
      if (results.some((r) => r.feature === name)) continue;

      const stateFile = path.join(runsDir, name, 'state.json');
      const state = readJsonSafe(stateFile);
      if (state && eligibleStatuses.has(state.status)) {
        const result = cleanupFeature(projectRoot, name, opts);
        results.push(result);
        if (result.skipped) skipped++; else cleaned++;
      }
    }
  }

  return { results, cleaned, skipped };
}

// ---------------------------------------------------------------------------
// CLI 진입점
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args       = process.argv.slice(2);
  const allFlag    = args.includes('--all');
  const archiveFlag = args.includes('--archive');
  const feature    = args.find((a) => !a.startsWith('--')) || null;

  const projectRoot = process.cwd();
  const opts = { archive: archiveFlag };

  if (!allFlag && !feature) {
    console.error('Usage: node scripts/cleanup.js <feature> [--archive]');
    console.error('       node scripts/cleanup.js --all [--archive]');
    process.exit(1);
  }

  try {
    if (allFlag) {
      const { results, cleaned, skipped } = cleanupAll(projectRoot, opts);
      if (results.length === 0) {
        console.log('No eligible features found (done/aborted/failed).');
      } else {
        for (const r of results) {
          if (r.skipped) {
            console.log(`[skip] ${r.feature}: ${r.reason}`);
          } else {
            console.log(`[ok]   ${r.feature}`);
            for (const a of r.actions) console.log(`         ${a}`);
          }
        }
        console.log(`\nDone: ${cleaned} cleaned, ${skipped} skipped.`);
      }
    } else {
      const result = cleanupFeature(projectRoot, feature, opts);
      if (result.skipped) {
        console.error(`Skipped: ${result.reason}`);
        process.exit(1);
      } else {
        for (const a of result.actions) console.log(a);
        const suffix = archiveFlag ? ' (archived)' : '';
        console.log(`\nCleaned up feature '${feature}'${suffix}.`);
      }
    }
    process.exit(0);
  } catch (err) {
    console.error('error: ' + err.message);
    process.exit(1);
  }
}

module.exports = {
  cleanupFeature,
  cleanupAll,
  removeWorktree,
  validateWorktreeRemoval,
  unregisterFeature,
  removeLock,
};
