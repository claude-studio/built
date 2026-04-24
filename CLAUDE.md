# built 프로젝트 에이전트 지침

## KG 문서화

이슈 완료(done) 처리 후 반드시 KG 엔트리를 작성한다.
스키마: kg/_schema.md 참조
저장 경로: kg/issues/<이슈ID>.md (예: BUI-1.md)

작성 내용:
- frontmatter: id, title, type, date, status, agent, branch, pr, week, tags, keywords
- ## 목표
- ## 구현 내용
- ## 결정 사항 (선택마다 왜 이걸 선택했는지)
- ## 발생한 이슈 (blocked, 반려 이력)
- ## 재발 방지 포인트 (비자명한 제약, 실패한 접근과 이유, 반복 가능한 실수 패턴)
- ## 완료 기준 충족 여부
- JSON-LD 블록 (schema.org Action 타입)

설계 문서(BUILT-DESIGN.md)에 없는 구현 방식을 선택했거나 접근을 바꾼 경우 반드시 decisions/<슬러그>.md를 작성한다.

KG 파일 작성 후 main 브랜치에 직접 커밋:
```
git -C ~/Desktop/jb/built add kg/
git -C ~/Desktop/jb/built commit -m "kg: <이슈ID> 이력 추가"
git -C ~/Desktop/jb/built push origin main
```
