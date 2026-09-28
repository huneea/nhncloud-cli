---
name: release
description: "nhncloud-cli 새 버전을 main 에서 태그, GitHub Release, npm 배포까지 릴리스한다. /release, 릴리스, 버전 범프, npm publish, 새 버전 배포 같은 요청이면 스킬 이름을 말하지 않아도 이 스킬을 쓴다."
---

# /release로 nhncloud-cli 릴리스

**목표: 직전 태그 이후 main 의 변경을 검증하고, 새 버전의 태그와 한국어 GitHub Release 를 만든 뒤 사용자가 OTP 로 npm 배포를 마칠 수 있게 한다.**

- 입력은 새 semver 버전과, 직전 태그 이후의 커밋·머지된 PR·닫힌 이슈다.
- 산출은 bump 커밋, `v$VERSION` 태그, GitHub Release, 사용자에게 안내한 `npm publish` 명령이다.
- 어느 단계든 실패하면 그 자리에서 멈추고 사용자에게 보고한다.

## 워크플로우 개요

| 단계 | 이름 | 통과 조건 |
| --- | --- | --- |
| 1 | 사전 검증 | 현재 브랜치가 `main` 이고 `git status --porcelain` 이 비어 있으며 `AGENTS.md` 의 검증 명령이 모두 성공했다 |
| 2 | 변경 분석 | 커밋·PR·닫힌 이슈 목록을 사용자에게 보였고, 아직 열린 이슈 중 이번에 닫을 것이 확정됐다 |
| 3 | 문서 동기화 | 새 명령과 옵션이 README 와 공개 스킬 reference 에 있다. 없으면 보완 커밋이 있다 |
| 4 | 공개 정보 검사 | `AGENTS.md` 의 grep 두 개가 모두 0건이다 |
| 5 | 버전 범프 | bump 커밋이 `origin/main` 에 push 됐다 |
| 6 | 태그와 GitHub Release | 태그가 push 됐고 Release 본문 점검이 0건이다 |
| 7 | npm 배포 | 사용자가 `npm publish` 를 실행했고 npm 에 새 버전이 보인다 |
| 8 | 남은 이슈 처리 | 2단계에서 확정한 열린 이슈를 닫았다. 없으면 건너뛴다 |

아래 블록은 다음 변수를 전제로 한다. 1단계에서 한 번 채운다.

```bash
VERSION=0.18.0                       # 새 버전으로 바꾼다
TAG="v$VERSION"
NOTES="/tmp/release-$TAG-notes.md"
LAST_TAG=$(git describe --tags --abbrev=0)
LAST_TAG_DATE=$(git log -1 --format=%cI "$LAST_TAG")
```

## 1. 사전 검증

main 가드를 가장 먼저 둔다. 3·4단계의 보완 커밋도 main 에 쌓여야 하기 때문이다.

```bash
[ "$(git branch --show-current)" = "main" ] || { echo "STOP: main 이 아니다"; exit 1; }
git pull --ff-only
git status --porcelain
```

- `git status --porcelain` 에 출력이 있으면 커밋할지 사용자에게 확인한다.
- 이어서 `AGENTS.md` 「빌드와 검증」 절의 명령을 모두 실행한다. `package.json` 에 `prepublishOnly` 가 없어 `npm publish` 는 빌드를 다시 돌리지 않는다.

## 2. 변경 분석

```bash
git log --oneline "$LAST_TAG"..HEAD
gh pr list --state merged --search "merged:>=$LAST_TAG_DATE" --json number,title --jq '.[] | "#\(.number) \(.title)"'
gh issue list --state closed --search "closed:>=$LAST_TAG_DATE" --json number,title --jq '.[] | "#\(.number) \(.title)"'
gh issue list --state open --json number,title --jq '.[] | "#\(.number) \(.title)"'
```

- 커밋을 새 명령, 새 옵션, 수정, 리팩터링, 문서와 인프라로 나눠 사용자에게 보인다.
- 이슈는 대부분 PR 본문의 `Closes #N` 으로 머지 때 이미 닫힌다. 닫힌 이슈 목록을 Release 노트에 그대로 적는다.
- 열린 이슈 중 이번 변경으로 해결된 것이 있으면 사용자와 닫을 목록을 확정한다.
  후속 작업이 남았거나 이슈 범위와 구현 범위가 일부만 맞으면 닫지 않고 진행 상황 댓글만 남긴다.
- `LAST_TAG_DATE` 와 같은 시각에 머지된 직전 릴리스 PR 이 목록에 섞일 수 있다. 커밋 목록과 대조해 뺀다.

