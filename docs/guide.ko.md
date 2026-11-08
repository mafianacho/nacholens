# nacholens 안내서 (한국어)

[README](../README.ko.md) · [English guide](guide.md)

**AI가 바꾼 백엔드를 코드를 읽지 않고 파악하세요.**

유즈케이스("로그인", "주문 목록 조회")를 고르면 요청이 클라이언트에서 게이트웨이를 거쳐 서비스, 데이터베이스, 외부 서비스로 움직이는 과정이 단계별로 보입니다. 이번 작업에서 바뀐 곳은 색으로 강조되며, 바뀐 곳은 `git diff`에서 바로 뽑습니다.

![데모 쇼핑몰: 주문 목록이 이제 배송 추적기를 호출함. 새 단계와 바뀐 부분이 강조됨](images/overview.png)

*함께 들어 있는 데모 쇼핑몰(게이트웨이 → API → SQLite + 외부 서비스 3개)에서 "주문 목록 보기"의 4단계, 요청이 움직이는 장면. 초록 = 신규, 주황 = 변경. 어떤 단계도 다루지 않는 변경 파일은 검토 독에 모읍니다. nacholens는 이런 파일을 조용히 버리지 않습니다.*

- **백엔드와 인프라를 한눈에**: 왼쪽에 흐름, 가운데에 요청이 점으로 움직이는 아키텍처(재생 / 일시정지 / 단계 이동 / 속도), 오른쪽에 지금 단계를 쉬운 문장으로. 상자를 누르면 그 안(부품과 배선, 테이블, 엔드포인트)으로 들어가 같은 단계가 거기서 움직이는 것을 봅니다.
- **추측이 아닌 근거**: 모든 컴포넌트, 링크, 단계가 `file:lines` 를 인용하고, `verify` 가 인용을 실제 소스와 대조합니다.
- **git으로 만드는 변경 오버레이**: `base..head` 를 그 근거와 대조합니다. 어떤 단계와도 맞지 않는 변경은 "모델 밖"으로 나열됩니다.
- **검토 독**: 무대 아래 세 개의 탭, 탭마다 아직 확인할 것이 표시됩니다. 기획자의 기대사항(충족 / 미충족 / 확인 불가), 다시 테스트할 유즈케이스(테스트가 언급하는지 포함), 어떤 단계도 다루지 않는 변경 파일. 변경 전 모델이 있으면 단계마다 이전 내용도 보입니다. [`review.md`](review.md)
- **오프라인 파일 하나**: 단일 HTML, CDN 없음, 네트워크 없음, 의존성 없음. 실행하는 에이전트가 Claude라면 아티팩트로 낼 수도 있습니다.
- **에이전트를 위한 설계**: AI 에이전트가 처음부터 끝까지 따라갈 수 있는 `SKILL.md` 가 있습니다. 사람은 요청만 하고, 에이전트가 모델을 쓰고 검증하고 페이지를 만듭니다.

## 5분 시작

필요한 것: **Node.js 24+** 와 **git** (설치할 패키지 없음).

### 1. 데모 보기 (30초)

```bash
git clone https://github.com/mafianacho/nacholens.git && cd nacholens
node src/cli.js demo
# → ./nacholens-demo/demo-shop.html   (브라우저로 열기)
```

### 2. 내 저장소에서 AI 에이전트로 쓰기

설명하고 싶은 저장소에 스킬을 설치합니다. 쓰는 에이전트에 맞는 줄을 고르세요.

```bash
node src/cli.js install --claude --into /path/to/your/repo     # Claude Code: .claude/skills/nacholens
node src/cli.js install --agents --into /path/to/your/repo     # Codex 등 AGENTS.md 방식 에이전트: .nacholens/ + AGENTS.md 블록
node src/cli.js install --to ~/.my-agent/skills                # SKILL.md 폴더를 읽는 그 밖의 에이전트
```

그리고 에이전트에게 쉬운 말로 요청합니다.

> nacholens 스킬로 이 저장소의 최근 커밋 5개에서 뭐가 바뀌었는지 보여 줘.

