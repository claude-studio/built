# /built:init

프로젝트를 built로 bootstrap합니다. 최초 1회 실행.

## 실행 방법

현재 프로젝트 루트에서 아래 명령어를 실행합니다.

로컬 개발 환경에서는 built 레포를 직접 가리킵니다:

```bash
node ~/Desktop/jb/built/src/init.js
```

## 동작

1. `.built/config.json` 존재 여부로 이미 초기화됐는지 확인
2. 이미 초기화된 경우: "already initialized" 메시지 출력 후 종료 (파일 덮어쓰기 없음)
3. 신규 초기화 시 아래 구조를 생성:

```
프로젝트 루트/
├── .claude/
│   ├── settings.json
│   └── worktrees/
├── .built/
│   ├── context.md
│   ├── config.json
│   ├── hooks.json
│   ├── hooks.local.json.example
│   ├── features-index.md
│   ├── features/
│   ├── decisions/
│   ├── entities/
│   ├── patterns/
│   ├── runs/
│   └── runtime/
├── .worktreeinclude
└── .gitignore (built 항목 자동 추가)
```

4. `.gitignore`에 built 관련 항목 추가 (중복 방지)

## 완료 후 안내

초기화 완료 후 사용자에게 다음을 안내합니다:

- `.built/context.md`를 열어 프로젝트 개요, 기술 스택, 팀 컨벤션을 채워주세요.
- 다음 단계: `/built:plan <feature-name>` 으로 첫 feature를 시작하세요.

## 주의

- 이 명령은 대상 프로젝트 레포에서 실행합니다 (built 레포 아님).
- 외부 npm 패키지 없음. Node.js 20+ 필요.
- `.built/config.json`이 이미 있으면 어떤 파일도 덮어쓰지 않습니다.