## 3. 문서 동기화

2단계에서 새 명령이나 옵션을 찾았으면 README 와 공개 스킬에 반영됐는지 확인한다.

```bash
KEYWORD="security-group"             # 새 명령이나 옵션 이름으로 바꾼다
grep -n "$KEYWORD" README.md skills/nhncloud-cli/SKILL.md skills/nhncloud-cli/references/*.md
```

| 위치 | 확인할 것 |
| --- | --- |
| `README.md` | 「사용 예」 절의 알맞은 서비스 분류에 새 명령과 옵션이 있다 |
| `skills/nhncloud-cli/references/*.md` | 해당 서비스 reference 에 새 명령과 옵션이 있다 |

- 빠졌으면 무엇을 어디에 넣을지 제안하고 보완 커밋을 따로 만든다.
- 사용자가 건너뛰기에 명시적으로 동의했을 때만 보완 없이 진행한다.
- 새 명령이나 옵션이 없는 릴리스면 그 사실을 알리고 이 단계를 통과한다.

## 4. 공개 정보 검사

`AGENTS.md` 「공개 저장소 정보 보호」 절의 grep 두 개를 실행한다. 패턴은 그 절이 소유한다.

- 걸린 곳이 있으면 위치를 보이고 그 절의 placeholder 로 바꾼 보완 커밋을 만든 뒤 다시 검사한다.
- 사용자가 내부 값 사용에 명시적으로 동의하지 않으면 릴리스를 멈춘다.

## 5. 버전 범프

`package.json` 의 `version` 과 `src/index.ts` 의 `.version("x.y.z")` 두 곳을 `$VERSION` 으로 바꾼다.
CLI 버전 문자열이 `src/index.ts` 에 하드코딩돼 있어 두 곳을 함께 바꿔야 한다.

```bash
node_modules/.bin/tsup
[ "$(git branch --show-current)" = "main" ] || { echo "STOP: main 이 아니다"; exit 1; }
git add package.json src/index.ts
git commit -m "chore: bump version to $TAG"
git push origin main
```

## 6. 태그와 GitHub Release

```bash
git tag -a "$TAG" -m "$TAG"
git push origin "$TAG"
```

Release 노트는 2단계 결과로 `$NOTES` 파일에 한국어로 쓴다.
CLI 명령, 경로, 패키지 이름, API 필드, `Closes`, 전체 변경 URL 은 원문을 유지한다.

- 반드시 넣는 절: 주요 변경, `Closes`(닫힌 이슈 목록. 없으면 없다고 적는다), 전체 변경 링크
- 필요하면 넣는 절: 새 명령, 새 옵션, 수정, 검증, 깨는 변경, 후속으로 남긴 것

```bash
gh release create "$TAG" --title "$TAG: 요약" --notes-file "$NOTES"
gh release view "$TAG" --json body -q .body | grep -cE '\\`|\\\$'
```

- 본문은 `--notes-file` 로만 넘긴다. 인라인 `--notes` 에 `` \` `` 나 `\$` 를 넣으면 백슬래시가 본문에 그대로 남는다. v0.10.0 에서 backtick 66개가 `` \` `` 로 출력됐다.
- 두 번째 명령은 `` \` `` 와 `\$` 만 센다. 코드 블록의 줄 연속 `\` 는 정상이라 세지 않는다. 0 이 아니면 파일을 고쳐 `gh release edit "$TAG" --notes-file "$NOTES"` 로 다시 올린다.
- `--generate-notes` 는 쓰지 않는다. 닫힌 이슈 목록이 빠진다.

## 7. npm 배포

npm 배포에는 2FA OTP 가 필요하다. 사용자에게 아래 명령을 직접 실행해 달라고 요청한다.

```bash
npm publish --access public --otp=OTP코드
```

완료 뒤 두 곳을 확인한다. npm 반영에는 수 분이 걸린다.

- `https://github.com/jon890/nhncloud-cli/releases/tag/$TAG`
- `https://www.npmjs.com/package/@bifos/nhncloud-cli`

## 8. 남은 이슈 처리

2단계에서 닫기로 확정한 열린 이슈가 있을 때만 수행한다. npm 배포가 실패했으면 닫지 않는다.

```bash
ISSUES="101 102"                     # 2단계에서 확정한 번호
for n in $ISSUES; do
  gh issue close "$n" --comment "$TAG 에서 해결되어 닫습니다. https://github.com/jon890/nhncloud-cli/releases/tag/$TAG"
done
```

이전 태그는 force 로 갱신하지 않는다. 새 태그만 만든다.
