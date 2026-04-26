---
id: ADR-25
title: artifact redaction과 public/private 진단 경계
type: decision
date: 2026-04-27
status: accepted
context_issue: BUI-224
tags: [security, artifact, redaction, provider, diagnostics]
---

## 컨텍스트

provider execution이 늘어나면서 실패 정보는 여러 경로로 복제된다.
`logs/<phase>.jsonl`, `progress.json`, `state.json`, result markdown, provider comparison report, smoke artifact, Telegram notification은 모두 같은 실패를 다르게 요약하지만, 일부는 사용자-facing 산출물로 바로 공유된다.

BUI-175는 provider failure와 `debug_detail`의 secret redaction을 보강했고, BUI-174는 smoke artifact 저장 전 `sanitizeJson()` 재사용을 결정했다.
BUI-224에서는 comparison report와 notification까지 범위가 넓어지면서 workspace UUID, private workspace path, local daemon path tail이 public artifact에 남지 않는지 명확한 경계가 필요했다.

## 결정

public artifact와 notification은 저장 또는 전송 직전에 공통 sanitizer를 거친다.
기준 helper는 `scripts/sanitize.js`의 `sanitizeText()`와 `sanitizeJson()`이다.

public 계층에는 아래 값을 남기지 않는다.

- secret, token, API key, authorization 후보 원문
- Telegram bot token, `chat_id` 원문
- workspace UUID 원문
- local daemon path와 private workspace path 원문
- private workspace path의 tail fragment
- raw provider stderr/stdout 전문
- sanitize되지 않은 `failure.debug_detail`

private workspace path 후보는 홈 경로 축약이 아니라 전체 workspace path를 `[REDACTED_WORKSPACE]`로 치환한다.
`debug_detail`은 삭제하지 않고 sanitize 후 로그나 디버그 전용 필드에만 둔다.
`progress.json`, `state.json`, result markdown, comparison `report.md`, notification 문구에는 safe user message와 조치 문장만 둔다.

## 근거

- public summary는 issue comment, PR review, notification으로 재사용될 수 있어 private identifier가 한 번 노출되면 회수하기 어렵다.
- workspace UUID만 마스킹하고 path tail을 남기면 runtime 구조와 repository 위치를 유추할 수 있다.
- raw provider detail은 장애 분석에는 필요하지만 사용자의 다음 조치와 다르다.
  따라서 public summary와 debug detail을 분리해야 조치 문장은 간결하고 안전하게 유지된다.
- sanitizer를 writer 경로에서 재사용하면 smoke, comparison, progress writer, notification이 서로 다른 redaction 기준을 갖지 않는다.
- fixture 기반 회귀 테스트는 완전한 secret scanner는 아니지만, known-risk 후보가 public artifact로 새는 회귀를 빠르게 잡을 수 있다.

## 결과

- `docs/contracts/file-contracts.md`는 public summary와 logs/debug 계층의 redaction 경계를 명시한다.
- `docs/contracts/smoke-artifact.md`와 `docs/ops/provider-comparison-mode.md`는 artifact 저장 전 공통 redaction helper 적용을 기준으로 삼는다.
- `scripts/compare-providers.js`, `src/progress-writer.js`, `src/providers/standard-writer.js`, `scripts/notify.js` 경로가 sanitize된 writer 또는 text helper를 통과한다.
- 테스트는 sanitizer 단위뿐 아니라 public artifact 생성 경로별로 token/chat id/private path fragment 부재를 검증한다.

## 대안

- 각 writer에서 provider별 redaction을 직접 구현한다: artifact 종류가 늘어날수록 기준이 갈라져 선택하지 않았다.
- workspace UUID만 마스킹하고 나머지 path tail은 남긴다: 내부 runtime 구조가 노출될 수 있어 선택하지 않았다.
- `debug_detail`을 완전히 제거한다: 운영 디버깅 단서가 사라져 장애 원인축 비교가 어려워 선택하지 않았다.
- public artifact 저장 후 별도 scanner만 실행한다: scanner 누락 또는 실행 누락 시 이미 artifact가 기록되므로 저장 전 sanitizer를 선택했다.

## 되돌릴 조건

별도 artifact store가 도입되어 접근 제어, redaction, retention, audit policy가 명시되면 public/private 계층의 저장 위치를 재검토할 수 있다.
그 경우에도 public summary에 secret, chat id, workspace UUID, private path, raw provider detail을 남기지 않는 원칙은 유지한다.

provider별 새 secret 형식이나 local daemon path 형식이 추가되면 `scripts/sanitize.js` fixture와 artifact writer 테스트를 함께 확장한다.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Decision",
  "identifier": "ADR-25",
  "name": "artifact redaction과 public/private 진단 경계",
  "about": "public artifact redaction and debug detail boundary",
  "isBasedOn": {"@type": "CreativeWork", "name": "BUI-224"}
}
```
