# Queue Tick project_id 진단

이 절차는 Queue Tick 또는 backlog drain이 built 프로젝트 기준 ready backlog를 0건으로
판정할 때 `project_id` 누락 가능성을 확인하기 위한 운영 점검이다. Multica 서버의 프로젝트
매칭 로직은 변경하지 않고, 이슈 생성과 코멘트 evidence를 보강한다.

## 기준값

- built project_id: `068c9ad8-8efe-4692-9bf7-3521ddc06588`
- 점검 대상 상태: `backlog`
- 코멘트 시각: KST(Asia/Seoul)

## 점검 명령

built 프로젝트에 정상 연결된 ready backlog 수를 확인한다.

```bash
multica issue list --status backlog --limit 250 --output json \
  | jq --arg project_id "068c9ad8-8efe-4692-9bf7-3521ddc06588" \
    '[.issues[] | select(.project_id == $project_id)] | length'
```

`project_id`가 비어 있어 built backlog에서 누락됐을 가능성이 있는 이슈를 확인한다. `BUI-`
식별자를 가진 backlog를 built 관련 의심 건으로 본다.

```bash
multica issue list --status backlog --limit 250 --output json \
  | jq '[.issues[]
    | select((.project_id == null or .project_id == "")
      and (.identifier | startswith("BUI-")))
    | {identifier, title, status, project_id}]'
```

페이지네이션이 필요한 경우 `has_more`가 `true`인지 확인하고 `--offset`을 늘려 같은 필터를
반복한다.

```bash
multica issue list --status backlog --limit 250 --offset 250 --output json \
  | jq '{total, has_more, checked: (.issues | length)}'
```

## Queue Tick 코멘트 형식

Queue Tick이 ready backlog 0건으로 종료될 때는 다음 정보를 이슈 코멘트에 남긴다.

```text
YYYY-MM-DD HH:mm KST Queue Tick project_id 점검 결과입니다.
- built project_id 기준 ready backlog: <N>건
- project_id 누락 의심 backlog: <M>건
- 다음 처리: <선택한 이슈 또는 0건 종료 사유>
- 확인 명령: `multica issue list --status backlog --limit 250 --output json`
```

`project_id` 누락 의심 건이 1건 이상이면 Coordinator 판단으로 해당 이슈의 project 보정 또는
backlog 재생성을 결정한다. Builder, Reviewer, Recorder, Finisher는 임의로 project 보정을
수행하지 않는다.

## 생성 규칙

새 Queue Tick 또는 built backlog를 만들 때는 프로젝트 이름 대신 실제 project_id를 사용한다.

```bash
multica issue create \
  --project 068c9ad8-8efe-4692-9bf7-3521ddc06588 \
  --title "<한글 제목>" \
  --description "<한글/KST 설명>" \
  --status backlog
```

Queue Tick은 backlog 후보가 아니라 실행 트리거이므로 생성 즉시 `in_progress`와 Coordinator
assignee를 함께 지정한다.

```bash
multica issue create \
  --project 068c9ad8-8efe-4692-9bf7-3521ddc06588 \
  --parent <완료/blocked 이슈 ID> \
  --title "[Queue] <이슈번호> 완료 후 backlog drain" \
  --description "<한글/KST Queue Tick 설명>" \
  --status in_progress \
  --assignee Coordinator
```

생성 후에는 `multica issue get <issue-id> --output json`으로 `project_id`가
`068c9ad8-8efe-4692-9bf7-3521ddc06588`인지 확인한다.
