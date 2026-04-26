# smoke artifact 계약

작성일: 2026-04-26 KST

이 문서는 real provider smoke 실행 결과로 생성되는 summary artifact의 스키마를 정의한다.

## 저장 경로

```text
.built/runtime/smoke/<id>/summary.json
```

- `<id>`: `YYYYMMDDTHHmmss` 형식 타임스탬프 (로컬 시간 기준)
- `.built/runtime/smoke/`는 `.gitignore`에 포함 (버전 관리 대상 아님)
- `npm test`에서는 생성되지 않음 (opt-in smoke 전용)

## schema_version

현재: `1.0.0`

하위 호환이 깨지는 변경 시 major를 올린다.

## 필드 정의

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `schema_version` | string | O | 스키마 버전 (`1.0.0`) |
| `id` | string | O | 타임스탬프 기반 고유 ID |
| `created_at` | string | O | ISO 8601 생성 시각 |
| `provider` | string | O | provider 이름 (`codex`) |
| `phase` | string | O | 실행 phase (`plan_synthesis`, `do`) |
| `model` | string\|null | O | 사용된 모델 (알 수 없으면 `null`) |
| `duration_ms` | number | O | 실행 시간 (밀리초) |
| `skipped` | boolean | O | opt-in 환경변수 없이 skip된 경우 `true` |
| `success` | boolean | O | 성공 여부 |
| `failure` | object\|null | O | 실패 시 원인 정보, 성공/skip 시 `null` |
| `failure.kind` | string | - | failure taxonomy 값 |
| `failure.message` | string\|null | - | 한글 실패 요약 |
| `verification` | object\|null | O | 검증 명령 결과 (phase별 다름) |

## failure taxonomy

| kind | 의미 | 조치 |
|------|------|------|
| `provider_unavailable` | Codex CLI 미설치 또는 PATH 문제 | `npm install -g @openai/codex` |
| `app_server` | Codex CLI가 `app-server` 미지원 | CLI 최신 버전 업데이트 |
| `auth` | Codex 인증 실패 | `codex login` 실행 |
| `sandbox` | sandbox 설정 불일치 | `sandbox=workspace-write` 확인 |
| `timeout` | 실행 시간 초과 (20분) | 네트워크 확인, `timeout_ms` 조정 |
| `model_response` | 모델 출력 파싱 실패 또는 구조 불일치 | 로그 확인 |
| `unknown` | 미분류 | 로그 확인 |

## verification 예시

### plan_synthesis 성공

```json
{
  "verification": {
    "plan_steps": 5
  }
}
```

### do 성공

```json
{
  "verification": {
    "do_result_exists": true,
    "frontmatter_complete": true,
    "feature_id_match": true,
    "status_completed": true
  }
}
```

## secret redaction 정책

artifact 저장 전 `scripts/sanitize.js`의 `sanitizeJson()`이 적용된다.

redaction 대상:
- API 키 패턴: `sk-ant-*`, `sk-proj-*`, `sk-*` (20자 이상), `ghp_*`, `github_pat_*`
- 홈 경로: `/Users/<name>/...`, `/home/<name>/...` → `~/...`
- Multica workspace/daemon private path 후보: `~/multica_workspaces/<workspace-id>/...`, Codex local daemon path
- session_id 값
- Telegram bot token, `chat_id`
- `token`, `secret`, `api_key`, `authorization` 같은 명명된 필드 값
- SAFE_KEYS에 없는 환경변수 값

저장하지 않는 정보:
- secret, token 원문
- chat id 원문
- workspace UUID 또는 local daemon path 원문
- local raw debug dump
- provider 내부 디버그 출력

## 불변 조건

- `npm test`에서는 artifact 생성이 강제되지 않는다.
- artifact는 외부 telemetry로 전송하지 않는다.
- artifact 경로는 `.built/runtime/smoke/` 하위로 고정한다.
- schema_version이 바뀌면 이 문서도 함께 갱신한다.
