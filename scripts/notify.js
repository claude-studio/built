#!/usr/bin/env node
/**
 * notify.js
 *
 * built 알림 헬퍼 — Do/Check/Report 단계 완료 및 WorktreeCreate/Remove 이벤트 시
 * macOS/Linux 시스템 알림을 발송한다.
 *
 * 사용법:
 *   # pipeline hook (built hooks.json에서 호출)
 *   BUILT_HOOK_POINT=after_do BUILT_FEATURE=user-auth node scripts/notify.js
 *
 *   # 직접 호출
 *   node scripts/notify.js <hook-point> [feature]
 *   node scripts/notify.js after_do user-auth
 *   node scripts/notify.js WorktreeCreate my-feature
 *
 *   # Claude Code lifecycle hook (stdin에서 JSON 입력)
 *   echo '{"hook_event_name":"WorktreeCreate","worktree_path":"/path/to/worktree"}' | node scripts/notify.js
 *
 * 플랫폼 지원:
 *   macOS  — osascript(AppleScript) > terminal-notifier > echo fallback
 *   Linux  — notify-send > echo fallback
 *   기타   — echo fallback
 *
 * CI 환경 (CI, GITHUB_ACTIONS, NO_NOTIFY 등) 에서는 echo로만 출력 (오류 없음).
 *
 * 외부 npm 패키지 없음 (Node.js 표준 라이브러리 + child_process만 사용).
 *
 * Exit codes:
 *   0 — 성공 (알림 발송 또는 fallback)
 *   1 — 치명적 오류 (인자 누락 등)
 */

'use strict';

const { execFileSync } = require('child_process');
const os               = require('os');
const readline         = require('readline');
const { sanitizeText } = require('./sanitize');

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/** 파이프라인 hookpoint → 사람이 읽기 좋은 phase 이름 */
const PHASE_LABELS = {
  after_do:     'Do',
  after_check:  'Check',
  after_report: 'Report',
  before_do:    'Do (시작 전)',
  before_check: 'Check (시작 전)',
};

/** Claude Code lifecycle hook 이벤트 목록 */
const LIFECYCLE_EVENTS = new Set(['WorktreeCreate', 'WorktreeRemove']);

/** CI 환경 감지용 환경변수 */
const CI_ENV_VARS = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'JENKINS_URL', 'NO_NOTIFY'];

// ---------------------------------------------------------------------------
// 플랫폼 / 환경 감지
// ---------------------------------------------------------------------------

/**
 * CI 또는 알림 억제 환경인지 확인한다.
 * @returns {boolean}
 */
function isCI() {
  return CI_ENV_VARS.some((v) => process.env[v] === 'true' || process.env[v] === '1' || v === 'NO_NOTIFY' && process.env[v]);
}

/**
 * 현재 플랫폼을 반환한다.
 * @returns {'macos' | 'linux' | 'other'}
 */
function detectPlatform() {
  const p = process.platform;
  if (p === 'darwin') return 'macos';
  if (p === 'linux')  return 'linux';
  return 'other';
}

// ---------------------------------------------------------------------------
// 알림 발송 — 플랫폼별
// ---------------------------------------------------------------------------

/**
 * 외부 실행 파일이 PATH에 있는지 확인한다.
 * @param {string} bin
 * @returns {boolean}
 */
