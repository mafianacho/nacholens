# nacholens

[English](README.md) · **日本語** · [Deutsch](README.de.md) · [Français](README.fr.md) · [中文](README.zh.md) · [한국어](README.ko.md)

**AIエージェントによるコーディングはブラックボックスです。nacholens はそれをホワイトボックスにします。**

![モーショングラフィック（英語表記）。変更前：AIエージェントに変更を頼むと差分の山と3つの疑問（何に触れたか、外部への新しい呼び出しはあるか、何を再テストするか）が残る。変更後：nacholens がリクエストの流れと変更箇所・新規箇所を強調し、3つすべてに答える。](docs/images/blackbox-to-whitebox.gif)

エージェントに変更を頼むと、差分の山が返ってきます。何に触れたのか、外部サービスへの新しい呼び出しが増えたのか、何を再テストすべきかが分かりません。nacholens はその答えを1ページで見せます。

AIがバックエンドに加えた変更を、コードを読まずに確かめられます。nacholens はリポジトリを1枚のページにします。ユースケースを選ぶと、リクエストがクライアントからサービス、データベース、外部サービスへと動き、`git diff` から求めた変更箇所が強調されます。

![nacholens: デモショップを流れるリクエストと強調された変更箇所](docs/images/overview.png)

## 使い方

見たいリポジトリで AI コーディングエージェント（Claude Code、Codex、Cursor など）を開き、下のブロックをコピーして `依頼:` の行に見たいことを書き、そのまま貼り付けてください。

```text
nacholens を使って、このリポジトリについての下の依頼に、開けるページで答えてください。

依頼: <見たいことをここに書く>
深さ（任意）: 1 変更のみ・2 全体像・3 詳細（テーブルや内部まで）。書かなければ依頼に合わせて選び、どれにしたか教えてください。

手順:
1. nacholens の手順書と CLI を取得する（Node.js 24 以上と git が必要。このリポジトリには何もインストールしない）:
   npx -y @mafianacho/nacholens@latest install --to "$HOME/.nacholens-skill" --force
2. "$HOME/.nacholens-skill/nacholens/SKILL.md" を読み、その手順に従う。CLI は次のとおり:
   node "$HOME/.nacholens-skill/nacholens/cli/src/cli.js" <command>
3. .nacholens/ のモデル以外、このリポジトリのファイルは変更しない。ページは ./nacholens-out に書き出す。
4. ページができたら、そのパスを伝え、何が分かるかを平易な言葉で説明する。
```

依頼の例:

- `直近5コミットで何が変わった？何を再テストすべき？`
- `ログインの流れを、ブラウザからデータベースまで見せて。`
- `このブランチを main と比べて、この作業が触れたフローはどれ？`
- `PR #12 を PR の中で説明して：図、変わったフロー、再テストすること。`

## デモを試す

```bash
npx -y @mafianacho/nacholens@latest demo
# → ./nacholens-demo/demo-shop.html（ブラウザで開く）
```

## 詳しく

- [ガイド](docs/guide.md)（英語）: コマンド、変更オーバーレイの仕組み、制限
- [エージェント用手順書](skills/nacholens/SKILL.md)、[モデル形式](docs/model-schema.md)、[レビュードック](docs/review.md)、[PR コメント](docs/pr.md)
- [コントリビュート](CONTRIBUTING.md)、[セキュリティ](SECURITY.md)

Apache License 2.0（[`LICENSE`](LICENSE)、[`NOTICE`](NOTICE)）。同梱フォントは SIL Open Font License 1.1 です（[`FONTLOG`](src/player/fonts/FONTLOG.md)）。Made by [Mafianacho Inc.](https://mafianacho.com)
