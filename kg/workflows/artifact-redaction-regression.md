---
id: WF-26
title: Artifact Redaction Regression
type: workflow
date: 2026-04-27
validated_by: [BUI-224]
tags: [security, artifact, redaction, validation, regression]
---

## 패턴 설명

artifact, log, report, notification처럼 사용자-facing 경로로 재사용될 수 있는 산출물을 추가하거나 바꿀 때는 redaction helper와 fixture 테스트를 함께 갱신한다.
핵심은 public summary에는 안전한 사용자 조치만 남기고, raw provider detail은 sanitize 후 디버그 전용 계층에만 두는 것이다.

## 언제 사용하나

- `scripts/sanitize.js`의 secret/path masking 규칙을 바꿀 때
- `src/progress-writer.js` 또는 `src/providers/standard-writer.js`의 artifact 저장 경로를 바꿀 때
- provider comparison report, smoke artifact, status/report/result markdown 형식을 바꿀 때
- Telegram 또는 외부 notification 문구에 provider failure 정보를 포함할 때
- provider별 token, chat id, local daemon path, workspace path 형식이 새로 확인될 때
- `docs/contracts/file-contracts.md`, `docs/contracts/smoke-artifact.md`, `docs/ops/provider-comparison-mode.md`의 public/private 진단 경계를 갱신할 때

## 단계

1. 산출물이 public summary인지 debug-only 계층인지 먼저 분류한다.
   public summary에는 raw provider stderr/stdout, token, chat id, workspace UUID, private workspace path, local daemon path, `debug_detail`을 넣지 않는다.
2. public artifact writer는 저장 직전 `sanitizeText()` 또는 `sanitizeJson()`을 통과하는지 확인한다.
3. private workspace path 후보는 전체 path가 `[REDACTED_WORKSPACE]`로 치환되는지 검증한다.
   UUID만 제거하고 `/workdir/...` 같은 tail이 남는 상태를 허용하지 않는다.
4. token/API key/authorization 후보, Telegram bot token, `chat_id`, named secret field fixture를 포함한다.
5. provider raw error가 필요한 경우 `failure.debug_detail` 또는 로그 계층에 sanitize 후 보관하고, progress/state/result/notification에는 safe user message와 action만 남긴다.
6. comparison artifact는 `report.md`, `manifest.json`, `input-snapshot.json`, candidate별 `run-request.json`, `progress.json`, `verification.json`을 각각 sanitizer 경유 대상으로 본다.
7. smoke artifact는 저장 전 `sanitizeJson()`을 적용하고, raw debug dump 또는 private environment value를 schema에 넣지 않는다.
8. notification 테스트는 문구에 token, chat id, workspace UUID, private path fragment가 남지 않는지 확인한다.
9. 문서 계약을 바꿨다면 테스트가 같은 계약을 검증하는지 확인한다.
   특히 file contract 테스트에는 public summary 금지 필드와 debug-only 허용 경계를 같이 둔다.
10. 최소 검증으로 `node test/sanitize.test.js`, 변경된 writer/report/notification 테스트, `node test/file-contracts.test.js`를 실행한다.
11. 범위가 provider artifact 전반이면 `npm test`까지 실행하고 handoff에 개별 테스트와 전체 결과를 남긴다.

## 주의사항

- sanitizer fixture는 완전한 secret scanner 제품이 아니다.
  새 provider나 외부 도구가 다른 secret/path 형식을 만들면 fixture를 추가해야 한다.
- 홈 경로 축약과 private workspace path redaction은 목적이 다르다.
  public artifact에서 workspace path는 tail까지 남기지 않는 전체 치환을 사용한다.
- `debug_detail`을 public summary로 승격하지 않는다.
  사용자가 볼 문구에는 조치 중심의 안전한 요약만 남긴다.
- writer 경로를 우회하는 `fs.writeFileSync`나 `fs.copyFileSync`를 추가하면 sanitizer 적용 여부를 별도로 검증해야 한다.
- KG와 문서에는 raw execution dump, secret, private environment value, workspace UUID, 실제 로컬 경로를 기록하지 않는다.
