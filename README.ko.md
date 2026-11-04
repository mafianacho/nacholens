# nacholens

[English](README.md) · [日本語](README.ja.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [中文](README.zh.md) · **한국어**

AI가 백엔드에서 무엇을 바꿨는지 코드를 읽지 않고 확인하세요. nacholens는 저장소를 한 페이지로 보여 줍니다. 유즈케이스를 고르면 요청이 클라이언트에서 서비스, 데이터베이스, 외부 서비스로 움직이고, `git diff`로 찾은 바뀐 곳이 강조됩니다.

![nacholens: 데모 쇼핑몰을 지나가는 요청과 강조된 변경 부분](docs/images/overview.png)

## 사용법

보고 싶은 저장소에서 AI 코딩 에이전트(Claude Code, Codex, Cursor 등)를 열고, 아래 블록을 복사해 `요청:` 줄에 보고 싶은 것을 적은 뒤 그대로 붙여 넣으세요.

```text
nacholens로 이 저장소에 대한 아래 요청에, 열어 볼 수 있는 페이지로 답해 줘.

요청: <보고 싶은 것을 여기에 적기>
깊이(선택): 1 변경만 · 2 한눈에 · 3 자세히. 안 적으면 요청에 맞춰 고르고 알려 줘.

방법:
1. nacholens 플레이북과 CLI를 받는다 (Node.js 20 이상과 git 필요, 이 저장소에는 아무것도 설치하지 않음):
   npx -y @mafianacho/nacholens@latest install --to "$HOME/.nacholens-skill" --force
2. "$HOME/.nacholens-skill/nacholens/SKILL.md" 를 읽고 그대로 따른다. CLI는 다음과 같다:
   node "$HOME/.nacholens-skill/nacholens/cli/src/cli.js" <command>
3. .nacholens/ 의 모델 말고는 이 저장소의 파일을 바꾸지 않는다. 페이지는 ./nacholens-out 에 만든다.
4. 페이지가 만들어지면 경로를 알려 주고, 무엇을 보여 주는지 쉬운 말로 설명한다.
```

요청 예시:

- `최근 커밋 5개에서 뭐가 바뀌었고, 무엇을 다시 테스트해야 해?`
- `로그인이 브라우저에서 데이터베이스까지 어떻게 흐르는지 보여 줘.`
- `이 브랜치를 main과 비교해서 이번 작업이 건드린 흐름을 알려 줘.`

## 데모 보기

```bash
npx -y @mafianacho/nacholens@latest demo
# → ./nacholens-demo/demo-shop.html (브라우저로 열기)
```

## 더 보기

- [안내서](docs/guide.ko.md): 명령, 변경 강조가 만들어지는 방식, 한계
- [에이전트 플레이북](skills/nacholens/SKILL.md), [모델 형식](docs/model-schema.md), [검토 독](docs/review.md)
- [기여하기](CONTRIBUTING.md), [보안](SECURITY.md)

Apache License 2.0 ([`LICENSE`](LICENSE), [`NOTICE`](NOTICE)). 내장 글꼴은 SIL Open Font License 1.1을 따릅니다 ([`FONTLOG`](src/player/fonts/FONTLOG.md)). Made by [Mafianacho Inc.](https://mafianacho.com)
