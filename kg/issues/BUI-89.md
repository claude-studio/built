---
id: BUI-89
title: "[도그푸딩] built:run 실패: http-request-capture (check 단계 --bare 인증 오류)"
type: issue
date: 2026-04-25
status: completed
agent: 개발
branch: bui-89
pr: https://github.com/claude-studio/built/pull/51
week: 17
tags: [dogfooding, check, bugfix, pipeline-runner, bare, auth]
keywords: [pipeline-runner --bare 인증 Not-logged-in check.js jsonSchema _runPipelineJson 캐시]
---

## 목표

http-request-capture feature의 check 단계가 `--bare` 플래그로 인해 인증 오류(`Not logged in`)로 실패하는 문제를 해결.
Do→Check→Iter→Report 전체 파이프라인 완료 보장.

## 구현 내용

`src/pipeline-runner.js`의 `_runPipelineJson` 함수에서 `--bare` 플래그 제거.
이미 PR #48(`e8db7bb`)에서 수정 완료된 상태.

변경 전: `const args = ['--bare', '-p', '--output-format', 'json', '--json-schema', jsonSchema];`
변경 후: `const args = ['-p', '--output-format', 'json', '--json-schema', jsonSchema];`

BUI-89 작업 시점에는 수정이 이미 main에 반영되어 있어,
소스 스크립트(`~/Desktop/jb/built/scripts/`)를 직접 실행하는 방식으로 파이프라인 검증 완료.
check 결과: **approved**, report 생성 완료.

## 결정 사항

- `--bare` 플래그는 multica 에이전트 런타임과 별도의 인증 컨텍스트를 요구하므로 제거.
- `jsonSchema` 모드에서도 부모 프로세스의 인증 환경(`process.env`)을 그대로 상속하도록 처리.

## 발생한 이슈

- 플러그인 캐시(`949c21a2c3e8`)가 오래된 버전으로 남아 있어 수정 후에도 캐시 버전은 `--bare`를 유지.
- 캐시 업데이트 전까지는 소스 스크립트를 직접 실행하는 우회 방법 필요.
- 연쇄 해결: BUI-86/87/88 (after_check, before_report, after_report 훅 미실행) — check 단계 성공으로 자동 해소.

## 완료 기준 충족 여부

- check 단계에서 'Not logged in' 오류 없이 정상 실행: 완료 (approved)
- Do→Check→Iter→Report 파이프라인 전체 완료: 완료 (report.md 생성)
- --bare 플래그 제거: 완료 (PR #48)

## 재발 방지 포인트

- `claude -p` 서브세션 호출 시 `--bare` 플래그는 별도 인증을 요구하므로 사용 금지.
- 플러그인 캐시가 오래된 버전으로 남을 수 있으므로, 핵심 수정 후 캐시 갱신 절차 확인 필요.
- `_runPipelineJson`처럼 jsonSchema를 사용하는 경로도 동일하게 `--bare` 없이 실행되도록 일관성 유지.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-89",
  "name": "[도그푸딩] built:run 실패: http-request-capture",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/51"},
  "actionStatus": "CompletedActionStatus"
}
```
