# PR 안에서 PR 설명하기

[README](../README.ko.md) · [English](pr.md)

`nacholens pr` 는 build 결과를 GitHub 코멘트 하나로 만들어, 리뷰어가 다른 것을 열지 않고도 이해하게 합니다.
어떤 흐름에서 무엇이 바뀌었는지(그림과 글로), 기획이 무엇이었는지, 무엇을 다시 테스트해야 하는지, 흐름이 보여 주지 못하는 것이 무엇인지가 들어갑니다.
`nacholens snap` 은 실제 플레이어의 그림을 더합니다(정지 그림 하나, 바뀐 흐름마다 애니메이션 하나, 라이트·다크 각각).

```bash
nacholens build --repo . --base origin/main --head HEAD --out nacholens-out [--intent intent.json] [--lang ko]
nacholens snap  --page nacholens-out/<product>.html [--lang ko] [--optional]    # 선택: Node 24+ 와 로컬 Chrome 필요
nacholens media upload --from nacholens-out --pr <number>                       # 선택: 그림 올리기 (아래)
nacholens pr    --from nacholens-out --repo-url https://github.com/<owner>/<repo> --pr <number> [--comment] \
                [--media-url <where the pictures are>] [--player-url <link to the page>] [--lang ko]
```

`pr --comment` 는 이 글을 PR 코멘트로 달고, 이미 달린 코멘트가 있으면 갱신합니다(아래). 푸시할 때마다 이 모두를 자동으로 돌리려면 [GitHub Action 예제](#푸시할-때마다-자동으로-돌리기-github-action)를 쓰세요.

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

Chrome 이 없는 곳(브라우저가 없는 러너 등)에서 `--optional` 을 주면 `snap` 은 그 사실을 알리고 그림을 만들지 않은 채 종료 코드 0 으로 끝나며, 코멘트에는 그림 대신 Mermaid 다이어그램이 나옵니다. `--optional` 없이 Chrome 이 없으면 오류입니다.

## 그림 올리기: `media upload`

GitHub 에는 코멘트 첨부를 올리는 API 가 없으므로 그림에는 URL 이 필요합니다. push 할 수 있는 저장소라면, 그림만 담은 같은 저장소의 **별도 orphan 브랜치** `nacholens-media` 가 보관 위치입니다.

```bash
nacholens media upload --from nacholens-out --pr <number> [--repo <checkout>] [--head <sha>]
# media upload: 3 files -> nacholens-media/pr-12/a1b2c3d (new commit 7f3e9a1)
# media URL: https://github.com/<owner>/<repo>/raw/<media commit>/pr-12/a1b2c3d
```

- 파일은 `pr-<n>/<head7>/`(PR 번호와 head 커밋의 앞 7자)로 올라갑니다. URL 은 **그림 커밋**에 고정되므로 예전 코멘트는 자기 그림을 계속 보여 줍니다. 주소는 `nacholens-out/media/media-url.json` 에 적히고, 같은 커밋용으로 만들어졌다면 `pr` 이 알아서 씁니다(`--media-url` 이 우선).
- 다른 것은 건드리지 않습니다. 작업은 임시 폴더의 일회용 clone 에서 하므로 작업 트리, 인덱스, 브랜치, git 설정은 바뀌지 않고, 코드 브랜치의 diff 에는 그림이 들어가지 않습니다. push 는 강제로 하지 않으며, 다른 작업이 먼저 push 했다면 새 끝점 위에서 다시 올립니다.
- 같은 head 를 다시 올려도 바뀌는 것은 없습니다(새 커밋 없음). 그림을 다시 찍어 내용이 달라졌다면 그 head 의 폴더를 새 커밋으로 바꿉니다.
- `--pr`, `--head`, 파일 이름은 먼저 짧은 허용 목록으로 검사합니다(숫자, 소문자 16진수, 영문자·숫자·`._-` 와 `.png`/`.gif`, 링크 없음). 브랜치는 그림 브랜치처럼 보여야 하며(맨 위에 `pr-<n>` 폴더만), 그렇지 않으면 아무것도 push 하지 않습니다.
- `--repo-url` 은 저장소의 공개 주소입니다(기본값: 원격에서 가져옴). `--remote` 는 원격 이름이나 주소입니다(기본값 `origin`). 체크아웃이 없는 작업에 씁니다.
- push 권한이 없으면(포크 PR, 읽기 전용 토큰) 분명한 메시지와 함께 실패하고, `--skip-on-denied` 를 주면 그 사실을 알리고 종료 코드 0 으로 끝나므로 코멘트는 Mermaid 다이어그램으로 그대로 달립니다.
- 공개 저장소에서는 코드를 볼 수 있는 사람이면 누구나 그림을 볼 수 있고, 비공개 저장소에서는 접근 권한이 있는 사람만 봅니다. 비공개 저장소의 그림을 공개된 곳에 올리면 안 됩니다. 이 명령은 가리킨 저장소에만 씁니다.

### 정리하기: `media prune`

```bash
nacholens media prune                  # 모의 실행: 닫히거나 머지된 PR 의 그림을 보여 줍니다(`gh pr list` 사용)
nacholens media prune --apply          # 그림 브랜치에 새 커밋을 만들어 지웁니다(강제 push 없음)
nacholens media prune --apply --superseded   # 아직 열린 PR 의 예전 head 그림도 지웁니다
```

`gh` 가 보여 주지 않는 PR 과 열린 PR 은 그대로 둡니다. 지우는 것도 일반 커밋이므로 파일은 브랜치 이력에 남습니다. 예전 코멘트의 링크는 계속 동작하지만 저장소가 작아지지는 않습니다(브랜치 끝점은 작아지므로 새로 clone 하면 빠릅니다).

## PR 하나에 코멘트 하나

코멘트는 `<!-- nacholens:pr -->` 로 시작합니다. `pr --comment`(`gh`, `--repo-url`, `--pr` 필요)는 push 할 때마다 새로 달지 않고 이것을 갱신합니다.

- 마커로 시작하는 코멘트가 없으면: 새 코멘트를 답니다.
- 하나 있으면: 그 코멘트를 제자리에서 고칩니다(링크도, 대화 속 위치도 같음).
- 둘 이상이면(예: 예전 설정 때문에): 가장 오래된 첫 코멘트를 고치고, 나머지는 로그에 이름만 적고 그대로 둡니다.

마커를 글 중간에 인용했을 뿐인 코멘트는 절대 덮어쓰지 않습니다. 코멘트에는 그것을 만든 커밋이 들어 있어서, 더 오래된 코멘트는 낡았다는 것을 알아볼 수 있습니다.

코멘트를 다는 것은 남의 저장소에서 눈에 보이는 행동입니다. 요청받지 않았다면 에이전트는 코멘트를 달거나 그림을 push 하기 전에 먼저 묻습니다(아래 워크플로를 설치하는 것이 그 요청입니다).

읽기·쓰기 토큰이 없으면(포크 PR, Dependabot) GitHub 가 쓰기를 거부합니다. 이때 `pr --comment` 는 "no write permission" 으로 실패하고, `--skip-on-denied` 를 주면 로그 한 줄과 종료 코드 0 으로 바뀝니다. `pr.md` 는 그대로 만들어집니다.

## 푸시할 때마다 자동으로 돌리기 (GitHub Action)

[`docs/action/nacholens-pr.yml`](action/nacholens-pr.yml) 은 바로 쓸 수 있는 워크플로입니다. `.github/workflows/` 에 복사하고 모델을 `.nacholens/model.json` 으로 커밋하면, PR 에 push 할 때마다 설명을 다시 만들어 같은 코멘트를 갱신합니다.

`checkout -> setup-node 24 -> build -> snap -> media upload -> pr --comment` 를 세 개의 job 으로 나눠 돌립니다. 코멘트 작성과 그림 보관에 필요한 권한이 다르기 때문입니다.

| Job | 권한 | 하는 일 |
|---|---|---|
| `build` | `contents: read` | PR 의 코드로 도구를 돌리고 그림을 찍음 |
| `host-pictures` (선택) | `contents: write` | `pr-<n>/<head7>/` 를 `nacholens-media` 에 push 함. 코드는 checkout 하지 않음 |
| `comment` | `contents: read`, `pull-requests: write` | 코멘트 하나를 달거나 갱신함. 코드는 checkout 하지 않음 |

- **그림은 선택 사항**: 저장소 변수 `NACHOLENS_PICTURES` 를 `true` 로 두세요. 두지 않으면 어떤 job 도 저장소에 쓸 수 없고, 코멘트는 GitHub 가 직접 그리는 Mermaid 다이어그램을 씁니다.
- **포크 PR** 은 읽기 전용 토큰을 받으므로 모든 job 이 건너뜁니다(`head.repo.full_name == github.repository`). CLI 도 거부된 쓰기를 건너뜀으로 처리합니다(`--skip-on-denied`).
- **Chrome 이 없을 때**(브라우저가 없는 self-hosted 러너): `snap --optional` 이 그림을 건너뛰고 코멘트는 Mermaid 로 돌아갑니다.
- 모든 액션은 커밋 SHA 로 고정되어 있고(릴리스는 주석에 적음), 워크플로는 `pull_request` 를 쓰며 `pull_request_target` 은 쓰지 않습니다. 셸 스크립트에는 값이 `env:` 로만 전달됩니다.
- 맨 위의 `NACHOLENS_PKG` 가 nacholens 버전을 고정합니다.
- 가끔 `nacholens media prune --apply` 로 정리하세요(`contents: write` 가 필요하므로 직접 돌리거나 별도의 예약 워크플로로 돌립니다).

## 한계

- GitHub 는 코멘트를 65,536자에서 자릅니다. 아주 큰 변경은 앞쪽 흐름만 전부 싣고 나머지는 이름만 나열합니다(플레이어에는 모두 보입니다).
- 검토 문구(이유, 기획 판정)는 CLI 에서 영어로 나오고, 제목과 라벨만 `--lang` 을 따릅니다. 모델의 글(라벨, 해설)은 쓴 그대로 보여 줍니다.
- 대화형 페이지는 GitHub 안에서 실행할 수 없습니다. 코멘트는 페이지 없이도 완결되며, `--player-url` 은 링크만 더합니다.