에이전트가 저장소를 훑고(`scan`), 근거가 달린 모델을 쓰고, 검증하고, 페이지를 만든 뒤 무엇이 바뀌었는지 비개발자의 말로 알려 줍니다. Claude는 아티팩트, 다른 에이전트는 단일 `.html` 파일이 나옵니다. 설치된 폴더는 그 자체로 완결되어 있고(스킬과 CLI 사본), 네트워크가 필요 없습니다.

### 3. 에이전트 없이 CLI로

```bash
SV="node $PWD/src/cli.js"
$SV build --repo ~/work/my-api --base main --model ~/work/my-api.model.json
# → ./nacholens-out/<product>.html
```

모델이 아직 없으면 같은 명령이 빈 템플릿을 만들고 채울 곳을 JSON 경로로 나열한 뒤 종료 코드 1로 끝납니다. 채우고(`scan` 이 단서를 보여 줍니다), `validate`, `verify`, `build` 순으로 진행하세요. 자세한 절차와 모델 작성 기준(근거 고르는 법, 단계 크기, 좋은 예·나쁜 예)은 [`skills/nacholens/SKILL.md`](../skills/nacholens/SKILL.md)(영어)를 보세요.

## 화면 구성

- **왼쪽**: 흐름(유즈케이스) 목록과 선택한 흐름의 단계. 바뀐 단계에는 신규/변경 표시와 리뷰 체크가 붙습니다.
- **가운데**: 아키텍처 위로 요청이 점으로 움직입니다(재생·일시정지·단계 이동·속도). 상자를 누르면 그 안(부품과 배선 · 테이블 · 엔드포인트)으로 들어가 같은 단계를 안에서 봅니다.
- **오른쪽**: 지금 단계에서 일어나는 일, 바뀐 이유, 오가는 데이터, 근거 코드.
- **아래 검토 독**: 아래 세 탭. 탭마다 상태 점과 '남은 건수'가 붙어 탭 줄이 곧 할 일 요약입니다.

## 검토 독 (기획 의도 · 회귀 테스트 · 모델 밖 변경)

무대 아래 탭에서 봅니다 (자세한 설명: [`review.md`](review.md)).

- **전/후 비교**: 변경 전 모델(`--before-model`)을 주면 각 단계의 오른쪽 설명에 '변경 전' 내용이, 흐름 개요에 '없어진 단계'가 나옵니다. 없으면 변경 오버레이(바뀐 이유와 근거)만 보여 줍니다.
- **기획 의도 대조**: 기획자의 기대사항(`intent.json`)을 모델에 대조해 충족/미충족/확인 불가로 표시합니다. 모델로 증명할 수 없는 항목은 억지로 통과시키지 않고 `확인 불가`로 둡니다. 어떤 기대사항과도 연결되지 않은 변경(범위 이탈 후보)도 따로 모읍니다.
- **회귀 지도**: 이번 변경이 닿는 유즈케이스(직접 변경 · 같은 테이블/외부 엔드포인트/파트를 쓰는 간접 영향)와, 그 경로를 언급하는 테스트가 있는지를 보여 줍니다. 테스트를 못 찾았다는 것은 '테스트 없음'이 아니라 '경로 문자열로는 못 찾음'입니다.

```bash
nacholens build --repo R --base B --model M --intent intent.json [--before-model before.json] --strict-intent
nacholens intent --model M --intent intent.json --repo R --base B
nacholens impact --repo R --base B --model M
```

`--strict-intent` 에서 미충족 기대사항이 있으면 종료 코드 4.

## PR 안에서 설명하기

리뷰어가 PR 화면만 보고 이해하도록 build 결과를 PR 코멘트 하나로 만듭니다. 요약, 구조도(그림 또는 Mermaid), 바뀐 흐름별 단계(번호는 플레이어와 같음), 기획 대조, 다시 테스트할 체크리스트, 흐름에 안 잡힌 변경, 기준 커밋이 들어갑니다. 자세한 내용: [`pr.ko.md`](pr.ko.md).

```bash
nacholens snap --page nacholens-out/<제품>.html --lang ko      # 선택: Node 24+, 로컬 Chrome 필요. 그림 + 흐름별 GIF (라이트·다크)
nacholens media upload --from nacholens-out --pr <번호>        # 선택: 그림을 nacholens-media 브랜치에 올림
nacholens pr   --from nacholens-out --lang ko --repo-url https://github.com/<o>/<r> --pr <번호> [--media-url …] [--player-url …] [--comment]
```

