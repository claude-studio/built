---
id: ADR-22
title: Queue Tick과 built backlog 생성은 실제 project_id를 기준으로 한다
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-185
tags: [ops, queue, backlog, project-id, coordinator]
---

## 컨텍스트

BUI-172 운영에서 새 backlog가 `project_id` 없이 생성되면 built 프로젝트 기준 Queue Tick 조회에서 ready backlog가 0건으로 보일 수 있다는 문제가 확인됐다. BUI-185는 Multica 서버의 프로젝트 매칭 로직을 바꾸지 않고 Queue Tick 생성과 backlog drain 운영 지침을 보강하는 범위였다.

## 결정

Queue Tick, Queue Recovery Tick, built backlog 생성은 프로젝트 이름 추정 대신 실제 built `project_id`인 `068c9ad8-8efe-4692-9bf7-3521ddc06588`를 직접 지정한다.

Queue Tick이 ready backlog 0건으로 종료될 때는 built project_id 기준 ready backlog 수와 `project_id` 누락 의심 backlog 수를 함께 코멘트에 남긴다. `project_id`가 비어 있고 `BUI-` 식별자를 가진 backlog는 built 관련 누락 의심 후보로 본다.

## 근거

- built 프로젝트 기준 조회는 `project_id`가 설정된 이슈를 기준으로 해석되므로, 값이 비어 있으면 실제 backlog가 있어도 Queue Tick에서 제외될 수 있다.
- 프로젝트 이름은 표시값 또는 CLI/API 매칭 정책에 의존하지만, `project_id`는 운영 대상 프로젝트를 직접 가리키는 안정적인 식별자다.
- ready backlog 0건 판단은 후속 작업 생성 여부를 결정하므로, 누락 가능성까지 evidence로 남겨야 운영자가 같은 장애를 반복 조사하지 않는다.
- 서버 로직 변경은 비범위였기 때문에 운영 문서, 역할 지침, 진단 템플릿을 보강하는 방식이 가장 좁은 해결책이다.

## 결과

- Coordinator는 backlog drain 또는 Queue Tick 종료 전 `project_id` 누락 가능성을 확인한다.
- Operator와 Finisher는 새 Queue Tick 또는 Queue Recovery Tick 생성 시 `--project 068c9ad8-8efe-4692-9bf7-3521ddc06588`를 사용한다.
- 생성 후 `multica issue get <issue-id> --output json`으로 `project_id`가 기대값인지 확인한다.
- 누락 의심 건이 있으면 임의 보정하지 않고 Coordinator 판단으로 넘긴다.

## 대안

1. **프로젝트 이름으로 계속 생성**: CLI/API 매칭 정책에 의존하고 BUI-172와 같은 누락을 반복할 수 있어 선택하지 않았다.
2. **Multica 서버의 프로젝트 매칭 로직 변경**: 이슈 비범위였고 운영 지침 보강만으로 현재 장애 모드를 줄일 수 있어 선택하지 않았다.
3. **ready backlog 0건이면 그대로 종료**: 누락 여부를 관측하지 못해 Queue Tick이 조용히 멈출 수 있으므로 선택하지 않았다.

## 되돌릴 조건

Multica 서버가 project 이름 기반 생성과 project 누락 보정을 신뢰할 수 있는 계약으로 제공하고, Queue Tick 조회가 project 누락 후보를 별도로 노출한다면 이 정책은 서버 계약 기준으로 재검토할 수 있다.

```json-ld
{
  "@context": "https://schema.org",
  "@type": "Decision",
  "identifier": "ADR-22",
  "name": "Queue Tick과 built backlog 생성은 실제 project_id를 기준으로 한다",
  "about": "Queue Tick project_id policy",
  "isBasedOn": "BUI-185"
}
```
