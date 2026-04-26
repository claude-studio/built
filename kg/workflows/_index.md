---
title: KG Workflows Index
type: index
updated: 2026-04-26
---

# Workflows

built 운영에서 반복 확인된 워크플로우 패턴 목록.

## 엔트리

- [[feature-development-loop.md]] — feature 개발 전체 루프 (Plan→Do→Check→Iter→Report)
- [[kg-review-and-backlog.md]] — KG 검토 및 backlog 보충 워크플로우
- [[provider-contract-freeze.md]] — provider 전환 전 산출물 계약 고정 및 회귀 검증 워크플로우
- [[provider-config-parser-validation.md]] — provider 설정 parser와 sandbox 정책 검증 워크플로우
- [[codex-app-server-provider-validation.md]] — Codex app-server provider adapter와 broker lifecycle 검증 워크플로우
- [[provider-failure-taxonomy-validation.md]] — provider 실패 taxonomy와 error/last_failure 기록 검증 워크플로우
- [[real-provider-smoke-separation.md]] — real provider smoke와 기본 fake/offline 테스트 분리 워크플로우
- [[provider-retry-timeout-interrupt-validation.md]] — provider retry, timeout, interrupt 계약 검증 워크플로우
- [[daemon-worktree-cleanup.md]] — daemon worktree와 stale branch cleanup 점검 워크플로우
- [[iter-report-provider-validation.md]] — iter/report phase provider fallback, sandbox, frontmatter 검증 워크플로우
- [[feature-spec-fixture-generation.md]] — feature spec fixture와 frontmatter 계약 검증 워크플로우
- [[provider-comparison-mvp-validation.md]] — provider 비교 모드 MVP 실행, output 격리, canonical 보호 검증 워크플로우
- [[provider-comparison-real-smoke.md]] — Claude/Codex real comparison smoke opt-in, candidate artifact, cleanup 검증 워크플로우
- [[provider-aware-hook-validation.md]] — provider-aware hook context, 민감정보 제외, hook 실패 정책 검증 워크플로우
- [[provider-runtime-artifact-cleanup.md]] — provider comparison/smoke artifact 보존 경계와 cleanup 점검 워크플로우
- [[provider-adapter-scaffold-compliance.md]] — 신규 provider adapter scaffold와 compliance fake test 검증 워크플로우
- [[provider-doctor-diagnostics.md]] — provider doctor 환경 사전 점검과 smoke 책임 경계 워크플로우
- [[provider-capability-registry-validation.md]] — provider capability registry SSOT와 phase/sandbox 정책 검증 워크플로우
- [[provider-offline-test-group-validation.md]] — provider offline CI-ready test group과 real smoke 분리 검증 워크플로우
- [[provider-preset-helper-validation.md]] — provider preset helper와 skills UX 검증 워크플로우
- [[plugin-packaging-validation.md]] — Claude Code plugin packaging smoke 검증 워크플로우
- [[queue-project-id-diagnostics.md]] — Queue Tick ready 0건 종료 전 built project_id 누락 가능성 진단 워크플로우
- [[duplicate-pr-detection-and-resolution.md]] — 한 이슈 하나의 canonical open PR 유지와 중복 PR 정리 워크플로우
- [[plan-save-aux-doc-regression.md]] — Phase 5 Save 보조 문서 컨텍스트 보존 회귀 검증 워크플로우
- [[execution-worktree-validation.md]] — execution worktree-first run의 resultDir pointer, status/cost, cleanup safety 검증 워크플로우
