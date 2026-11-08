# PR 안에서 PR 설명하기

[README](../README.ko.md) · [English](pr.md)

`nacholens pr` 는 build 결과를 GitHub 코멘트 하나로 만들어, 리뷰어가 다른 것을 열지 않고도 이해하게 합니다.
어떤 흐름에서 무엇이 바뀌었는지(그림과 글로), 기획이 무엇이었는지, 무엇을 다시 테스트해야 하는지, 흐름이 보여 주지 못하는 것이 무엇인지가 들어갑니다.
`nacholens snap` 은 실제 플레이어의 그림을 더합니다(정지 그림 하나, 바뀐 흐름마다 애니메이션 하나, 라이트·다크 각각).

```bash
nacholens build --repo . --base origin/main --head HEAD --out nacholens-out [--intent intent.json] [--lang ko]
nacholens snap  --page nacholens-out/<product>.html [--lang ko]          # 선택: Node 22+ 와 로컬 Chrome 필요
nacholens pr    --from nacholens-out --repo-url https://github.com/<owner>/<repo> --pr <number> \
                [--media-url <where the pictures are>] [--player-url <link to the page>] [--lang ko]
gh pr comment <number> --body-file nacholens-out/pr.md                     # 또는 기존 코멘트를 갱신 (아래)
```

## 코멘트에 들어가는 것

위에서 아래로, 리뷰어가 묻는 순서대로입니다.

1. **요약**: 변경 제목, 바뀐 흐름과 단계의 수(신규 · 변경 · 삭제), 다시 테스트할 흐름의 수, 어떤 흐름에도 보이지 않는 변경 파일의 수. `--player-url` 을 주면 대화형 플레이어 링크가 붙습니다(Claude 아티팩트 링크는 그렇게 표시됩니다).
2. **한눈에**: 플레이어의 정지 그림(`map.png`, 다크 모드에서는 다크 버전). 그림이 없으면 아키텍처의 Mermaid 다이어그램으로 바뀌며, 바뀐 곳은 노랑, 새로 생긴 곳은 초록입니다. GitHub 가 Mermaid 를 직접 그리므로 별도 호스팅 없이 비공개 저장소에서도 동작합니다.
3. **바뀐 흐름마다 한 절**: 흐름의 요약, 애니메이션(또는 바뀐 단계를 색 상자로 표시한 Mermaid 시퀀스 다이어그램), 그리고 단계 목록. 바뀌지 않은 단계는 한 줄이고, 바뀐 단계에는 무슨 일이 일어나는지, 경로, 무엇을 보내고 받는지, 코드 링크가 나옵니다. 단계 번호 ①②③ 은 플레이어의 번호이며 다이어그램, 애니메이션 모서리 라벨, 다시 테스트 목록에서 모두 같습니다.
4. **계획대로 되었나?** (`build --intent` 사용 시): 기대사항마다 충족 / 미충족 / 확인 불가, 그것을 증명하는 단계, 어떤 기대사항도 언급하지 않는 바뀐 단계.
5. **다시 테스트할 것**: 리뷰어가 PR 에서 체크하는 할 일 목록. 흐름마다 이유와, 테스트가 그 흐름을 언급하는지가 붙습니다("테스트를 못 찾음"은 테스트가 없다는 증거가 아닙니다).
6. **흐름에 보이지 않는 변경**: 어떤 단계도 인용하지 않는 변경 파일.
7. **믿어도 되나?** (접힘): 비교한 범위, 모델을 읽은 커밋, 깊이, 코멘트를 만든 대상 커밋. 더 오래된 커밋용 코멘트는 낡은 것이므로 push 할 때마다 다시 만드세요.

추측은 없습니다. 바뀐 단계의 예전 문구가 모델에 없으면 지어내지 않고 없다고 적습니다(진짜 전/후 비교는 `build` 에 `--before-model` 을 주세요).

## 코드 링크

`--repo-url` 과 `--pr` 을 주고 모델을 헤드 커밋에서 읽었다면, 단계의 코드 링크는 PR 의 **Files changed** 탭에서 그 줄을 엽니다(`#diff-<경로의 sha256>R<줄>`). 모델을 다른 커밋에서 읽었다면 링크는 그 커밋의 퍼머링크(`/blob/<commit>/<file>#L…`)이며, 인용한 줄을 항상 정확히 가리킵니다. `--repo-url` 이 없으면 그냥 `file:lines` 입니다.

