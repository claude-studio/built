# Fake Provider 로컬 개발 Quickstart

외부 Claude/Codex 인증 없이 provider flow를 개발하고 테스트하는 방법을 설명합니다.

---

## 테스트 명령 구분

| 명령 | 필요 인증 | 설명 |
|---|---|---|
| `npm test` | 없음 | 단위 테스트 + E2E 시나리오 전체 실행 (fake/offline) |
| `npm run test:e2e` | 없음 | E2E 시나리오만 실행 (fake provider 기반) |
| `npm run test:smoke:codex:plan` | Codex 인증 필요 | 실 Codex plan_synthesis smoke |
| `npm run test:smoke:codex:do` | Codex 인증 필요 | 실 Codex do phase smoke |
| `npm run test:smoke:codex` | Codex 인증 필요 | 실 Codex plan + do 전체 smoke |

**핵심 원칙**: `npm test`와 `npm run test:e2e`는 실제 provider를 호출하지 않습니다. 인증 없이 실행할 수 있습니다.

---

## 빠른 시작

```bash
# 저장소 클론 후 의존성 설치
git clone https://github.com/claude-studio/built.git
cd built
npm install

# 인증 없이 전체 테스트 실행
npm test

# E2E 시나리오만 실행
npm run test:e2e
```

---

## fake provider가 동작하는 원리

`test/e2e/` 아래의 E2E 시나리오는 실제 Claude/Codex를 호출하지 않습니다.

- **`helpers.js`의 `setupFakeScripts`**: 실제 `scripts/do.js`, `scripts/check.js` 등을 임시 fake 스크립트로 교체합니다. fake 스크립트는 호출 로그를 남기고 미리 정의된 출력 파일을 생성한 뒤 종료합니다.
- **`runPatchedRun`**: `scripts/run.js`를 패치해 fake 스크립트를 바라보도록 실행합니다.
- **`04-fake-provider-file-contracts.js`**: fake 이벤트 시퀀스를 직접 생성해 `event-normalizer` → `standard-writer` 흐름을 인증 없이 검증합니다.

실제 provider 호출이 없으므로 네트워크 연결 없이 파이프라인 전체 흐름과 파일 계약을 검증할 수 있습니다.

---

## 현재 E2E 시나리오 목록

| 파일 | 검증 내용 |
|---|---|
| `01-happy-path.js` | init → do → check[approved] → iter → report 전체 성공 경로, 산출물 파일 및 state.json 검증 |
| `02-iter-path.js` | approved/needs_changes 분기, `BUILT_MAX_ITER=1` 초과 시 동작 검증 |
| `03-abort-resume.js` | abort → state=aborted, resume → state=planned 복구 검증 |
| `04-fake-provider-file-contracts.js` | fake Claude/Codex 이벤트로 파일 계약(progress.json, do-result.md) 격리 검증 |
| `05-provider-equivalence-contracts.js` | Claude/Codex provider 동등성 계약 검증 |

---

## 새 fixture 추가 방법

### 1. 새 E2E 시나리오 추가

`test/e2e/scenarios/` 아래에 `NN-scenario-name.js` 형식으로 파일을 만듭니다. `e2e-runner.js`는 이 디렉토리의 `.js` 파일을 알파벳순으로 자동으로 실행합니다.

```js
#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  makeTmpDir, rmDir,
  initProject, createFeatureSpec,
  setupFakeScripts, runPatchedRun, readCallLog,
  assertFileExists,
} = require('../helpers');

async function main() {
  console.log('\n[E2E] 시나리오 N: 설명\n');

  const dir = makeTmpDir('e2e-my-scenario');
  try {
    initProject(dir);
    // ... 시나리오 구현
  } finally {
    rmDir(dir);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

### 2. fake 스크립트 정의

`setupFakeScripts`로 phase별 fake 동작을 정의합니다.

```js
const { fakeScriptsDir, callLogPath } = setupFakeScripts(dir, {
  'do.js': {
    exitCode: 0,
    outputFiles: [
      { fileName: 'do-result.md', content: '## 구현 완료\n' },
    ],
  },
  'check.js': {
    exitCode: 0,
    outputFiles: [
      { fileName: 'check-result.md', content: '## 검토 결과\nstatus: approved\n' },
    ],
  },
});
```

### 3. fake 이벤트 시퀀스 직접 작성

`04-fake-provider-file-contracts.js` 패턴을 참고해 `event-normalizer`와 `standard-writer`를 직접 테스트하는 경우, 이벤트 배열을 정의합니다.

```js
const { normalizeClaude } = require('../../src/providers/event-normalizer');
const { createStandardWriter } = require('../../src/providers/standard-writer');

const FAKE_CLAUDE_RAW_EVENTS = [
  { type: 'system', subtype: 'init', session_id: 'test-001', model: 'claude-opus-4-5' },
  { type: 'result', subtype: 'success', total_cost_usd: 0 },
];

const standardEvents = FAKE_CLAUDE_RAW_EVENTS.flatMap(normalizeClaude);
```

---

## fake vs real smoke 구분 기준

| 구분 | 용도 | 인증 |
|---|---|---|
| fake (offline) | 파이프라인 흐름, 파일 계약, phase 분기 로직 검증 | 불필요 |
| real smoke | 실 provider 연결, 인증 토큰, CLI 설치 상태 검증 | 필요 |

**fake로 충분한 경우**
- phase 순서(do → check → iter → report)가 올바른지 확인
- 출력 파일(do-result.md, check-result.md, report.md, state.json)의 위치와 형식 확인
- abort/resume, max_iter 초과 분기 확인
- event-normalizer, standard-writer 계약 확인

**real smoke가 필요한 경우**
- 실제 Codex CLI 설치/인증 상태 확인
- 실 모델 응답의 구조가 계약과 일치하는지 확인
- 네트워크/timeout 조건에서의 동작 확인

---

## 인증 없이 가능한 작업 범위

다음 작업은 모두 인증 없이 수행할 수 있습니다.

- `npm test` — 단위 테스트 + E2E 전체
- `npm run test:e2e` — E2E 시나리오 전체
- 새 E2E 시나리오 작성 및 검증
- `src/providers/event-normalizer.js`, `src/providers/standard-writer.js` 수정 및 테스트
- `scripts/run.js` 파이프라인 흐름 수정 및 E2E 검증
- fake fixture로 재현 가능한 버그 수정

다음 작업은 실 provider 인증이 필요합니다.

- `npm run test:smoke:codex:*` — Codex 연결 검증
- 실 모델 응답 기반 파싱 로직 검증

---

## 관련 문서

- [docs/smoke-testing.md](smoke-testing.md) — real smoke 상세 및 실패 원인 축 분류
- [test/e2e/helpers.js](../test/e2e/helpers.js) — E2E 헬퍼 API 레퍼런스
- [test/e2e/scenarios/](../test/e2e/scenarios/) — 기존 시나리오 예시
