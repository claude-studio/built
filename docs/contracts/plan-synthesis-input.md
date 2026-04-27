# built plan_synthesis input contract

작성일: 2026-04-26 KST

`plan_synthesis`는 interactive discovery 이후 provider가 실행 계획을 구조화하는 phase다. 이 문서는 provider가 받는 입력 계약을 정의한다.

## 목적

Claude와 Codex가 같은 `do` 입력을 받을 수 있게, 구현 전에 계획을 명시적인 산출물로 고정한다.

## 역할 분리

- interactive discovery: host session이 담당
- plan_synthesis: provider가 수행 가능
- do: 확정된 plan_synthesis 결과를 입력으로 구현

Codex provider는 host session의 대화 기억을 볼 수 없다고 가정한다. 따라서 필요한 정보는 모두 payload에 포함해야 한다.

## 입력 payload

```json
{
  "feature_id": "user-auth",
  "feature_spec_path": ".built/features/user-auth.md",
  "feature_spec_source": {
    "source": "control_root",
    "source_root": "/repo",
    "requested_path": ".built/features/user-auth.md",
    "resolved_path": "/repo/.built/features/user-auth.md"
  },
  "feature_spec": "Markdown 원문",
  "questions": [
    {
      "id": "q1",
      "question": "로그인 방식은 무엇인가요?"
    }
  ],
  "answers": [
    {
      "question_id": "q1",
      "answer": "이메일/비밀번호 로그인"
    }
  ],
  "repo_context": {
    "root": "/repo",
    "summary": "프로젝트 구조 요약",
    "relevant_files": [
      {
        "path": "src/auth.js",
        "summary": "기존 인증 helper"
      }
    ]
  },
  "prior_art": [
    {
      "path": "kg/decisions/worktree-orchestration-pattern.md",
      "summary": "worktree 실행 패턴"
    }
  ],
  "acceptance_criteria": [
    "사용자는 이메일과 비밀번호로 로그인할 수 있다."
  ],
  "constraints": [
    "기존 public API를 깨지 않는다."
  ]
}
```

## 출력 기대값

`plan_synthesis`는 다음 정보를 포함해야 한다.

```json
{
  "summary": "구현 계획 요약",
  "steps": [
    {
      "id": "step-1",
      "title": "인증 helper 확장",
      "files": ["src/auth.js"],
      "intent": "이메일/비밀번호 인증 로직 추가"
    }
  ],
  "acceptance_criteria": [
    {
      "criterion": "사용자는 이메일과 비밀번호로 로그인할 수 있다.",
      "verification": "npm test"
    }
  ],
  "risks": [
    "기존 세션 저장 방식과 충돌 가능성"
  ],
  "out_of_scope": [
    "소셜 로그인"
  ]
}
```

## 불변 조건

- `plan_synthesis`는 파일을 수정하지 않는다.
- `plan_synthesis`는 구현 provider와 달라도 된다.
- `do`는 같은 plan_synthesis 산출물을 입력으로 받아야 한다.
- provider가 달라도 `feature_spec`, `acceptance_criteria`, `constraints`는 동일해야 한다.
- `/built:run`이 execution worktree cwd에서 `plan_synthesis`를 실행하더라도 feature spec source of truth는 control root(`BUILT_PROJECT_ROOT`)다.
- `run-request.json`의 `planPath`가 absolute 또는 relative여도 같은 control root 기준의 `feature_spec_source.resolved_path`로 정규화되어야 한다.
- `root-context.json`과 `plan-synthesis.json`은 `feature_spec_source.source`, `source_root`, `requested_path`, `resolved_path`를 기록해 Design artifact만 보고 spec 기준을 확인할 수 있어야 한다.

## 저장 위치 후보

초기 후보:

```text
.built/features/<feature>/plan-synthesis.json
.built/features/<feature>/plan-synthesis.md
```

정확한 저장 형식은 PR에서 확정한다. 단, `do` phase가 읽는 canonical path는 하나여야 한다.
