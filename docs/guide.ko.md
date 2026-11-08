# nacholens 안내서 (한국어)

**AI가 바꾼 백엔드를 코드를 읽지 않고 파악하세요.** ([README](../README.ko.md) · [English guide](guide.md))

유즈케이스("로그인", "주문 목록 조회")를 고르면 요청이 클라이언트 → 게이트웨이 → 서버 → DB·외부 API로 움직이고 결과가 돌아오는 과정이 단계별 애니메이션으로 보입니다. 이번 작업에서 바뀐 곳은 색으로 강조되며, 바뀐 곳은 `git diff`에서 자동으로 뽑습니다.

![데모 쇼핑몰: 주문 목록에 배송 상태 조회가 추가됨](images/overview.png)

*함께 들어 있는 데모 쇼핑몰(게이트웨이 → API → SQLite + 외부 서비스 3개)에서 '주문 목록 보기' 4단계의 요청이 움직이는 장면. 초록 = 신규, 주황 = 변경. 모델의 어떤 단계도 다루지 않는 변경 파일은 조용히 버리지 않고 하단 검토 독에 모읍니다.*

## 5분 시작

필요한 것: **Node.js 24+, git** (설치할 패키지 없음).

**1. 데모 보기 (30초)**

```bash
git clone https://github.com/mafianacho/nacholens.git && cd nacholens
node src/cli.js demo
# → ./nacholens-demo/demo-shop.html  (브라우저로 열기)
```

**2. 내 저장소에서 AI 에이전트로 쓰기**

설명하고 싶은 저장소에 스킬을 설치합니다.

```bash
node src/cli.js install --claude --into /path/to/your/repo    # Claude Code: .claude/skills/nacholens
node src/cli.js install --agents --into /path/to/your/repo    # Codex 등 AGENTS.md 방식: .nacholens/ + AGENTS.md 블록
node src/cli.js install --to ~/.my-agent/skills               # SKILL.md 폴더를 읽는 그 밖의 에이전트
```

그리고 에이전트에게 말합니다.

> nacholens 스킬로 이 저장소의 최근 커밋 5개에서 뭐가 바뀌었는지 보여 줘.

에이전트가 저장소를 훑고(`scan`), 근거(파일:줄)가 달린 모델을 쓰고, 검증하고, 페이지를 만든 뒤 비개발자 말투로 요약합니다. Claude는 아티팩트, 다른 에이전트는 단일 HTML 파일이 나옵니다.

**3. 에이전트 없이 CLI로**

```bash
SV="node $PWD/src/cli.js"
$SV build --repo ~/work/my-api --base main --model ~/work/my-api.model.json
```

모델이 없으면 같은 명령이 빈 템플릿을 만들고 채울 곳을 JSON 경로로 나열한 뒤 종료 코드 1로 끝납니다. 자세한 절차와 모델 작성 기준(근거 고르는 법, 단계 크기, 좋은 예·나쁜 예)은 [`skills/nacholens/SKILL.md`](../skills/nacholens/SKILL.md)(영어)를 보세요.

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

리뷰어가 PR 화면만 보고 이해하도록 build 결과를 PR 코멘트 하나로 만듭니다. 요약, 구조도(그림 또는 Mermaid), 바뀐 흐름별 단계(번호는 플레이어와 같음), 기획 대조, 다시 테스트할 체크리스트, 흐름에 안 잡힌 변경, 기준 커밋이 들어갑니다. 자세한 내용(영문): [`pr.md`](pr.md).

```bash
nacholens snap --page nacholens-out/<제품>.html --lang ko      # 선택: Node 24+, 로컬 Chrome 필요. 그림 + 흐름별 GIF (라이트·다크)
nacholens pr   --from nacholens-out --lang ko --repo-url https://github.com/<o>/<r> --pr <번호> [--media-url …] [--player-url …]
```

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

깊이 규칙은 **경고만** 합니다(종료 코드 0). 규칙을 어겨도 모델은 유효합니다. 모델에 `depth` 도 없고 `--depth` 도 없으면 검사하지 않습니다. `build` 는 상단 바에 `깊이 2 · 한눈에` 같은 칩을 보여 주고 `report.json` 에 `depth`·`depthWarnings` 를 씁니다. 데모 쇼핑몰에 세 수준이 모두 있습니다(`models/demo-shop/model.json` = full, `model.brief.json`, `model.diff.json`). 데모 변경에서 컴포넌트는 7 / 7 / 5개, 단계는 27 / 27 / 4개입니다. 형식: [`model-schema.md`](model-schema.md#optional-depth-collection-depth).

## 종료 코드

| 코드 | 뜻 |
|---|---|
| 0 | 성공 |
| 1 | 모델/근거 문제 (템플릿 미작성, 스키마 오류, 근거가 소스와 다름) |
| 2 | 사용법·입출력·git 오류 |
| 3 | `--strict`: 모델에 없는 **코드** 변경 발견 (스타일 파일만이면 해당 없음) |

## 솔직한 한계

- **모델은 사람이(또는 에이전트가) 쓰는 선언입니다.** `verify`가 틀린 근거를 잡고 `unmapped`가 새 경로를 알려 주지만, 새 경로를 모델에 넣는 일은 수동입니다. 처음 만드는 모델은 코드를 실제로 읽어야 합니다.
- **의미 변화는 감지하지 못합니다.** 줄 겹침 기준이라, 근거 줄 밖에서 일어난 동작 변화는 `unmapped` 파일로만 신호가 옵니다. 정적 분석·런타임 추적은 하지 않습니다.
- 실패 분기(401/403 등)는 별도 경로로 그리지 않습니다. 중요하면 단계로 모델링하세요.
- **화면 문구는 기본이 영어이고, `build`·`demo`에 `--lang ko`를 붙이면 한국어로 나옵니다.** CLI 메시지와 검증 안내는 아직 한국어입니다. 모델의 라벨·설명은 자유롭게 쓸 수 있습니다.
- Chromium(headless 포함)에서만 확인했고 Claude.ai 아티팩트 패널은 시험하지 않았습니다.
- `scan`은 Node(Express·Hono·Fastify·Koa·Next·Nest), Python(FastAPI·Flask·Django), Go(`net/http`·chi·gin·echo), Spring 어노테이션과 흔한 게이트웨이·인프라 파일을 압니다. 그 밖의 스택도 쓸 수 있지만 단서가 적습니다.

## 문서

[`model-schema.md`](model-schema.md) 모델 형식 · [`CONTRIBUTING.md`](../CONTRIBUTING.md) · [`SECURITY.md`](../SECURITY.md)

## 라이선스

Apache License 2.0 ([`LICENSE`](../LICENSE), [`NOTICE`](../NOTICE)). 이름과 로고는 상표로 사용할 권리를 부여하지 않습니다. 외부 코드·이미지는 포함하지 않습니다. 페이지에 내장하는 글꼴(IBM Plex Sans / Mono의 서브셋을 Nacho Sans / Nacho Mono로 이름 바꾼 것, Anton)은 SIL Open Font License 1.1을 따릅니다([`src/player/fonts/FONTLOG.md`](../src/player/fonts/FONTLOG.md)).

화면은 [Nacho Combo 디자인 시스템](https://github.com/mafianacho/nachocombo)을 따르며 라이트·다크는 시스템 설정을 따릅니다.