## 명령

| 명령 | 하는 일 |
|---|---|
| `demo [--out dir]` | 함께 들어 있는 데모를 빌드합니다(커밋 두 개짜리 일회용 git 저장소) |
| `build --repo R --base B [--head H]` | 검증 → 근거 확인 → **변경 오버레이 계산** → 페이지 작성 |
| `build <model.json> [--changes c.json]` | 모델(과 선택적으로 손으로 쓴 오버레이)에서 페이지를 만듭니다. 저장소는 필요 없습니다 |
| `init --repo R` | 빈 모델 템플릿. 채울 곳은 모두 `TODO` 로 시작합니다 |
| `scan --repo R [--json] [--limit N]` | 모델 초안을 쓰기 위한 **단서**: 스택, 라우트, 게이트웨이, 데이터 드라이버, 바깥으로 나가는 호스트, 환경 변수로 주입되는 주소, HTTP 호출 |
| `scan --repo R --depth diff --base B [--head H] [--json]` | **깊이 1(diff) 모델의 후보**: 바뀐 파일, 바뀐 줄, 그 줄 안의 라우트 / 데이터 접근 / 호출 |
| `validate [model] [--changes c]` | 스키마 검사. 템플릿이면 남은 `TODO` 를 알려 줍니다 |
| `verify [model] (--repo R [--ref X] \| --source DIR)` | 모든 근거 범위가 소스에 있는지 확인합니다(`git show` 를 읽으므로 체크아웃이 필요 없음) |
| `diff --repo R --base B [--head H] [--out c.json] [--strict]` | 변경 오버레이만 만듭니다 |
| `install --claude \| --agents \| --to DIR` | 에이전트가 찾을 수 있는 곳에 스킬과 자체 완결형 CLI 를 놓습니다 |
| `intent --model M --intent I [--repo R --base B]` | 기획자의 기대사항(`intent.json`)을 모델에 대조합니다: 충족 / 미충족 / 확인 불가, 그리고 어떤 기대사항도 가리키지 않는 변경. `--strict-intent` 는 미충족이면 종료 코드 4 |
| `impact --repo R --base B` | 회귀 지도: 다시 확인할 유즈케이스(직접 변경, 또는 바뀐 테이블 / 엔드포인트 / 부품을 공유)와 테스트가 그것을 언급하는지 |
| `snap --page P [--flows N] [--themes light,dark] [--optional]` | PR 용으로 빌드된 페이지의 그림: 정지 그림 하나와 바뀐 흐름마다 GIF 하나. 로컬 headless Chrome 을 씁니다(Node 24+). [`pr.ko.md`](pr.ko.md) |
| `pr --from OUT [--repo-url U --pr N] [--media-url M] [--player-url L] [--comment]` | build 결과를 GitHub PR 코멘트 하나(`pr.md`)로: 요약, 다이어그램, 바뀐 흐름의 단계별 설명, 기획 대조, 다시 테스트할 목록, 흐름이 보여 주지 못하는 것. `--comment` 는 코멘트를 달거나, 이미 있으면 갱신합니다. [`pr.ko.md`](pr.ko.md) |
| `media upload --from OUT --pr N` | `snap` 그림을 `nacholens-media` 브랜치(`pr-<n>/<head7>/`)에 올립니다. 바뀐 것이 없으면 새 커밋을 만들지 않고, `pr` 이 쓰는 고정 URL을 적어 둡니다. [`pr.ko.md`](pr.ko.md) |
| `media prune [--apply] [--superseded]` | 닫히거나 머지된 PR 의 그림을 보여 주고(모의 실행), `--apply` 를 주면 새 커밋으로 지웁니다. [`pr.ko.md`](pr.ko.md) |

