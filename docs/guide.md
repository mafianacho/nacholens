# nacholens guide

[README](../README.md) · [한국어 안내서](guide.ko.md)

**See what an AI changed in a backend, without reading code.**

Pick a use case ("sign in", "list orders") and watch a request travel from the client through the gateway to your services, database and third parties, step by step. Whatever changed in this piece of work is highlighted in colour. The changed parts come straight from `git diff`.

![Demo shop: the order list now asks a shipping tracker; the new step and the changed parts are highlighted](images/overview.png)

*The bundled demo shop (gateway → API → SQLite + three third-party services), step 4 of "List my orders" while the request travels. Green = new, orange = changed. Changed files that no step covers are listed in the review dock: nacholens never drops those silently.*

- **Backend and infra at a glance**: flows on the left, the architecture in the middle with the request moving as a dot (play / pause / step / speed), a plain sentence for the current step on the right. Click a box to go inside it (parts and wiring, tables, endpoints) and watch the same step move there.
- **Evidence, not guesses**: every component, link and step cites `file:lines`; `verify` checks each citation against the real source.
- **Change overlay from git**: `base..head` is matched against that evidence. Changes that match no step are listed as "not in the model".
- **Review dock**: three tracks under the stage, each tab showing what is still to check: the planner's expectations (met / unmet / unknown), the use cases to re-test (and whether a test mentions them), and changed files no step covers. With a before-model, a step also shows what it said before. [`review.md`](review.md)
- **One offline file**: single HTML, no CDN, no network, no dependencies. If the agent running it is Claude, it can emit an artifact instead.
- **Made for agents**: a `SKILL.md` an AI agent can follow end to end. You ask; the agent writes the model, verifies it and builds the page.

## 5-minute start

You need **Node.js ≥ 20** (checked on Node 24) and **git**. Nothing to install.

### 1. Look at the demo (30 seconds)

```bash
git clone https://github.com/mafianacho/nacholens.git && cd nacholens
node src/cli.js demo
# → ./nacholens-demo/demo-shop.html   (open it in a browser)
```

### 2. Use it on your own repository with an AI agent

Install the skill into the repository you want to explain. Pick the line for your agent:

```bash
node src/cli.js install --claude --into /path/to/your/repo     # Claude Code: .claude/skills/nacholens
node src/cli.js install --agents --into /path/to/your/repo     # Codex and other AGENTS.md agents: .nacholens/ + a block in AGENTS.md
node src/cli.js install --to ~/.my-agent/skills                # any agent that reads SKILL.md folders
```

Then ask your agent, in plain words:

> Use the nacholens skill to show me what changed in the last 5 commits of this repo.

The agent scans the repo, writes a model with evidence, verifies it, builds the page and tells you what changed, in non-developer words. Claude gets an artifact; every other agent gets a single `.html` file. The installed folder is self-contained (the skill plus a copy of the CLI); it needs no network.

### 3. No agent: the CLI by hand

```bash
SV="node $PWD/src/cli.js"
$SV build --repo ~/work/my-api --base main --model ~/work/my-api.model.json
# → ./nacholens-out/<product>.html
```

With no model yet, the same command writes an empty template and lists every blank as a JSON path (exit code 1). Fill it in (`scan` shows leads), then `validate`, `verify`, `build`. Details: [`skills/nacholens/SKILL.md`](../skills/nacholens/SKILL.md).

## Commands

| Command | What it does |
|---|---|
| `demo [--out dir]` | Build the bundled demo (a throw-away git repo with two commits) |
| `build --repo R --base B [--head H]` | Validate → verify evidence → **derive the change overlay** → write the page |
| `build <model.json> [--changes c.json]` | Page from a model (and an optional hand-written overlay), no repository needed |
| `init --repo R` | Empty model template; every blank starts with `TODO` |
| `scan --repo R [--json] [--limit N]` | **Leads** for drafting a model: stack, routes, gateways, data drivers, outbound hosts, env-injected addresses, HTTP calls |
| `scan --repo R --depth diff --base B [--head H] [--json]` | **Candidates for a diff-depth model**: changed files, their changed lines, and the routes / data accesses / calls inside those lines |
| `validate [model] [--changes c]` | Schema check; for a template, the remaining `TODO`s |
| `verify [model] (--repo R [--ref X] \| --source DIR)` | Every evidence range exists in the source (reads `git show`, no checkout needed) |
| `diff --repo R --base B [--head H] [--out c.json] [--strict]` | Only the change overlay |
| `install --claude \| --agents \| --to DIR` | Put the skill and a self-contained CLI where an agent finds it |
| `intent --model M --intent I [--repo R --base B]` | Check a planner's expectations (`intent.json`) against the model: met / unmet / unknown, plus changes no expectation points at. `--strict-intent` exits 4 on unmet |
| `impact --repo R --base B` | Regression map: use cases to re-check (direct, or sharing a changed table / endpoint / part) and whether a test mentions them |
| `snap --page P [--flows N] [--themes light,dark]` | Pictures of the built page for a PR: a still and one GIF per changed flow, via a local headless Chrome (Node 22+). [`pr.md`](pr.md) |
| `pr --from OUT [--repo-url U --pr N] [--media-url M] [--player-url L]` | The build as one GitHub PR comment (`pr.md`): summary, diagrams, changed flows step by step, intent, re-test list, what the flows do not show. [`pr.md`](pr.md) |

