# nacholens

[![npm version](https://img.shields.io/npm/v/@mafianacho/nacholens)](https://www.npmjs.com/package/@mafianacho/nacholens) [![CI](https://github.com/mafianacho/nacholens/actions/workflows/ci.yml/badge.svg)](https://github.com/mafianacho/nacholens/actions/workflows/ci.yml) [![License: Apache-2.0](https://img.shields.io/npm/l/@mafianacho/nacholens)](LICENSE)

**English** · [日本語](README.ja.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [中文](README.zh.md) · [한국어](README.ko.md)

**AI agentic coding is a black box. nacholens makes it a white box.**

![Motion graphic. Before: you ask an AI agent for a change and get a wall of diff with three open questions (what did it touch, any new outside calls, what to re-test). After: nacholens shows a request moving through the services with the changed and new parts highlighted, and answers all three.](docs/images/blackbox-to-whitebox.gif)

You ask an agent for a change and get back a wall of diff. What did it touch? Did it add a call to an outside service? What should I re-test? nacholens answers on one page.

See what an AI changed in a backend, without reading code. nacholens turns a repository into one page: pick a use case and watch the request move from the client through your services, database and third parties, with the changed parts highlighted from `git diff`.

![nacholens: a request moving through the demo shop, changed parts highlighted](docs/images/overview.png)

## Use it

Open your AI coding agent (Claude Code, Codex, Cursor, …) in the repository you want to see, copy the block below, write your request on the `My request:` line, and paste it.

```text
Use nacholens to answer my request below about this repository, as a page I can open.

My request: <write what you want to see here>
Depth (optional): 1 Changes only · 2 Overview · 3 Detailed (tables and internals). If I name none, pick by my request and tell me which.

How:
1. Get the nacholens playbook and CLI (needs Node.js 20+, checked on Node 24, and git; nothing is installed into this repository):
   npx -y @mafianacho/nacholens@latest install --to "$HOME/.nacholens-skill" --force
2. Read "$HOME/.nacholens-skill/nacholens/SKILL.md" and follow it. The CLI is:
   node "$HOME/.nacholens-skill/nacholens/cli/src/cli.js" <command>
3. Do not change any file of this repository except the model in .nacholens/. Write the page to ./nacholens-out.
4. When the page is built, give me its path and explain what it shows in plain words.
```

Example requests:

- `What changed in the last 5 commits, and what should I re-test?`
- `Show how sign-in works, from the browser to the database.`
- `Compare this branch with main: which flows did this work touch?`
- `Explain PR #12 in the PR itself: pictures, the changed flows and what to re-test.`

## Try the demo

```bash
npx -y @mafianacho/nacholens@latest demo
# → ./nacholens-demo/demo-shop.html (open it in a browser)
```

## More

- [Guide](docs/guide.md): commands, how the change overlay works, limits
- [Agent playbook](skills/nacholens/SKILL.md), [model format](docs/model-schema.md), [review dock](docs/review.md), [PR comment](docs/pr.md)
- [Contributing](CONTRIBUTING.md), [Security](SECURITY.md)

Apache License 2.0 ([`LICENSE`](LICENSE), [`NOTICE`](NOTICE)). The embedded fonts are under the SIL Open Font License 1.1 ([`FONTLOG`](src/player/fonts/FONTLOG.md)). Made by [Mafianacho Inc.](https://mafianacho.com)