`build` 의 검토 옵션: `--before-model <file>`(기준 커밋에 맞춰 쓴 모델, 흐름 자체를 비교합니다)과 `--intent <intent.json>`. [`review.md`](review.md) 를 보세요.
깊이: `scan`, `validate`, `verify`, `build` 의 `--depth 1|2|3`(또는 `diff|brief|full`) (아래 참고). `nacholens --version` 은 CLI 버전을 출력합니다.
공통 옵션: `--model <file>`(기본 `<repo>/.nacholens/model.json`), `--out <dir>`(기본 `./nacholens-out`), `--format html\|artifact\|both\|auto`, `--agent <name>` 또는 `NACHOLENS_AGENT`, `--lang en\|ko`(페이지의 문구, 기본 `en`), `--strict`.
**분석 대상 저장소는 읽기만 합니다.** CLI는 `--out` 과 모델 파일에만 씁니다. 모델은 `--model` 로 저장소 밖에 두세요.

## 깊이: 1 변경만 · 2 한눈에 · 3 자세히

모델을 쓰기 전에 **저장소의 어디까지 담을지**를 정합니다. 깊이는 세 가지이고, 말할 때는 **깊이 1 / 2 / 3** 이라고 합니다. 모델의 선택 필드 `"depth"` 에는 기술 이름(`diff` / `brief` / `full`)이 저장되고 `--depth` 는 둘 다 받습니다(`--depth 2` = `--depth brief`). 깊이 1 은 "얕다"가 아니라 **변경에 한정한다**는 뜻이며, 그 범위 안에서는 테이블·부품까지 담을 수 있습니다.

| 이렇게 말하면 | 저장되는 이름 | 뜻 |
|---|---|---|
| 깊이 1 · 변경만 | `diff` | 변경이 닿는 부분만 |
| 깊이 2 · 한눈에 | `brief` | 세부 없는 전체 구성 |
| 깊이 3 · 자세히 | `full` | 전체 구성과 세부까지 |

| | **1 · 변경만** (`diff`) | **2 · 한눈에** (`brief`) | **3 · 자세히** (`full`) |
|---|---|---|---|
| 답하는 질문 | "이번 변경이 어디를 건드렸나?" | "이 서비스는 어떻게 짜여 있나?" | "안쪽을 보여 줘: 테이블·부품·엔드포인트·데이터" |
| 유즈케이스 | 바뀐 것만, 바뀐 단계만 | 주요 2~5개, 각 3~8단계 | 필요한 만큼, 각 5~10단계 |
| 컴포넌트 | 바뀐 단계가 지나는 것 | 전부 (저장소 포함) | 전부 |
| 세부 (parts·wires·tables와 columns·endpoints·trace·data·payload·transforms) | 바뀐 단계가 지나는 것만 | 없음 | 전부 |
| 분량 | 유즈케이스 1~4개, 단계 1~10개 | 컴포넌트 4~9개, 단계 약 10~30개 | brief + 서비스당 parts 6~16개, column 있는 tables, 근거 약 100~250건 |
| 필요한 것 | `--repo` + `--base` | 저장소만 | 저장소만, 읽을 양이 가장 많음 |

깊이를 말하지 않으면 에이전트가 요청을 보고 고릅니다(변경을 말하면 1, "어떻게 동작해?"는 2, "테이블까지 자세히"는 3, 불분명하면 비교할 ref 가 있을 때 1, 없으면 2). 묻지 않고 만든 뒤 어느 깊이로 만들었고 무엇이 빠졌는지 알려 줍니다. 더 깊게/좁게 보려면 "깊이 3 으로" "깊이 1 로"라고 말하면 됩니다.

예시 명령 (`SV` = `node src/cli.js`):

```bash
# diff: 이번 변경에 모델링할 것(후보이지 사실이 아님) → 검사 → 빌드
SV scan --repo ~/work/my-api --depth diff --base main
SV validate my-api.model.json --repo ~/work/my-api --base main     # 변경 밖의 것이 있으면 경고
SV build    --repo ~/work/my-api --base main --model my-api.model.json

# brief: 세부 없는 전체 그림
SV scan --repo ~/work/my-api --depth brief
SV validate my-api.model.json --depth 2                            # = --depth brief; parts·tables·trace 등이 있으면 경고
SV build    --repo ~/work/my-api --base main --model my-api.model.json --depth brief

# full: 스키마가 담는 것 전부
SV validate my-api.model.json --depth full                         # 빠진 tables·parts·endpoints 를 경고
SV verify   my-api.model.json --repo ~/work/my-api --depth full
```

