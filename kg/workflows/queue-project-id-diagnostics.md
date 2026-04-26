---
id: WF-21
title: Queue Tick project_id 진단
type: workflow
date: 2026-04-26
validated_by: [BUI-185]
tags: [ops, queue, backlog, project-id, diagnostics, coordinator]
---

# Queue Tick project_id 진단

## 패턴 설명

Queue Tick 또는 backlog drain이 built 프로젝트 기준 ready backlog를 0건으로 판단할 때 `project_id` 누락으로 backlog가 조회에서 빠졌는지 확인하는 운영 워크플로우다. 핵심은 ready 0건 종료 전에 built project_id 기준 backlog 수와 누락 의심 후보 수를 한글/KST 코멘트로 남기는 것이다.

## 언제 사용하나

- Queue Tick이 다음 ready backlog를 찾지 못하고 종료하려 할 때
- Coordinator가 backlog drain 결과를 코멘트로 남길 때
- Operator 또는 Finisher가 새 Queue Tick이나 Queue Recovery Tick을 만들 때
- built 관련 backlog가 생성됐지만 project 기준 조회에서 보이지 않는다고 의심될 때

## 단계

1. built project_id 기준 ready backlog 수를 확인한다.
   `multica issue list --status backlog --limit 250 --output json`
2. 결과에서 `project_id == "068c9ad8-8efe-4692-9bf7-3521ddc06588"`인 이슈 수를 계산한다.
3. `project_id`가 비어 있고 `identifier`가 `BUI-`로 시작하는 backlog를 누락 의심 후보로 집계한다.
4. 응답의 `has_more`가 `true`이면 `--offset`을 늘려 같은 필터를 반복한다.
5. Queue Tick 코멘트에 KST 기준 시각, built project_id 기준 ready backlog 수, `project_id` 누락 의심 backlog 수, 다음 처리 또는 0건 종료 사유를 남긴다.
6. 누락 의심 건이 있으면 Coordinator 판단으로 project 보정 또는 backlog 재생성을 결정한다.

## 생성 절차

새 built backlog나 Queue Tick을 만들 때는 프로젝트 이름 대신 실제 project_id를 지정한다.

```bash
multica issue create \
  --project 068c9ad8-8efe-4692-9bf7-3521ddc06588 \
  --title "<한글 제목>" \
  --description "<한글/KST 설명>" \
  --status backlog
```

Queue Tick은 생성 즉시 실행 대상이므로 `in_progress`와 Coordinator assignee를 함께 지정한다.

```bash
multica issue create \
  --project 068c9ad8-8efe-4692-9bf7-3521ddc06588 \
  --parent <완료/blocked 이슈 ID> \
  --title "[Queue] <이슈번호> 완료 후 backlog drain" \
  --description "<한글/KST Queue Tick 설명>" \
  --status in_progress \
  --assignee Coordinator
```

생성 후에는 `multica issue get <issue-id> --output json`으로 `project_id`가 기대값인지 확인한다.

## 주의사항

- Builder, Reviewer, Recorder, Finisher는 누락 의심 이슈의 project를 임의로 보정하지 않는다.
- raw issue list 전체를 코멘트에 붙이지 말고 집계 숫자와 필요한 식별자만 남긴다.
- KST 시각만 사용자에게 보이는 이슈 코멘트에 남긴다.
- `has_more=true`인 상태에서 첫 페이지만 보고 0건 종료로 판단하지 않는다.
- 이 절차는 Multica 서버의 프로젝트 매칭 로직을 대체하지 않는다.

## 실패 시 복구

- 누락 의심 후보가 있으면 해당 후보의 identifier, title, 현재 status, project_id 상태만 요약해 Coordinator 판단으로 넘긴다.
- `multica issue list` 결과가 페이지네이션으로 잘렸으면 offset별 확인 결과를 코멘트에 남기고 재시도한다.
- 새 Queue Tick 생성 후 `project_id`가 기대값과 다르면 즉시 추가 Tick 생성을 멈추고 Coordinator 판단을 요청한다.

## 참고

- 정책 전문: `docs/ops/queue-project-id-diagnostics.md`
- 관련 결정: `kg/decisions/queue-tick-project-id-policy.md`
- 관련 이슈: `kg/issues/BUI-185.md`

```json-ld
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "identifier": "WF-21",
  "name": "Queue Tick project_id 진단",
  "tool": ["multica issue list", "multica issue get", "multica issue create"],
  "about": "Queue Tick backlog project_id diagnostics"
}
```
