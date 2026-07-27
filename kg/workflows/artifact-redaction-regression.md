---
id: WF-26
title: Artifact Redaction Regression
type: workflow
date: 2026-04-27
validated_by: [BUI-224, BUI-93]
tags: [security, artifact, redaction, validation, regression, pre-commit, worktree, jsonl]
---

## 패턴 설명

artifact, log, report, notification처럼 사용자-facing 경로로 재사용될 수 있는 산출물을 추가하거나 바꿀 때는 redaction helper와 fixture 테스트를 함께 갱신한다.
핵심은 public summary에는 안전한 사용자 조치만 남기고, raw provider detail은 sanitize 후 디버그 전용 계층에만 두는 것이다.
저장 전 writer redaction과 별개로 커밋 가능한 `.built/runs/`, `.built/features/` public artifact는 sanitize CLI와 staged-blob pre-commit hook이라는 마지막 안전망도 같은 구조 보존 규칙으로 통과한다.

## 언제 사용하나

- `scripts/sanitize.js`의 secret/path masking 규칙을 바꿀 때
- `src/progress-writer.js` 또는 `src/providers/standard-writer.js`의 artifact 저장 경로를 바꿀 때
- provider comparison report, smoke artifact, status/report/result markdown 형식을 바꿀 때
- Telegram 또는 외부 notification 문구에 provider failure 정보를 포함할 때
- provider별 token, chat id, local daemon path, workspace path 형식이 새로 확인될 때
- `docs/contracts/file-contracts.md`, `docs/contracts/smoke-artifact.md`, `docs/ops/provider-comparison-mode.md`의 public/private 진단 경계를 갱신할 때
- `.built/runs/`, `.built/features/`의 기본 sanitize 대상이나 execution worktree resultDir 의미를 바꿀 때
- `progress.json`, `logs/*.jsonl`처럼 구조가 유효해야 하는 JSON/JSONL artifact를 sanitize 대상에 추가할 때
- 설치형 pre-commit hook의 staged 파일 선택, index 갱신, 부분 stage 보존 로직을 바꿀 때

## 단계

1. 산출물이 public summary인지 debug-only 계층인지 먼저 분류한다.
   public summary에는 raw provider stderr/stdout, token, chat id, workspace UUID, private workspace path, local daemon path, `debug_detail`을 넣지 않는다.
2. current project 또는 execution worktree root에서 커밋 가능한 public artifact 경로를 식별한다.
   기본 sanitize 대상은 `.built/runs/`, `.built/features/`이며 `.built/runtime/`, 다른 worktree, project 밖 경로는 자동 탐색하지 않는다.
3. public artifact writer는 저장 직전 `sanitizeText()` 또는 `sanitizeJson()`을 통과하는지 확인한다.
   sanitize CLI와 pre-commit hook은 writer를 대체하지 않는 마지막 안전망으로 둔다.
4. JSON document는 redaction 후 전체 `JSON.parse()`가 성공하고, JSONL은 비어 있지 않은 각 줄의 `JSON.parse()`가 성공하는지 확인한다.
   숫자·boolean 민감 필드는 유효한 JSON string redaction 값으로 치환한다.
5. private workspace path 후보는 전체 path가 `[REDACTED_WORKSPACE]`로 치환되는지 검증한다.
   UUID만 제거하고 `/workdir/...` 같은 tail이 남는 상태를 허용하지 않는다.
6. token/API key/authorization 후보, Telegram bot token, `chat_id`, named secret field fixture를 포함한다.
7. provider raw error가 필요한 경우 `failure.debug_detail` 또는 로그 계층에 sanitize 후 보관하고, progress/state/result/notification에는 safe user message와 action만 남긴다.
8. comparison artifact는 `report.md`, `manifest.json`, `input-snapshot.json`, candidate별 `run-request.json`, `progress.json`, `verification.json`을 각각 sanitizer 경유 대상으로 본다.
9. smoke artifact는 저장 전 `sanitizeJson()`을 적용하고, raw debug dump 또는 private environment value를 schema에 넣지 않는다.
10. pre-commit hook은 staged `.built/runs/`, `.built/features/`의 Markdown/JSON/JSONL blob만 읽는다.
    working tree 전체를 다시 stage하지 않고 sanitize로 변경된 index entry만 갱신하며, 공백 파일명·부분 stage·index mode 보존을 fixture로 검증한다.
11. 명시 target과 기본 대상은 current project root 내부인지 확인하고 project 밖 경로 및 symlink 이탈을 거부한다.
12. notification 테스트는 문구에 token, chat id, workspace UUID, private path fragment가 남지 않는지 확인한다.
13. 문서 계약을 바꿨다면 테스트가 같은 계약을 검증하는지 확인한다.
   특히 file contract 테스트에는 public summary 금지 필드와 debug-only 허용 경계를 같이 둔다.
14. 최소 검증으로 `node test/sanitize.test.js`, hook 변경 시 `node test/install-hooks.test.js`, 변경된 writer/report/notification 테스트, `node test/file-contracts.test.js`를 실행한다.
15. 범위가 provider artifact 전반이거나 기본 sanitize/hook 경계를 바꾸면 `npm test`까지 실행하고 handoff에 개별 테스트와 전체 결과를 남긴다.

## 주의사항

- sanitizer fixture는 완전한 secret scanner 제품이 아니다.
  새 provider나 외부 도구가 다른 secret/path 형식을 만들면 fixture를 추가해야 한다.
- 홈 경로 축약과 private workspace path redaction은 목적이 다르다.
  public artifact에서 workspace path는 tail까지 남기지 않는 전체 치환을 사용한다.
- `debug_detail`을 public summary로 승격하지 않는다.
  사용자가 볼 문구에는 조치 중심의 안전한 요약만 남긴다.
- writer 경로를 우회하는 `fs.writeFileSync`나 `fs.copyFileSync`를 추가하면 sanitizer 적용 여부를 별도로 검증해야 한다.
- JSON/JSONL에 text 치환만 적용하면 숫자·boolean 민감 값에서 문법이 깨질 수 있다.
  마스킹 값 부재만 확인하지 말고 redaction 후 parse 가능성까지 검증한다.
- pre-commit hook에서 working tree 파일을 그대로 `git add`하면 unstaged 변경이 commit에 섞일 수 있다.
  staged blob과 실제로 변경된 index entry를 기준으로 갱신한다.
- execution worktree에서 sanitize를 실행할 때 다른 worktree나 repository 밖 경로를 자동 탐색하지 않는다.
  기본 대상과 명시 target 모두 current project root 경계를 유지한다.
- KG와 문서에는 raw execution dump, secret, private environment value, workspace UUID, 실제 로컬 경로를 기록하지 않는다.