깊이 규칙은 **경고만** 합니다(종료 코드 0). 규칙을 어겨도 모델은 유효합니다. 모델에 `depth` 도 없고 `--depth` 도 없으면 검사하지 않습니다. `build` 는 상단 바에 `깊이 2 · 한눈에`(또는 `깊이 1 · 변경만`, `깊이 3 · 자세히`. 영어 페이지에서는 `Depth 2 · Overview` 등) 같은 칩을 보여 주고 `report.json` 에 `depth`·`depthWarnings` 를 씁니다. 데모 쇼핑몰에 세 수준이 모두 있습니다(`models/demo-shop/model.json` = full, `model.brief.json`, `model.diff.json`). 데모 변경에서 컴포넌트는 7 / 7 / 5개, 단계는 27 / 27 / 4개입니다. 형식: [`model-schema.md`](model-schema.md#optional-depth-collection-depth).

## 변경 오버레이가 만들어지는 방식

`git diff base..head` 를 모델의 근거(`file:lines`)와 대조합니다.

- **바뀐 단계**: 근거가 바뀐 줄과 겹칩니다. 근거가 *전부* 새 코드이면 `added`, 파일이 사라졌으면 `removed`, 그 밖에는 `modified` 입니다.
- **바뀐 컴포넌트**: 자기 근거가 겹치거나, 바뀐 단계 또는 링크의 끝점이면서 **이 저장소 안에 있는 것**(`client`, `gateway`, `service`)입니다. 데이터베이스와 외부 서비스는 단계가 말을 건다는 이유만으로는 표시하지 않습니다.
- **모델 밖(`unmapped`)**: 어떤 단계도 인용하지 않는 변경 파일. 검토 독("모델 밖 변경")과 `changes.json` 에 파일, 줄, 이유와 함께 나열됩니다. 스타일시트는 따로 보고하고(`category: "style"`) `--strict` 는 무시합니다.
- **무시**: 테스트, 문서, 락 파일, 정적 자산. 이유와 함께 이름을 밝히며 조용히 버리지 않습니다.
- 근거 줄은 `model.source.commit` 기준입니다. `head` 가 다르면 줄을 diff 로 옮겨 계산합니다.

## 출력 규칙

| 실행하는 에이전트 | 출력 |
|---|---|
| **Claude** (`--agent claude`) | **아티팩트** (`<product>.artifact.html` + `.json`) |
| 그 밖의 에이전트, 또는 사람 | **단일 HTML 파일** (`<product>.html`): 오프라인, CDN 없음 |

둘 다 같은 모델 데이터와 같은 플레이어에서 나옵니다. 종료 코드: `0` 정상 · `1` 모델/근거 문제 · `2` 사용법, 입출력 또는 git 오류 · `3` `--strict` 가 모델이 다루지 않는 바뀐 *코드*를 발견. `--out` 의 `report.json` 은 CI 용입니다(여기서는 연결하지 않았습니다).

| 코드 | 뜻 |
|---|---|
| 0 | 성공 |
| 1 | 모델/근거 문제 (템플릿 미작성, 스키마 오류, 근거가 소스와 다름) |
| 2 | 사용법·입출력·git 오류 |
| 3 | `--strict`: 모델에 없는 **코드** 변경 발견 (스타일 파일만이면 해당 없음) |

모델과 오버레이 형식: [`model-schema.md`](model-schema.md).

## 솔직한 한계

- **모델은 사람이(또는 에이전트가) 쓰는 선언입니다.** 에이전트(또는 사람)가 코드를 읽고 컴포넌트, 유즈케이스, 단계를 선언합니다. `verify`가 틀린 근거를 잡고 `unmapped`가 새 경로를 알려 주지만, *새 경로를 모델에 넣는 일은 수동*입니다. 처음 만드는 모델은 코드를 실제로 읽어야 합니다.
- **의미 변화는 감지하지 못합니다.** 줄 겹침 기준이라, 근거 줄 밖에서 일어난 동작 변화(근거 줄이 움직이지 않은 응답에 새 필드가 생기는 경우)는 `unmapped` 파일로만 신호가 옵니다. 정적 분석·런타임 추적은 하지 않습니다.
- **모델이 일부만 인용한 파일은 그 파일의 다른 변경 줄을 가립니다.** 단계가 `models.py:89` 를 인용하는데 커밋이 `models.py:54` 도 고쳤다면, 그 파일은 다뤄진 것으로 칩니다. 어떤 단계도 인용하지 않는 파일만 "모델 밖"에 나열됩니다. 지켜보고 싶은 코드는 인용하세요.
- **실패 분기**(401/403/409 등)는 별도 경로로 그리지 않습니다. 중요하면 단계로 모델링하세요.
- **화면 문구는 기본이 영어이고, `build`·`demo`에 `--lang ko`를 붙이면 한국어로 나옵니다.** CLI 메시지와 검증 안내는 아직 한국어입니다. 모델의 라벨·설명은 직접 쓰는 것이므로 어떤 언어든 됩니다. CLI 메시지의 번역이 가장 환영받는 기여입니다.
- Chromium(headless 포함)에서만 확인했고 Claude.ai 아티팩트 패널은 시험하지 않았습니다.
- 관련 없는 공개 저장소(Python/FastAPI)에서, 에이전트가 `SKILL.md` 만 보고 쓴 모델로 시험했습니다. [`examples/external/`](../examples/external/)(소스와 라이선스)과 `models/external/` 을 보세요. 이것은 *과정의 예*이지 그 프로젝트를 보증하는 설명이 아닙니다.
- `scan`은 Node(Express·Hono·Fastify·Koa·Next·Nest), Python(FastAPI·Flask·Django), Go(`net/http`·chi·gin·echo), Spring 어노테이션과 흔한 게이트웨이·인프라 파일을 압니다. 그 밖의 스택도 쓸 수 있지만 단서가 적습니다.

## 문서

- [`skills/nacholens/SKILL.md`](../skills/nacholens/SKILL.md): 에이전트 플레이북(품질 기준인 근거, 단계 크기, 좋은 예·나쁜 예를 이해하려면 읽으세요). 영어
- [`model-schema.md`](model-schema.md): `model.json` 과 `changes.json`
- [`pr.ko.md`](pr.ko.md): PR 안에서 PR 설명하기(`snap` + `pr`)
- [`guide.md`](guide.md): English guide
- [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`SECURITY.md`](../SECURITY.md)

## 구성

```
src/cli.js        명령, 종료 코드              src/diff.js     git diff × 근거 → 오버레이
src/model.js      스키마 검증                  src/verify.js   근거 대 소스
src/scan.js       모델을 위한 단서             src/page.js     모델 → 페이지 (html | artifact)
src/install.js    스킬 설치기                  src/demo.js     결정적 데모 저장소
src/player/       템플릿, CSS, JS (SVG 플레이어, 글은 textContent 로만)
demo/shop/        공개 데모 앱 v1 → v2         models/demo-shop/   그 모델과 오버레이
skills/nacholens/SKILL.md                      examples/           생성된 데모 페이지 (시험함)
```

`npm test` 는 모든 것을 실행합니다(약 1초). 도구와 데모 앱 모두 Node 24+ 가 필요합니다(`node:sqlite` 가 내장되어 있습니다). CI 는 Node 24 에서 돕니다.

## 라이선스

Apache License 2.0 ([`LICENSE`](../LICENSE), [`NOTICE`](../NOTICE)). 이름과 로고는 상표로 사용할 권리를 부여하지 않습니다. 외부 코드·이미지는 포함하지 않습니다. 페이지에 내장하는 글꼴(IBM Plex Sans / Mono의 서브셋을 Nacho Sans / Nacho Mono로 이름 바꾼 것, Anton)은 SIL Open Font License 1.1을 따릅니다([`src/player/fonts/FONTLOG.md`](../src/player/fonts/FONTLOG.md)).

화면은 [Nacho Combo 디자인 시스템](https://github.com/mafianacho/nachocombo)을 따르며 라이트·다크는 시스템 설정을 따릅니다.