## 그림

`snap` 은 빌드된 페이지를 로컬 headless Chrome(임시 프로필, 컴퓨터 밖으로 나가는 것 없음)으로 열어 플레이어를 직접 움직이므로, 그림은 페이지가 보여 주는 그대로입니다.

- `map.png`, `map.dark.png`: 처음으로 바뀐 흐름의 처음으로 바뀐 단계에서 본 무대. 선명하게 2배 크기입니다.
- `<use case>.gif`, `<use case>.dark.gif`: 바뀐 흐름마다(최대 `--flows`, 기본 3) `--fps`(기본 10)로 단계별 재생. 바뀐 단계는 1.8초, 나머지는 0.5초 멈춥니다. 모서리 라벨에 단계 번호, 이름, 변경을 뜻하는 말이 나오며 코멘트와 같은 말입니다. 일반적인 크기는 약 100 KB 입니다.
- `manifest.json`: 쓴 파일 목록. `pr` 이 `<from>/media/` 에서 읽습니다.

Chrome 은 `--chrome`, `$CHROME`, `PATH`, macOS 응용 프로그램 폴더, Playwright 의 다운로드 캐시 순으로 찾습니다. GIF 인코더는 nacholens 에 들어 있습니다(공용 팔레트 하나, 디더링 없음, 프레임마다 바뀐 사각형만).

GitHub 에는 코멘트 첨부를 올리는 API 가 없으므로 그림에는 URL 이 필요합니다. push 할 수 있는 저장소라면, 그림만 담은 같은 저장소의 별도 브랜치가 가장 간단한 보관 위치입니다.

```bash
git worktree add --detach ../nacholens-media && cd ../nacholens-media
git switch nacholens-media 2>/dev/null || git switch --orphan nacholens-media
mkdir -p pr-<n>/<head7> && cp ../<repo>/nacholens-out/media/*.png ../<repo>/nacholens-out/media/*.gif pr-<n>/<head7>/
git add pr-<n> && git commit -m "nacholens pictures for #<n> at <head7>" && git push origin nacholens-media
echo "https://github.com/<owner>/<repo>/raw/$(git rev-parse HEAD)/pr-<n>/<head7>"   # → --media-url
```

URL 에 커밋이 들어 있어서 예전 코멘트는 자기 그림을 계속 가리킵니다. GitHub 는 `github.com/<owner>/<repo>/raw/…` 이미지를 (이미지 프록시를 거치지 않고) 바로 보여 줍니다. 공개 저장소에서는 코드를 볼 수 있는 사람이면 누구나 그림을 볼 수 있고, 비공개 저장소에서는 접근 권한이 있는 사람만 봅니다. 비공개 저장소의 그림을 공개된 곳에 올리면 안 됩니다.

## PR 하나에 코멘트 하나

코멘트는 `<!-- nacholens:pr -->` 로 시작합니다. push 할 때마다 새로 달지 말고 이것을 갱신하세요.

```bash
id=$(gh api "repos/<owner>/<repo>/issues/<n>/comments" --paginate --jq '.[] | select(.body | contains("<!-- nacholens:pr -->")) | .id' | head -1)
if [ -n "$id" ]; then gh api -X PATCH "repos/<owner>/<repo>/issues/comments/$id" -F body=@nacholens-out/pr.md
else gh pr comment <n> --body-file nacholens-out/pr.md; fi
```

코멘트를 다는 것은 남의 저장소에서 눈에 보이는 행동입니다. 요청받지 않았다면 에이전트는 코멘트를 달거나 그림을 push 하기 전에 먼저 묻습니다.

## 한계

- GitHub 는 코멘트를 65,536자에서 자릅니다. 아주 큰 변경은 앞쪽 흐름만 전부 싣고 나머지는 이름만 나열합니다(플레이어에는 모두 보입니다).
- 검토 문구(이유, 기획 판정)는 CLI 에서 영어로 나오고, 제목과 라벨만 `--lang` 을 따릅니다. 모델의 글(라벨, 해설)은 쓴 그대로 보여 줍니다.
- 대화형 페이지는 GitHub 안에서 실행할 수 없습니다. 코멘트는 페이지 없이도 완결되며, `--player-url` 은 링크만 더합니다.
