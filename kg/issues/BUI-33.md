---
id: BUI-33
title: "[Week 4+] Multi-feature 동시성 - registry.json + locks/ 구현"
type: issue
date: 2026-04-24
status: completed
agent: 개발
branch: bui-33
pr: https://github.com/claude-studio/built/pull/30
week: 4
tags: [concurrency, registry, locks, runtime]
---

## 목표

여러 feature를 동시에 실행할 때 상태 공유 및 충돌 방지를 위한 registry.json 운영 로직과 lock 파일 관리 구현.

## 구현 내용

- **src/registry.js** (신규): .built/runtime/registry.json 관리
  - register/update/getFeature/getAll/unregister API
  - atomic write (tmp→rename) 방식으로 데이터 무결성 보장
  - 필드: featureId, status, startedAt, worktreePath, pid

- **lock 시스템**:
  - .built/runtime/locks/<feature>.lock 파일 기반
  - acquire: O_EXCL 플래그로 atomic 생성 (이미 존재 시 에러 반환)
  - release: lock 파일 삭제
  - isLocked: lock 존재 여부 확인
  - lock 파일에 pid/lockedAt 기록

- **scripts/run.js 연동**:
  - 시작 시 lock acquire 실패 → 에러 출력 후 중단 (중복 실행 방지)
  - 종료(성공/실패) 시 finally에서 lock release + registry status 갱신

- **scripts/status.js 개선**:
  - formatList()에서 활성/완료/실패 3그룹 분류 출력

- **test/registry.test.js** (신규): 26개 단위 테스트 모두 통과

## 결정 사항

- **atomic write (tmp→rename)**: registry.json 쓰기 시 임시 파일에 먼저 쓴 후 rename. 부분 쓰기로 인한 데이터 손상 방지.
- **O_EXCL 플래그**: lock acquire 시 파일 생성에 O_EXCL 사용. 두 프로세스가 동시에 acquire를 시도해도 하나만 성공하는 원자적 연산 보장.
- **외부 패키지 0**: Node.js 내장 fs 모듈만 사용. deps 0 원칙 준수.

## 발생한 이슈

없음. 1회차 리뷰 바로 통과.

## 완료 기준 충족 여부

1. src/registry.js 구현 (등록/갱신/조회/제거, atomic write) - ✓
2. lock acquire/release/isLocked 구현 - ✓
3. scripts/run.js에 lock + registry 연동 - ✓
4. scripts/status.js에서 registry.json 활용 (활성/완료/실패 분류) - ✓
5. 외부 npm 패키지 없음 - ✓
6. 단위 테스트 포함 (26개 통과) - ✓

```json
{
  "@context": "https://schema.org",
  "@type": "Action",
  "identifier": "BUI-33",
  "name": "[Week 4+] Multi-feature 동시성 - registry.json + locks/ 구현",
  "agent": {"@type": "SoftwareAgent", "name": "개발"},
  "result": {"@type": "CreativeWork", "url": "https://github.com/claude-studio/built/pull/30"},
  "actionStatus": "CompletedActionStatus"
}
```
