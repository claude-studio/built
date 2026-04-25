---
id: ADR-8
title: Codex broker lifecycle 정책
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-131
tags: [architecture, provider, codex, app-server, broker, lifecycle]
---

## 컨텍스트

BUI-117의 Codex app-server provider MVP는 direct app-server spawn 중심이었다.
실제 실행에서 app-server process를 매 turn 새로 다루면 startup 비용, endpoint 전달, interrupt/timeout cleanup, stale process 정리가 반복 위험으로 남는다.

broker lifecycle을 도입하려면 provider event 계약과 runner/writer 책임 경계를 유지하면서도 process 소유권, state 파일, startup lock, 외부 endpoint, cleanup 실패 표현을 정해야 했다.

## 결정

Codex provider는 내부 broker session을 workspace cwd 기준 `.built/runtime/codex-broker.json`에 저장하고, 같은 workspace에서 살아 있는 endpoint를 재사용한다.
session state에는 endpoint, pid, pidFile, logFile, sessionDir, startedAt을 남긴다.

broker 시작은 `.built/runtime/codex-broker.lock` exclusive create로 보호한다.
이미 lock이 있으면 process 생존 여부와 TTL을 확인해 stale lock은 제거하고, 살아 있는 lock은 broker busy 오류로 반환한다.

`BUILT_CODEX_BROKER_ENDPOINT`가 있으면 외부 broker endpoint를 우선한다.
외부 endpoint는 provider가 소유하지 않는 process로 보고 timeout cleanup 대상에서 제외한다.

기존 session endpoint가 응답하면 재사용한다.
응답하지 않으면 stale session으로 보고 broker shutdown best-effort, socket/pipe, pidFile, logFile, sessionDir, state 파일 cleanup을 수행한 뒤 새 session을 시작한다.

timeout 이후 내부 broker session은 cleanup한다.
cleanup 실패는 provider result의 `cleanupError`로 남기고, terminal provider event 이후 새 event를 emit하지 않는 기존 ordering 계약은 유지한다.

## 근거

- broker endpoint 생존 여부를 기준으로 재사용하면 state 파일만 남은 stale session이 후속 실행을 막는 상황을 줄일 수 있다.
- `.built/runtime` 아래 state와 lock을 두면 workspace 단위 재사용과 cleanup 경계가 명확하다.
- 외부 endpoint는 CI, 수동 디버깅, 향후 broker supervisor에서 주입할 수 있으므로 provider가 임의로 종료하면 안 된다.
- cleanup 실패를 오류로 노출해야 stale state, socket 권한, leftover directory 문제를 인증 실패와 구분할 수 있다.
- provider event ordering은 runner/writer 계약의 일부이므로 cleanup 실패 표현은 추가 event가 아니라 result metadata로 전달하는 편이 안전하다.
- `_disableBroker` fallback을 유지하면 broker lifecycle 회귀와 direct app-server protocol 회귀를 분리해서 검증할 수 있다.

## 결과

- 같은 workspace의 살아 있는 broker endpoint는 재사용된다.
- stale broker state는 새 session 시작 전에 cleanup된다.
- lock 경합은 broker busy/startup lifecycle 문제로 드러난다.
- timeout 이후 내부 broker session state가 제거되어 후속 실행이 같은 workspace에서 다시 시작될 수 있다.
- cleanup 실패는 `cleanupError`로 남고 조용히 묻히지 않는다.
- direct spawn fallback은 broker 장애 분석과 기존 테스트 호환성을 위해 남아 있다.

## 대안

- 매 실행마다 app-server를 direct spawn한다: broker stale 문제는 줄지만 startup 비용과 timeout 이후 process 정리 책임이 매번 반복되어 선택하지 않았다.
- broker를 항상 새로 시작하고 재사용하지 않는다: state/lock 복잡도는 낮지만 broker lifecycle 정리 목표인 재사용과 stale 감지를 검증할 수 없어 선택하지 않았다.
- cleanup 실패를 로그만 남기고 성공으로 처리한다: 사용자가 후속 실행 실패 원인을 찾기 어려워 선택하지 않았다.
- 외부 endpoint도 timeout 시 종료한다: provider가 소유하지 않은 process를 종료할 수 있어 선택하지 않았다.
- cleanup 실패를 terminal provider event로 추가 emit한다: terminal event 이후 추가 event 없음 계약을 깨므로 선택하지 않았다.

## 되돌릴 조건

Codex가 공식 broker supervisor와 안정적인 lifecycle API를 제공하거나 built runner가 provider process supervisor를 갖추면 내부 state/lock 구현을 교체할 수 있다.
그 경우에도 외부 endpoint 소유권 분리, stale state cleanup, timeout 후 후속 실행 가능성, cleanup 실패 노출, terminal event ordering 계약은 유지해야 한다.