Review options for `build`: `--before-model <file>` (model written against the base commit; compares the flow itself) and `--intent <intent.json>`. See [`review.md`](review.md).
Depth: `--depth 1|2|3` (or `diff|brief|full`) on `scan`, `validate`, `verify`, `build` (see below). `nacholens --version` prints the CLI version.
Common options: `--model <file>` (default `<repo>/.nacholens/model.json`), `--out <dir>` (default `./nacholens-out`), `--format html\|artifact\|both\|auto`, `--agent <name>` or `NACHOLENS_AGENT`, `--lang en\|ko` (the page's own words; default `en`), `--strict`.
**The analysed repository is only read.** The CLI writes `--out` and the model file; keep the model outside the repo with `--model`.

## Collection depth: 1 Changes only · 2 Overview · 3 Detailed

Before a model is written, decide **how much of the repository it covers**. Three depths. People say **depth 1 / 2 / 3**; the model field `"depth"` stores the technical name (`diff` / `brief` / `full`) and `--depth` takes either (`--depth 2` = `--depth brief`). Depth 1 is not "shallow": it means *limited to the change*, and inside that scope it can hold tables and parts.

| Say | Name stored | Meaning |
|---|---|---|
| depth 1 · Changes only | `diff` | only what a git change touches |
| depth 2 · Overview | `brief` | the whole composition, no detail |
| depth 3 · Detailed | `full` | the whole composition and its detail |


| | **1 · Changes only** (`diff`) | **2 · Overview** (`brief`) | **3 · Detailed** (`full`) |
|---|---|---|---|
| Question it answers | "What did this change touch?" | "How is this service put together?" | "Show me the inside: tables, parts, endpoints, data" |
| Use cases | only the changed ones, only their changed steps | the 2–5 main ones, 3–8 steps each | as many as you care about, 5–10 steps each |
| Components | those the changed steps pass | all of them (datastores included) | all of them |
| Detail (parts, wires, tables + columns, endpoints, trace, data, payload, transforms) | only for what the changed steps pass | none | all of it |
| Typical size | 1–4 use cases, 1–10 steps | 4–9 components, ≈ 10–30 steps | brief + 6–16 parts per service, tables with columns, ≈ 100–250 evidence ranges |
| Needs | `--repo` + `--base` | nothing but the repository | nothing but the repository, and the most reading |

If you name no depth, the agent picks by your request (a change is named → 1; "how does X work" → 2; "in detail, with tables" → 3; unclear → 1 when there is a ref range, otherwise 2), builds without asking, and tells you which one it built and what is left out. Say "depth 3" or "depth 1" afterwards to go deeper or narrower.

Example commands (`SV` = `node src/cli.js`):

```bash
# diff: what to model for this change (candidates, not facts), then check and build
SV scan --repo ~/work/my-api --depth diff --base main
SV validate my-api.model.json --repo ~/work/my-api --base main     # warns about anything outside the change
SV build    --repo ~/work/my-api --base main --model my-api.model.json

# brief: the whole picture, no detail
SV scan --repo ~/work/my-api --depth brief
SV validate my-api.model.json --depth 2                            # = --depth brief; warns about parts / tables / trace ...
SV build    --repo ~/work/my-api --base main --model my-api.model.json --depth brief

# full: everything the schema holds
SV validate my-api.model.json --depth full                         # warns about tables, parts, endpoints that are missing
SV verify   my-api.model.json --repo ~/work/my-api --depth full
```

The depth rules only **warn** (exit code 0): a model that ignores them is still a valid model. A model with no `depth` and no `--depth` is not checked. `build` shows `Depth 2 · Overview` (or `Depth 1 · Changes only`, `Depth 3 · Detailed`) in the top bar and writes `depth` and `depthWarnings` to `report.json`. The demo shop ships all three (`models/demo-shop/model.json` = full, `model.brief.json`, `model.diff.json`); on the demo change they hold 7 / 7 / 5 components and 27 / 27 / 4 steps. Format details: [`model-schema.md`](model-schema.md#optional-depth-collection-depth).

## How the change overlay works

`git diff base..head` is matched against the model's evidence (`file:lines`):

- **Changed step**: its evidence overlaps a changed line. `added` when *all* its evidence is brand-new code, `removed` when its files are gone, otherwise `modified`.
- **Changed component**: its own evidence overlaps, or it is an end point of a changed step or link **and lives in this repository** (`client`, `gateway`, `service`). Databases and third parties are not marked just because a step talks to them.
- **Not in the model (`unmapped`)**: changed files no step cites. Listed in the review dock ("모델 밖 변경") and in `changes.json` with file, lines and reason. Stylesheets are reported separately (`category: "style"`) and ignored by `--strict`.
- **Ignored**: tests, docs, lock files, static assets: named with a reason, never silently dropped.
- Evidence lines refer to `model.source.commit`; if `head` differs, lines are translated through the diff.

## Output rules

| Running agent | Output |
|---|---|
| **Claude** (`--agent claude`) | an **artifact** (`<product>.artifact.html` + `.json`) |
| any other agent, or a human | a **single HTML file** (`<product>.html`): offline, no CDN |

Both come from the same model data and the same player. Exit codes: `0` ok · `1` model/evidence problem · `2` usage, I/O or git error · `3` `--strict` found changed *code* the model does not cover. `report.json` in `--out` is meant for CI (nothing is wired up here).

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | model or evidence problem |
| 2 | usage, I/O or git error |
| 3 | `--strict`: uncovered code changes |

Model and overlay formats: [`model-schema.md`](model-schema.md).

## Honest limits

- **The model is hand-made.** An agent (or you) reads the code and declares components, use cases and steps. `verify` catches wrong citations and `unmapped` flags new paths, but *adding a new path to the model is manual work*. A first model of a repo takes real reading.
- **Meaning is not detected.** The overlay is line-overlap based. A behaviour change outside the cited lines (a new field in a response whose evidence lines did not move) shows up only as an unmapped file. There is no static analysis, no runtime tracing.
- **A file the model cites only in part hides its other changed lines.** If a step cites `models.py:89` and the commit also edits `models.py:54`, the file counts as covered; only files no step cites are listed under "not in the model". Cite the code you want watched.
- **Failure branches** (401/403/409 …) are not drawn as separate paths; model them as steps if they matter.
- **The page UI is English by default and Korean with `--lang ko`.** CLI messages and validation hints are still Korean. Model text (labels, narration) is yours and can be any language. Translating the CLI messages is the most wanted contribution.
- Checked in Chromium only. The Claude.ai artifact panel was not tested.
- Tested on an unrelated public repository (Python/FastAPI) with a model written by an agent from `SKILL.md` alone: see [`examples/external/`](../examples/external/) (source and licence) and `models/external/`. It is an *example of the process*, not an endorsed description of that project.
- `scan` knows Node (Express, Hono, Fastify, Koa, Next, Nest), Python (FastAPI, Flask, Django), Go (`net/http`, chi, gin, echo), Spring annotations and common gateway/infra files. Other stacks still work; you just get fewer leads.

## Docs

- [`skills/nacholens/SKILL.md`](../skills/nacholens/SKILL.md): the agent playbook (read this to understand quality criteria: evidence, step size, good/bad examples)
- [`model-schema.md`](model-schema.md): `model.json` and `changes.json`
- [`pr.md`](pr.md): explain a pull request in the pull request (`snap` + `pr`)
- [`guide.ko.md`](guide.ko.md): 한국어 안내서
- [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`SECURITY.md`](../SECURITY.md)

## Layout

```
src/cli.js        commands, exit codes        src/diff.js     git diff × evidence → overlay
src/model.js      schema validation           src/verify.js   evidence vs source
src/scan.js       leads for a model           src/page.js     model → page (html | artifact)
src/install.js    skill installer             src/demo.js     deterministic demo repository
src/player/       template, CSS, JS (SVG player, text via textContent only)
demo/shop/        public demo app v1 → v2     models/demo-shop/   its model and overlays
skills/nacholens/SKILL.md                   examples/           generated demo pages (tested)
```

`npm test` runs everything (about a second). The demo app needs Node ≥ 22.13 (`node:sqlite`) to run; the tool itself needs Node ≥ 20. CI runs on Node 20, 22 and 24.

## License

Apache License 2.0, see [`LICENSE`](../LICENSE) and [`NOTICE`](../NOTICE). The name and logo are not licensed for use as a trademark. No third-party code or images are included. The embedded fonts (subsets of IBM Plex Sans / Mono, renamed Nacho Sans / Nacho Mono, and Anton) are under the SIL Open Font License 1.1, see [`src/player/fonts/FONTLOG.md`](../src/player/fonts/FONTLOG.md).

The look follows the [Nacho Combo design system](https://github.com/mafianacho/nachocombo) in light and dark (it follows the system setting).
