---
id: ADR-34
title: built skill plugin helper 호출은 BUILT_PLUGIN_DIR 기반으로 한다
type: decision
date: 2026-04-27
status: accepted
context_issue: BUI-344
tags: [skills, plugin, packaging, cwd, contract]
---

## 컨텍스트

built skill 문서 일부가 `node scripts/...`, `require('./scripts/...')`, `require('./src/...')`처럼 현재 cwd 기준 상대 경로를 사용했다.
target project에 built repository layout이 없고 `.built`/`.claude`만 있는 dogfooding 또는 marketplace 설치 환경에서는 해당 호출이 target project의 없는 파일을 찾게 된다.
또한 interactive shell과 Claude Bash tool에서는 `BASH_SOURCE[0]`로 skill 파일 위치를 추정하는 방식이 안정적인 실행 계약이 아니다.

## 결정

skill 문서에서 plugin helper를 호출할 때는 target project cwd를 유지하고, plugin install path는 `BUILT_PLUGIN_DIR` 환경변수로 분리한다.
표준 shell guard는 다음 형태를 사용한다.

```bash
: "${BUILT_PLUGIN_DIR:?BUILT_PLUGIN_DIR must point to the installed built plugin/repo path}"
SCRIPT_DIR="$(cd "$BUILT_PLUGIN_DIR/scripts" && pwd -P)"
SRC_DIR="$(cd "$BUILT_PLUGIN_DIR/src" && pwd -P)"
```

`SCRIPT_DIR` 또는 `process.env.BUILT_PLUGIN_DIR + '/scripts/...'`로 plugin scripts를 호출하고, `src` helper도 `process.env.BUILT_PLUGIN_DIR + '/src/...'`로 require한다.
사용자 산출물의 기준 디렉터리는 계속 target project cwd 또는 명시된 project root다.

## 근거

- plugin install path와 target project root는 별도 소유권을 가진다. plugin path는 코드와 helper의 위치이고, target project root는 `.built` runtime 산출물의 위치다.
- `BUILT_PLUGIN_DIR`는 설치 위치를 명시적으로 주입하므로 interactive shell, bash, zsh, Claude Bash tool에서 같은 계약을 사용할 수 있다.
- unset 상태에서 명확히 실패하는 편이 target cwd 상대 fallback으로 잘못된 프로젝트 파일을 찾거나 plugin package 내부에 runtime 산출물을 쓰는 것보다 안전하다.
- provider 파일 직접 작성 금지, runner/control plane normalization, runtime SSOT 원칙을 바꾸지 않고 skill 문서의 호출 경로만 정렬할 수 있다.

## 결과

- Plan, Design, Run 및 관련 skill은 target project에 `scripts/` 또는 `src/`가 없어도 plugin helper를 실행한다.
- `.built`/`.claude`만 있는 target project fixture에서 bash/zsh 호출을 검증한다.
- `<BUILT_PLUGIN_DIR>` placeholder와 `BASH_SOURCE[0]` 기반 plugin dir 추정 예시는 지정 범위에서 제거됐다.
- 배포 또는 runner 계층은 skill 실행 전에 `BUILT_PLUGIN_DIR`를 설치된 built plugin/repo 절대 경로로 제공해야 한다.

## 대안

- target project cwd의 `scripts/`/`src/`를 계속 사용한다: 사용자의 프로젝트가 built repository layout을 갖는다는 잘못된 전제를 유지하므로 선택하지 않았다.
- `BASH_SOURCE[0]`로 skill 파일 위치를 역추적한다: interactive shell과 Claude Bash tool에서 안정적인 계약이 아니므로 선택하지 않았다.
- helper별로 plugin path resolver를 다시 구현한다: 문서 예시와 shell 호출이 분산되어 drift가 커지므로 선택하지 않았다.
- plugin repository root에서만 실행하도록 강제한다: built skill의 산출물은 target project `.built`에 남아야 하므로 선택하지 않았다.
