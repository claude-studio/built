---
id: DEC-plan-save-aux-doc-context-policy
title: plan-save 보조 문서 컨텍스트 보존 정책
type: decision
date: 2026-04-26
status: accepted
context_issue: BUI-296
tags: [plan, phase5, aux_docs, extraction, contract]
---

## 컨텍스트

`/built:plan`은 feature spec을 중심으로 사용자의 목표, 데이터 모델, 아키텍처 결정, reference pattern을 정리한다.
Phase 5 Save는 이 feature spec에서 wikilink로 연결된 보조 문서를 생성해 knowledge layer를 확장한다.

기존 `scripts/plan-save.js`는 보조 문서 파일은 만들었지만 feature spec에 이미 들어 있던 설명을 신규 문서에 옮기지 않았다.
그 결과 사용자는 같은 엔티티 필드, 결정 이유, tradeoff, 거부된 대안, pattern 설명을 다시 수동으로 채워야 했다.

## 결정

Phase 5 Save의 신규 보조 문서 생성은 feature spec의 관련 section과 wikilink 주변 컨텍스트를 먼저 보존한다.

- `entities/*`: `Content & Data > Entities`의 해당 wikilink 라인 설명을 사용한다.
- `decisions/*`: `Architecture`의 채택 설명과 `Tradeoffs`, 선택하지 않은 대안을 함께 사용한다.
- `patterns/*`: `Build Plan > Reference Patterns`의 해당 wikilink 라인 설명을 사용한다.

추출 가능한 정보가 없을 때만 기존 빈 스켈레톤 fallback을 사용한다.
기존 보조 문서가 이미 있으면 덮어쓰지 않는다.

## 근거

- feature spec은 Plan 단계 답변의 SSOT다.
  보조 문서 생성이 이 정보를 버리면 Plan/Design handoff 품질이 낮아지고 사용자가 이미 제공한 답변을 반복 입력하게 된다.
- 보조 문서 타입마다 필요한 컨텍스트가 다르다.
  decision 문서는 단순 wikilink 라인보다 채택 이유, tradeoff, 거부된 대안이 중요하므로 architecture 주변 section까지 보존해야 한다.
- deterministic extraction은 Save 단계의 안정성을 유지한다.
  LLM 호출로 보조 문서를 재작성하면 provider 상태, 비용, nondeterminism이 Save 경로에 들어온다.
- overwrite 금지는 사용자가 보조 문서에서 쌓은 후속 지식을 보호한다.

## 결과

- 신규 `entities`, `decisions`, `patterns` 보조 문서는 feature spec에 이미 있던 설명을 초기 본문으로 가진다.
- 정보가 없는 wikilink는 기존처럼 스켈레톤으로 생성되어 불완전한 추론을 하지 않는다.
- `/built:plan` 저장을 반복해도 기존 보조 문서의 수동 편집 내용은 유지된다.
- `test/plan-save.test.js`가 context 보존, fallback, overwrite 금지를 회귀 기준으로 고정한다.

## 대안

- 모든 보조 문서를 빈 스켈레톤으로만 만든다: 사용자의 plan 답변을 손실시키므로 선택하지 않았다.
- LLM으로 보조 문서를 다시 작성한다: Save 단계가 provider와 모델 출력에 의존하고 원문 보존보다 재해석이 앞설 수 있어 선택하지 않았다.
- wikilink가 포함된 한 줄만 모든 문서 타입에 공통 적용한다: decision의 tradeoff와 거부된 대안을 놓치므로 선택하지 않았다.
- 기존 보조 문서를 feature spec 기준으로 갱신한다: 사용자가 보조 문서에서 추가한 지식을 덮어쓸 위험이 있어 선택하지 않았다.

## 되돌릴 조건

보조 문서가 feature spec에서 파생되는 bootstrap 문서가 아니라 별도 source-of-truth로 재정의되면 이 정책을 재검토한다.
Phase 5 Save가 명시적인 사용자 승인 기반 migration 기능을 갖게 되면 기존 문서 업데이트 정책을 별도 결정으로 분리한다.
