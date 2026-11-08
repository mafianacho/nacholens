# nacholens

[![npm version](https://img.shields.io/npm/v/@mafianacho/nacholens)](https://www.npmjs.com/package/@mafianacho/nacholens) [![CI](https://github.com/mafianacho/nacholens/actions/workflows/ci.yml/badge.svg)](https://github.com/mafianacho/nacholens/actions/workflows/ci.yml) [![License: Apache-2.0](https://img.shields.io/npm/l/@mafianacho/nacholens)](LICENSE)

[English](README.md) · [日本語](README.ja.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · **中文** · [한국어](README.ko.md)

**不读代码，也能看清 AI 改了你的代码的哪些地方。**

![之前：AI 智能体交回一大堆 diff 和三个没答案的问题。之后：nacholens 展示请求如何穿过各服务，高亮改动和新增的部分，并回答这些问题（图中为英文标注）。](docs/images/blackbox-to-whitebox.gif)

AI 智能体改了你的代码，交回一份很长的 diff。它动了哪里？现在会调用外部服务吗？该重新测试什么？nacholens 用一幅可以播放的图来回答：

- **选一件用户会做的事**（登录、下单）。一个圆点从浏览器出发，一步一步穿过你的服务、数据库和外部服务。
- **改动的部分用颜色标出**：黄色 = 已改动，绿色 = 新增。
- **每一步都指向真实的代码**，不靠猜测。

产品、测试和开发都能用。不需要读代码。

## 三步使用

1. 在你的项目里打开 AI 编程助手（Claude Code、Codex、Cursor 等）。
2. 复制下面的代码块，在 `我的请求：` 一行写下你想看的内容，然后粘贴。
3. 打开智能体给你的页面。

```text
请用 nacholens 回答我下面关于这个仓库的请求，结果做成一个我能打开的页面。

我的请求：<在这里写你想看的内容>
深度（可选）：1 仅变更 · 2 概览 · 3 详细（含表和内部）。不写就按我的请求选择，并告诉我选了哪个。

做法：
1. 获取 nacholens 的操作手册和 CLI（需要 Node.js 20+（已在 Node 24 上验证）和 git；不会往这个仓库安装任何东西）：
   npx -y @mafianacho/nacholens@latest install --to "$HOME/.nacholens-skill" --force
2. 阅读 "$HOME/.nacholens-skill/nacholens/SKILL.md" 并照做。CLI 是：
   node "$HOME/.nacholens-skill/nacholens/cli/src/cli.js" <command>
3. 除 .nacholens/ 里的模型外，不要修改这个仓库的任何文件。页面写到 ./nacholens-out。
4. 页面生成后，告诉我它的路径，并用通俗的话说明它展示了什么。
```

你可以这样问:

- `最近 5 次提交改了什么？我需要重新测试哪些？`
- `展示登录是怎么工作的，从浏览器到数据库。`
- `把这个分支和 main 比较：这次工作涉及了哪些流程？`
- `在 PR 里直接解释 PR #12：图片、改动的流程、需要重新测试的内容。`

## 在你的 PR 里

nacholens 还能在拉取请求（PR）里写**一条评论**，让评审者只看 PR 页面就能看懂：改动流程的图片、用通俗的话写成并附有代码链接的每一步、重新测试清单，以及这些图片没有覆盖的内容。[工作原理](docs/pr.md)

<img src="docs/images/pr-comment.png" alt="PR 上的一条 nacholens 评论（英文标注）：摘要、高亮了改动部分的图片、第一个改动的流程" width="600">

## 没有自己的项目也能试

```bash
npx -y @mafianacho/nacholens@latest demo
# → ./nacholens-demo/demo-shop.html（用浏览器打开）
```

## 须知

- 你的项目只会被读取，不会被修改。nacholens 本身不会通过网络发送任何东西。
- 不需要账号，也不需要服务器：只要 Node.js 20+ 和 git。

## 更多

[指南](docs/guide.md)（英文） · [助手操作手册](skills/nacholens/SKILL.md) · [模型格式](docs/model-schema.md) · [评审面板](docs/review.md) · [PR 评论](docs/pr.md)（英文） · [参与贡献](CONTRIBUTING.md) · [安全](SECURITY.md)

Apache License 2.0（[`LICENSE`](LICENSE)、[`NOTICE`](NOTICE)）。内嵌字体：SIL Open Font License 1.1（[`FONTLOG`](src/player/fonts/FONTLOG.md)）。Made by [Mafianacho Inc.](https://mafianacho.com)
