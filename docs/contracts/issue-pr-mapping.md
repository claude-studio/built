---
title: Issue-PR-Branch Mapping 계약
scope: ops
created: 2026-04-26
updated: 2026-04-26
related_issues: [BUI-229]
tags: [ops, mapping, pr, branch, kg, manifest]
---

# Issue-PR-Branch Mapping 계약

## 1. 목적

이슈 하나가 어떤 branch, PR, merge commit, KG 파일과 연결됐는지 단일 위치에서
추적 가능하게 한다. 중복 PR 생성을 방지하고 누락된 KG 기록을 줄인다.

---

## 2. SSOT 위치

**`kg/issues/BUI-<N>.md` 파일의 YAML frontmatter**가 해당 이슈의 mapping SSOT다.

```yaml
---
id: BUI-N
title: 이슈 제목
type: issue
date: YYYY-MM-DD
status: completed | blocked | rejected
agent: 에이전트 이름
branch: agent/builder/<run-id>        # Builder가 PR 생성 시 기록
pr: https://github.com/...            # Builder가 PR 생성 시 기록
merge_commit: <sha>                   # Finisher가 merge 후 기록
kg_files: [kg/issues/BUI-N.md, ...]  # Recorder가 KG 기록 완료 시 기록
week: N
tags: [...]
keywords: [...]
---
```

각 필드의 업데이트 시점과 담당자는 아래 3절에 정의한다.

---

## 3. 필드별 업데이트 책임

| 필드 | 업데이트 시점 | 담당 역할 |
|------|--------------|-----------|
| `branch` | PR 생성 또는 첫 push 직후 | Builder |
| `pr` | PR 생성 직후 | Builder |
| `merge_commit` | squash merge 완료 직후 | Finisher |
| `kg_files` | KG 기록 commit 완료 직후 | Recorder |

---

## 4. Builder: PR 생성 시 mapping 기록 절차

1. PR 생성 전 `gh pr list --search "BUI-<N>"` 또는 `gh pr list --head <branch>`로
   같은 이슈 번호의 open PR이 있는지 확인한다.
2. **기존 open PR이 있으면** 새 PR을 만들지 않고 기존 branch/PR에 추가 commit을 push한다.
3. **기존 open PR이 없으면** 새 PR을 생성하고, 완료 즉시 `kg/issues/BUI-<N>.md`에
   `branch`와 `pr` 필드를 기록한다.
4. `kg/issues/BUI-<N>.md`가 아직 없으면 스켈레톤을 생성해 `branch`와 `pr`만 채운다.
   나머지 섹션은 Recorder가 채운다.

### 스켈레톤 예시

```markdown
---
id: BUI-N
title: 이슈 제목
type: issue
date: YYYY-MM-DD
status: in_progress
agent: Builder
branch: agent/builder/<run-id>
pr: https://github.com/claude-studio/built/pull/<N>
merge_commit: ""
kg_files: []
week: N
tags: []
keywords: []
---
```

스켈레톤은 같은 PR branch에 포함해 push한다.

---

## 5. Reviewer: mapping 참조 절차

Reviewer는 handoff comment에서 다음 항목을 참조한다:

- `kg/issues/BUI-<N>.md`의 `branch`와 `pr`이 실제 PR 정보와 일치하는지 확인한다.
- 일치하지 않으면 FAIL 사유에 mapping 불일치를 포함한다.
- 새 PR을 직접 생성하거나 branch를 변경하지 않는다.

---

## 6. Recorder: KG 기록 완료 시 mapping 업데이트

Recorder는 KG 파일 작성 commit이 완료된 직후:

1. `kg/issues/BUI-<N>.md` frontmatter의 `kg_files` 필드에 생성/수정한 KG 파일 경로를
   기록한다.
2. `status`를 `completed` 또는 `blocked`로 업데이트한다.
3. 이 변경은 같은 PR head branch의 별도 commit으로 push한다.

---

## 7. Finisher: merge 후 mapping 완결

Finisher는 squash merge 완료 직후:

1. merge commit SHA를 확인한다: `gh pr view <N> --json mergeCommit`
2. `kg/issues/BUI-<N>.md` frontmatter의 `merge_commit` 필드에 SHA를 기록한다.
3. 이 변경은 main에 직접 commit한다 (merge 이후이므로 branch는 이미 삭제됨).

---

## 8. 중복 PR 발견 시 정리 절차

1. `gh pr list --search "BUI-<N>"` 또는 `gh pr list --head <branch>`로
   같은 이슈의 open PR 목록을 조회한다.
2. `kg/issues/BUI-<N>.md`의 `pr` 필드 값이 canonical PR이다.
3. canonical PR이 아닌 open PR은 superseded 코멘트를 남기고 close한다.
4. canonical PR이 아직 mapping에 없으면 가장 최신 open PR을 canonical로 간주하고
   mapping에 기록한다.

---

## 9. 보안 제약

mapping에 기록하지 않는 값:

- private token, secret, API key
- 내부 daemon host 경로 (`~/multica_workspaces/...`)
- workspace UUID, runtime run UUID
- raw execution log, terminal 출력

기록하는 값:

- 공개 GitHub PR URL (`https://github.com/...`)
- 공개 branch명 (`agent/builder/<run-id>`)
- merge commit SHA (공개 레포의 public commit)
- KG 파일 경로 (레포 내 상대 경로)

---

## 10. 검증 방법

이슈 하나의 canonical PR을 찾으려면:

```bash
# mapping 조회
cat kg/issues/BUI-<N>.md | head -20

# PR 상태 확인
gh pr view <pr-number> --json state,headRefName,mergeCommit

# 중복 PR 확인
gh pr list --search "BUI-<N> in:title"
```
