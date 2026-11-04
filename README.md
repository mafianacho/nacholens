# nacholens

[![npm version](https://img.shields.io/npm/v/@mafianacho/nacholens)](https://www.npmjs.com/package/@mafianacho/nacholens) [![CI](https://github.com/mafianacho/nacholens/actions/workflows/ci.yml/badge.svg)](https://github.com/mafianacho/nacholens/actions/workflows/ci.yml) [![License: Apache-2.0](https://img.shields.io/npm/l/@mafianacho/nacholens)](LICENSE)

**English** · [日本語](README.ja.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [中文](README.zh.md) · [한국어](README.ko.md)

See what an AI changed in a backend, without reading code. nacholens turns a repository into one page: pick a use case and watch the request move from the client through your services, database and third parties, with the changed parts highlighted from `git diff`.

![nacholens: a request moving through the demo shop, changed parts highlighted](docs/images/overview.png)

## Use it

Open your AI coding agent (Claude Code, Codex, Cursor, …) in the repository you want to see, copy the block below, write your request on the `My request:` line, and paste it.

```text
Use nacholens to answer my request below about this repository, as a page I can open.

My request: <write what you want to see here>

How:
1. Get the nacholens playbook and CLI (needs Node.js 20+ and git; nothing is installed into this repository):
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

## Try the demo

```bash
npx -y @mafianacho/nacholens@latest demo
# → ./nacholens-demo/demo-shop.html (open it in a browser)
```

## More

- [Guide](docs/guide.md): commands, how the change overlay works, limits
- [Agent playbook](skills/nacholens/SKILL.md), [model format](docs/model-schema.md), [review dock](docs/review.md)
- [Contributing](CONTRIBUTING.md), [Security](SECURITY.md)

Apache License 2.0 ([`LICENSE`](LICENSE), [`NOTICE`](NOTICE)). The embedded fonts are under the SIL Open Font License 1.1 ([`FONTLOG`](src/player/fonts/FONTLOG.md)). Made by [Mafianacho Inc.](https://mafianacho.com)