function commandExists(bin) {
  try {
    execFileSync('which', [bin], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * macOS — osascript(AppleScript)로 알림 발송.
 * @param {string} title
 * @param {string} message
 * @returns {boolean} 성공 여부
 */
function sendViaOsascript(title, message) {
  try {
    const script = `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`;
    execFileSync('osascript', ['-e', script], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * macOS — terminal-notifier로 알림 발송.
 * @param {string} title
 * @param {string} message
 * @returns {boolean} 성공 여부
 */
function sendViaTerminalNotifier(title, message) {
  try {
    execFileSync(
      'terminal-notifier',
      ['-title', title, '-message', message, '-sound', 'default'],
      { stdio: 'ignore', timeout: 5000 }
    );
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Linux — notify-send로 알림 발송.
 * @param {string} title
 * @param {string} message
 * @returns {boolean} 성공 여부
 */
function sendViaNotifySend(title, message) {
  try {
    execFileSync('notify-send', [title, message], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * echo fallback — 알림 도구가 없거나 CI 환경일 때 사용.
 * @param {string} title
 * @param {string} message
 */
function sendViaEcho(title, message) {
  process.stdout.write(`[built notify] ${title}: ${message}\n`);
}

// ---------------------------------------------------------------------------
// 통합 알림 함수
// ---------------------------------------------------------------------------

/**
 * 플랫폼에 맞는 알림을 발송한다. 모든 경우에 오류 없이 동작한다.
 *
 * @param {string} title    알림 제목
 * @param {string} message  알림 내용
 */
function notify(title, message) {
  title = sanitizeText(title);
  message = sanitizeText(message);

  if (isCI()) {
    sendViaEcho(title, message);
    return;
  }

  const platform = detectPlatform();

  if (platform === 'macos') {
    if (sendViaOsascript(title, message)) return;
    if (commandExists('terminal-notifier') && sendViaTerminalNotifier(title, message)) return;
    sendViaEcho(title, message);
    return;
  }

  if (platform === 'linux') {
    if (commandExists('notify-send') && sendViaNotifySend(title, message)) return;
    sendViaEcho(title, message);
    return;
  }

  // 기타 플랫폼 (Windows 등)
  sendViaEcho(title, message);
}

// ---------------------------------------------------------------------------
// 메시지 생성
// ---------------------------------------------------------------------------

/**
 * built pipeline hookpoint 기반 알림 메시지를 생성한다.
 *
 * @param {string} hookPoint  after_do | after_check | after_report | ...
 * @param {string} feature    feature 이름
 * @returns {{ title: string, message: string }}
 */
function buildPipelineMessage(hookPoint, feature) {
  const phase = PHASE_LABELS[hookPoint] || hookPoint;
  const title = 'built';

  let message;
  if (hookPoint === 'after_report') {
    message = `${feature} — Report 완료 (파이프라인 종료)`;
  } else if (hookPoint.startsWith('after_')) {
    message = `${feature} — ${phase} 완료`;
  } else if (hookPoint.startsWith('before_')) {
    message = `${feature} — ${phase}`;
  } else {
    message = `${feature} — ${hookPoint}`;
  }

  return { title: sanitizeText(title), message: sanitizeText(message) };
}

/**
 * Claude Code lifecycle 이벤트 기반 알림 메시지를 생성한다.
 *
 * @param {string} eventName   WorktreeCreate | WorktreeRemove
 * @param {object} payload     Claude Code hook payload (JSON)
 * @returns {{ title: string, message: string }}
 */
function buildLifecycleMessage(eventName, payload) {
  const title = 'built';
  const worktreePath = payload.worktree_path || payload.worktreePath || '';
  // worktree 경로에서 feature 이름 추출 (마지막 디렉토리명)
  const worktreeName = worktreePath ? worktreePath.split('/').filter(Boolean).pop() : '';

  let message;
  if (eventName === 'WorktreeCreate') {
    message = worktreeName
      ? `Worktree 생성됨: ${worktreeName}`
      : 'Worktree가 생성되었습니다.';
  } else if (eventName === 'WorktreeRemove') {
    message = worktreeName
      ? `Worktree 제거됨: ${worktreeName}`
      : 'Worktree가 제거되었습니다.';
  } else {
    message = `lifecycle: ${eventName}`;
  }

  return { title: sanitizeText(title), message: sanitizeText(message) };
}

// ---------------------------------------------------------------------------
// stdin 읽기 (Claude Code hook JSON payload)
// ---------------------------------------------------------------------------

/**
 * stdin에서 JSON payload를 읽는다. stdin이 TTY이거나 데이터 없으면 null 반환.
 * @returns {Promise<object|null>}
 */
function readStdinJson() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve(null);
      return;
    }

    let raw = '';
    const rl = readline.createInterface({ input: process.stdin });

    rl.on('line', (line) => { raw += line; });
    rl.on('close', () => {
      if (!raw.trim()) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        resolve(null);
      }
    });

    // 500ms 내에 데이터 없으면 null
    setTimeout(() => {
      rl.close();
      resolve(null);
    }, 500);
  });
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  // 1. stdin에서 Claude Code lifecycle hook JSON payload 시도
  const stdinPayload = await readStdinJson();

  if (stdinPayload && stdinPayload.hook_event_name) {
    // Claude Code lifecycle hook 모드
    const eventName = stdinPayload.hook_event_name;
    const { title, message } = buildLifecycleMessage(eventName, stdinPayload);
    notify(title, message);
    process.exit(0);
    return;
  }

  // 2. CLI 인자 모드: node scripts/notify.js <hook-point> [feature]
  const cliHookPoint = process.argv[2];
  const cliFeature   = process.argv[3];

  // 3. 환경변수 모드: BUILT_HOOK_POINT + BUILT_FEATURE
  const envHookPoint = process.env.BUILT_HOOK_POINT;
  const envFeature   = process.env.BUILT_FEATURE;

  const hookPoint = cliHookPoint || envHookPoint;
  const feature   = cliFeature   || envFeature;

  if (!hookPoint) {
    process.stderr.write('Usage: node scripts/notify.js <hook-point> [feature]\n');
    process.stderr.write('       BUILT_HOOK_POINT=after_do BUILT_FEATURE=user-auth node scripts/notify.js\n');
    process.exit(1);
    return;
  }

  // lifecycle 이벤트를 CLI 인자로 전달한 경우
  if (LIFECYCLE_EVENTS.has(hookPoint)) {
    const { title, message } = buildLifecycleMessage(hookPoint, { worktree_path: feature || '' });
    notify(title, message);
    process.exit(0);
    return;
  }

  // pipeline hookpoint
  const featureName = feature || '(unknown)';
  const { title, message } = buildPipelineMessage(hookPoint, featureName);
  notify(title, message);
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[built notify] 오류: ${err.message}\n`);
    process.exit(1);
  });
}

// ---------------------------------------------------------------------------
// exports (테스트용)
// ---------------------------------------------------------------------------

module.exports = {
  isCI,
  detectPlatform,
  commandExists,
  buildPipelineMessage,
  buildLifecycleMessage,
  notify,
};
