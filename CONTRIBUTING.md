# Contributing

Thanks for helping. nacholens has **no runtime dependencies** and wants to keep it that way: Node >= 20 and git are enough.

## Set up

```bash
git clone https://github.com/mafianacho/nacholens.git && cd nacholens
npm test                 # node --test, a few seconds
node src/cli.js demo     # builds ./nacholens-demo/demo-shop.html from the bundled demo app
```

The demo app itself (`demo/shop/v1`, `v2`) needs Node >= 22.13 (`node:sqlite`); its end-to-end test is skipped on older Node.

## What lives where

| Path | Purpose |
|---|---|
| `src/cli.js` | commands, exit codes (0/1/2/3) |
| `src/model.js` | schema validation (the single source of truth for the schema) |
| `src/verify.js`, `src/diff.js` | evidence check against the source; git diff → change overlay |
| `src/scan.js` | leads for drafting a model (Node, Python, Go, infra files) |
| `src/depth.js` | collection depth (`diff`/`brief`/`full`): the rules that warn, and `scan --depth diff` |
| `scripts/derive-depth-models.js` | derives `model.brief.json` and `model.diff.json` (and the `depth` of `model.json`) for the demo shop |
| `src/player/` | the page: template, CSS, JS (no framework, no network) |
| `src/install.js`, `src/demo.js` | `install` command; deterministic demo repository |
| `skills/nacholens/SKILL.md` | what an agent reads to do the whole job |
| `demo/`, `models/demo-shop/`, `examples/` | public demo app, its model, generated pages |
| `test/` | `node:test`, no dependencies |

## Rules of the road

- **Tests first for behaviour changes.** Write the failing test, then the fix. `scan` additions need a small fixture repository per stack (see `test/scan.test.js`).
- **Player changes are checked in a real browser**: 1440x900 and 1280x720, text no smaller than 12.5px (names) and 11px (captions) on screen; colours only as `:root` tokens and no coloured side bars (a test guards this); every piece of information has one place on the page.
- **Generated files are tested.** After changing the player, the demo model or the generator, run `npm run build:examples` and commit the result; a test fails when `examples/` is stale. After changing `models/demo-shop/model.json` or `changes.auto.json`, run `npm run build:depth-models` too.
- **Evidence over guesses.** Anything the page claims about a repository must come from a `file:lines` range that `verify` can check.
- **Public repository hygiene.** No secrets, private repository names, internal hostnames or screenshots of private systems in code, tests, models or docs. Examples use the demo app.
- **Keep the demo honest.** If you change `demo/shop/*`, the commit ids in `models/demo-shop/model.json` change; regenerate the model and `changes.auto.json` (see `test/diff.test.js` for what must still hold).
- Commits: short imperative subject, a body that says why. One logical change per pull request.

## Pull requests

CI runs `npm test` on Node 20 and 22 for pull requests. It uses no secrets. Fill in the checklist in the PR template.

## License

By contributing you agree that your contribution is licensed under the Apache License 2.0 (see `LICENSE`).
