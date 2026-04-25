---
id: ADR-3
title: provider와 runner의 산출물 책임 경계
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-114
tags: [architecture, provider, runner, contracts]
---

## 컨텍스트

provider 전환을 시작하면서 Claude CLI 직접 호출을 `src/pipeline-runner.js`에서
`src/providers/claude.js`로 옮겨야 했다.

이때 provider가 기존처럼 `progress.json`이나 결과 markdown까지 직접 쓰면,
향후 Codex provider나 다른 provider 추가 시 provider별 파일 쓰기 방식이 갈라질 수 있다.
반대로 runner가 모든 CLI 세부 동작을 계속 알면 provider 교체 지점이 생기지 않는다.

## 결정

**provider는 CLI 실행과 이벤트 생성만 담당하고, 파일 normalize/write는 runner와 writer 계층이 담당한다.**

구체적으로 Claude provider는 `runClaude({ prompt, model, onEvent, jsonSchema })` 형태로 이벤트를 전달한다.
`pipeline-runner.js`는 `runClaude`와 `createWriter`를 연결하고,
`state.json`, `progress.json`, `do-result.md` 같은 산출물 기록은 기존 runner/writer 계약을 유지한다.

## 근거

- provider별 차이를 CLI 실행, stdout/stderr 처리, 이벤트 파싱으로 제한할 수 있다.
- 산출물 파일 구조는 provider가 아니라 built runner의 사용자-facing 계약이다.
- 파일 contract test로 `state.json`, `progress.json`, `do-result.md` 구조를 고정하면 provider 교체 중 외부 동작 회귀를 빨리 잡을 수 있다.
- `progress-writer.js`가 이미 `handleEvent` API를 제공하므로 provider는 객체 이벤트를 넘기는 얇은 경계로 충분하다.

## 결과

- `src/providers/claude.js`는 `onEvent` 콜백으로 이벤트만 전달한다.
- `src/pipeline-runner.js`는 `childProcess.spawn`을 직접 참조하지 않는다.
- `_parseTimeout`은 기존 테스트 호환을 위해 runner에서 재익스포트한다.
- file contract 테스트와 provider 단위 테스트가 provider 전환의 기본 회귀 방지 장치가 되었다.

## 대안

- provider가 파일까지 쓰기: provider 추가 시 파일 계약이 중복 구현되고 provider별 산출물 차이가 생길 위험이 크다.
- runner에 Claude spawn 로직 유지: provider 추상화가 형식만 남고 실제 교체 가능성이 낮다.
- provider가 markdown/string 산출물을 직접 반환: 이벤트 스트림 기반 진행 상태 기록과 json-schema 경로를 같은 방식으로 다루기 어렵다.

## 되돌릴 조건

향후 provider 공통 runtime이 파일 기록을 완전히 대체하고,
모든 provider가 동일한 normalize/write 계층을 공유한다는 별도 ADR이 승인될 때만 이 경계를 재검토한다.
