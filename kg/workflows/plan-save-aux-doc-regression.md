---
id: WF-24
title: plan-save 보조 문서 컨텍스트 보존 회귀 검증
type: workflow
date: 2026-04-26
validated_by: [BUI-296]
tags: [plan, phase5, aux_docs, regression, wikilink]
---

## 패턴 설명

`scripts/plan-save.js` 또는 Phase 5 Save 문서 스키마를 바꿀 때는 feature spec에서 보조 문서로 전달되는 컨텍스트 보존 여부를 함께 검증한다.
보조 문서 생성은 파일 존재 여부만 보는 테스트로는 충분하지 않다.
생성된 `entities`, `decisions`, `patterns` 문서가 feature spec의 해당 section 설명을 담는지 확인해야 한다.

## 언제 사용하나

- `/built:plan` Phase 5 Save 흐름을 수정할 때
- `scripts/plan-save.js`의 wikilink 추출, section parsing, 보조 문서 builder를 수정할 때
- `skills/plan/SKILL.md` 또는 `BUILT-DESIGN.md`의 보조 문서 heading/schema를 바꿀 때
- feature spec fixture나 auxiliary docs bootstrap 테스트를 추가할 때

## 단계

1. 재현 feature spec에 `[[entities/<slug>]]`, `[[decisions/<slug>]]`, `[[patterns/<slug>]]`를 모두 넣는다.
2. entities fixture에는 필드 설명처럼 문서 본문에 보존되어야 하는 인라인 설명을 둔다.
3. decisions fixture에는 채택 설명, `Tradeoffs`, 선택하지 않은 대안을 둔다.
4. patterns fixture에는 reference pattern wikilink 인라인 설명을 둔다.
5. `saveAuxDocs()` 실행 후 생성된 보조 문서가 각 설명을 포함하는지 검증한다.
6. 설명이 없는 wikilink는 기존 `내용을 채워주세요` fallback으로 생성되는지 확인한다.
7. 같은 보조 문서가 이미 있을 때 다시 실행해 기존 파일이 overwrite되지 않는지 확인한다.
8. targeted test로 `node test/plan-save.test.js`를 실행하고, 가능하면 unit suite도 함께 실행한다.

## 주의사항

- feature spec heading이 바뀌면 추출 로직과 회귀 fixture를 함께 갱신한다.
- decision 보조 문서는 wikilink 한 줄만 확인하면 부족하다.
  채택 이유, tradeoff, 거부된 대안이 함께 보존되는지 확인한다.
- fallback 테스트는 비어 있는 문서 생성을 허용하기 위한 것이지, context 추출 실패를 정상화하기 위한 것이 아니다.
- overwrite 금지 테스트는 사용자가 보조 문서를 수동 편집한 뒤 다시 저장하는 실제 경로를 보호한다.
