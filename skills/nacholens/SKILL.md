---
name: nacholens
description: Use when a user wants to SEE what an AI changed in a backend/infra repo without reading code, or wants a PR explained in the PR itself. Builds a use-case flow animation (Claude -> artifact, others -> single HTML) with the changed parts highlighted from a git diff, and a PR comment with pictures.
version: 1.5.0
---

# nacholens — show what an AI changed in a backend, without reading code

Use this skill when someone says "show me what changed", "I can't read this diff", "draw how this service works".
The result is **one page**: pick a use case, and a request moves through client → gateway → services → database / third parties → back, step by step.
Whatever the AI changed in this work is highlighted in colour.

You (the agent) write a small **model** of the repo (components, use cases, steps, each backed by `file:lines` evidence). The CLI checks your evidence against the real source, compares a git diff with it, and renders the page. Nothing in the target repo is executed or modified.

## 0. Before you start

- Needs **Node.js ≥ 20** (checked on Node 24) and **git**. No packages to install.
- `SV` below means the CLI. Find it in this order: `./cli/src/cli.js` next to this file (installed copy) → `$NACHOLENS_HOME/src/cli.js` → the `src/cli.js` of the nacholens repository. Run it as `node <path>/cli.js <command>`. Without any copy, `npx -y @mafianacho/nacholens@latest <command>` runs the published package (and `… install --to <dir>` puts this file and a CLI copy into `<dir>/nacholens/`).
- Collection depth (§0.1) needs **nacholens ≥ 0.3.2**: `SV --version` prints it. An older CLI does not know `--depth` (it ignores a `depth` field in the model), so there is no depth check; tell the user to update instead of pretending the check ran.
- **Try it in 30 seconds**: `SV demo` builds the bundled demo shop (gateway → API → SQLite + 3 third parties, with a real change) into `./nacholens-demo/`.
- The **target repo is read-only**. Keep the model file outside it (`--model`) unless the user agrees to the default `<repo>/.nacholens/model.json`.
- Output format: **if you are Claude pass `--agent claude`** (artifact: paste it into the conversation as an HTML artifact); any other agent omits it and gets a single offline HTML file.
- Quote refs that contain `^` or `~` (`--base 'abc123^'`); `report.json` lists changed steps as `useCase/step` ids: map them to titles with your model when you write the explanation.
- Command forms: `SV validate [model.json]` and `SV verify --repo R [--model M]` both take the model as a positional argument or `--model`.
- CLI messages are Korean (validation hints, `TODO` template). File paths, JSON paths and `file:line` are language-neutral; follow them literally. The page's own words are English by default; add `--lang ko` to `build`/`demo` for Korean when the user writes in Korean. The model text (labels, narration) is yours: write it in the user's language.

## 0.1 Pick the depth first — diff, brief or full (nacholens ≥ 0.3.2)

A model always covers *some* part of the repository. Decide how much **before you read code**, write it into the model (`"depth": "brief"`, an optional top-level field) and keep to it. **Say it to the user as depth 1 / 2 / 3, never as the technical name**: 1 = Changes only (`diff`), 2 = Overview (`brief`), 3 = Detailed (`full`). The page chip shows "Depth 2 · Overview". The model and `report.json` store `diff|brief|full`; `--depth` takes `1|2|3` or the names. Depth 1 is not "shallow": it means *limited to the change* (inside that scope it may hold tables and parts). `validate`, `verify` and `build` read the depth from the model and **warn** (exit 0, nothing is blocked) when the model breaks the rules of its depth. `--depth 1|2|3` (or `diff|brief|full`) does the same without the field; if both exist they must agree (otherwise exit 1). A model with no `depth` and no `--depth` is simply not checked, exactly as before.

| Depth | Covers | Leaves out | Size guide | Effort |
|---|---|---|---|---|
| `diff` | What a git change touches: the changed use cases, **only their changed steps**, the components those steps pass, the links between them, the tables those steps read or write (and the parts on their `trace`) | Every untouched use case, step, component and table | 1–4 use cases, 1–10 steps in total, 2–6 components, evidence ≈ 10–50 ranges | Minutes. The scan list is the checklist |
| `brief` | The whole composition: all components, links, the 2–5 **main** use cases (3–8 steps each) and the datastores as components | Drill-down: `parts`, `wires`, `tables` (and columns), `endpoints`, and on steps `trace`, `data`, `endpoints`, `payload`, `transforms` | 4–9 components, 2–5 use cases, ≈ 10–30 steps, evidence ≈ 20–70 ranges | A reading pass over routes, config and connections |
| `full` | Everything `brief` has plus all detail the schema allows: tables with columns (from migrations), a service's parts and wires, external endpoints, and per step `trace`, `data`, `payload`, `transforms` | Nothing the schema can express, but still only what you read | `brief` plus 6–16 parts per service, a table list per datastore, ≈ 100–250 evidence ranges | Hours on a real service; worth it for the use cases the user cares about |

### Choosing the depth

1. **The user said it** ("just what changed", "overview", "everything, with tables"): use that level.
2. **Read the request**: a change is named (last N commits, a PR, a branch vs main, "what changed", "what should I re-test") → `diff`. "How does X work", "draw the architecture", "overview of the service" → `brief`. The inside is asked for (tables and columns, internals, every endpoint, the data that moves, "in detail") → `full`.
3. **Still unclear: do not stop to ask.** Use `diff` when there is a ref range to compare, otherwise `brief`. Say in one line in your report which depth you built and what it leaves out, and offer the next level in the user's words ("this is depth 2, an overview; say \"depth 3\" and I will open the service internals and tables"). Cheap first, deeper on request.
4. Never silently upgrade: `full` on a large repo costs most of the work. If the request is vague and the repository has many services, build `brief` and offer `full` for the part the user names.

### Collection procedure per depth

**diff** — only what the change touches
1. `SV scan --repo R --depth diff --base B [--head H]` lists the changed files, their changed lines (head side) and the routes, data accesses and calls **inside** those lines. Tests, docs, lock files and assets are set apart with a reason. That list is the whole scope.
2. Reuse an existing model of the repo if there is one. Otherwise write a model with only the use cases the changed lines belong to (the route is the `trigger`), only the steps whose code changed, evidence = the changed code (§3.4), the components those steps pass, the links between consecutive stops, only the tables a step's `data` points to, only the parts on a step's `trace`.
3. Do not add neighbouring steps, components or tables "for context". `SV validate <model> --repo R --base B` warns about every component, link, table, part and step the change does not touch.
4. `verify`, then `build --repo R --base B --model M`. Changed files no step covers stay under "not in the model": that is the honest remainder.

**brief** — the whole picture, no detail
1. `SV scan --repo R --depth brief` (25 leads per section; `--limit N` changes it): stack, routes, gateways, data drivers, outbound hosts.
2. Write components (4–9), links, and 2–5 main use cases of 3–8 steps. A datastore is a component; do not list its tables. A third party is a component; do not list its endpoints.
3. Leave out `parts`, `wires`, `tables`, `endpoints`, `trace`, `data`, `payload`, `transforms`. `validate` warns for each one that is there.
4. `verify`, `build`. The page shows `Depth: brief` in the top bar.

**full** — the whole picture and the inside
1. Do the `brief` pass first and get it through `verify`; the flow model is the frame the detail hangs on.
2. Add detail in the order of §3.4.1: parts → wires → `trace` → tables and columns (migrations) → `data` → endpoints → `payload` / `transforms`.
3. `validate` warns about gaps: a datastore without `tables`, a service without `parts` or `wires`, an external without `endpoints`, a call step without `data` / `endpoints`, steps through parts with no `trace`, no `payload` anywhere. Fill a gap only from code you read; if you cannot find it, leave it and say so. Never add an item to quiet a warning.
4. Going from `brief` to `full`: keep every id, add the detail, change `"depth"`. Going from `diff` to a wider level means a new model: the scope is different.

At the end tell the user the depth and the counts `validate` prints (components, links, use cases, steps, parts, tables, endpoints), and what the depth leaves out.

## 1. Shortest path — a model already exists

```bash
SV build --repo <target repo> --base <ref before the change> [--head <ref>] [--model <model.json>] [--out <dir>] [--agent claude]
```

- `--base` is the point before the change (branch, tag or SHA; for a PR, the target branch). `--head` defaults to `HEAD`.
- It validates the model, verifies every evidence range against `model.source.commit`, turns `git diff base..head` into the **change overlay**, and writes the page.
- Output in `--out` (default `./nacholens-out`): `<product>.html` or `<product>.artifact.html` (+ `.json`), `changes.json`, `report.json`.

## 2. No model yet (new repo)

`build` can be your first command: with no model it writes an empty template, lists every blank as a JSON path, and exits with code 1. Then:

1. `SV init --repo <repo> [--model <file>]` — template (every blank starts with `TODO`).
2. `SV scan --repo <repo>` — **leads**, not facts: stack, routes, gateways, data drivers, outbound hosts, env-injected addresses, HTTP calls. Use `--limit N` on big repos.
3. **Read the code** (start from the leads) and fill the model — rules in §3.
4. `SV validate --model <file>` until it exits 0 (structure, remaining `TODO`).
5. `SV verify --repo <repo> --model <file>` until it exits 0 (every evidence range exists in the source at `model.source.commit`).
6. Run `build` (§1). Read the result to the user (§4).

Budget: a first model for a small service is 15–40 steps (`brief` or `full`; a `diff` model is as small as the change). Pick the depth first (§0.1). Do not try to cover everything; two good use cases beat ten shallow ones.

## 3. Writing the model — the part that decides quality

Hard rule: **no guessing.** Every component, link and step needs `evidence` you actually read. If you could not confirm something, leave it out and tell the user.

### 3.0 The smallest complete model (copy the shape)

No gateway, client outside the repo, one use case with every step kind. `SV init` writes a bigger template; this is the shape to aim for.

```json
{
  "schemaVersion": 1,
  "product": { "id": "notes-api", "name": "Notes API", "description": "Small REST API that stores notes in SQLite." },
  "source": { "repo": "owner/notes-api", "commit": "<git rev-parse HEAD>" },
  "components": [
    { "id": "client", "kind": "client", "label": "API client\nbrowser or app", "detail": "Whoever calls the API; it lives outside this repository.",
      "evidence": [{ "file": "main.go", "lines": [20, 20], "contains": "mux.HandleFunc(\"POST /api/notes\"" }] },
    { "id": "api", "kind": "service", "label": "Notes API\nGo net/http", "detail": "Handles /api/notes.",
      "evidence": [{ "file": "main.go", "lines": [30, 34], "contains": "http.Server{" }] },
    { "id": "db", "kind": "datastore", "label": "SQLite\nnotes.db", "detail": "Stores notes.",
      "evidence": [{ "file": "storage/sqlite.go", "lines": [14, 16], "contains": "sql.Open(" }] }
  ],
  "links": [
    { "a": "client", "b": "api", "label": "HTTP /api/notes", "evidence": [{ "file": "main.go", "lines": [20, 20], "contains": "/api/notes" }] },
    { "a": "api", "b": "db", "label": "SQL", "evidence": [{ "file": "storage/sqlite.go", "lines": [14, 16], "contains": "sql.Open(" }] }
  ],
  "useCases": [{
    "id": "add-note", "title": "Add a note", "summary": "A client stores a new note.", "trigger": "POST /api/notes",
    "steps": [
      { "id": "req", "kind": "request", "from": "client", "to": "api", "label": "Send the note", "narration": "The client sends the note text.",
        "request": "POST /api/notes {text}", "evidence": [{ "file": "main.go", "lines": [20, 20], "contains": "POST /api/notes" }] },
      { "id": "validate", "kind": "internal", "from": "api", "to": "api", "label": "Reject empty text", "narration": "An empty note is refused.",
        "evidence": [{ "file": "handlers/note.go", "lines": [31, 34], "contains": "text == \"\"" }] },
      { "id": "insert", "kind": "call", "from": "api", "to": "db", "label": "Save the note", "narration": "The note is written to the database.",
        "request": "INSERT note", "response": "new id", "evidence": [{ "file": "storage/sqlite.go", "lines": [42, 44], "contains": "INSERT INTO notes" }] },
      { "id": "done", "kind": "response", "from": "api", "to": "client", "label": "Return the id", "narration": "The client gets the id of the new note.",
        "response": "201 {id}", "evidence": [{ "file": "handlers/note.go", "lines": [40, 41], "contains": "StatusCreated" }] }
    ]
  }]
}
```

Rules this example shows: `internal` has `from == to` and no `via`; `call` is `from` caller `to` datastore/third party and needs both `request` and `response` text; `request`/`response` steps need their own one-line summary; a gateway is simply absent (no component, no links to it, no `via`); a client that is not in the repo cites **the route it calls** (that line is "where the connection is made").

**If a gateway really exists** (nginx, Traefik, Caddy, Next rewrites, a Worker): add it as `kind: gateway`, link client↔gateway↔service, and put `"via": ["gateway"]` on the steps that cross it. Removing a template gateway means deleting the component, both links and every `via`.

### 3.1 Pick use cases

- 2–5 **things a user or caller does**: sign in, list X, create Y, run a report, receive a webhook. `trigger` is the entry request (`GET /api/orders`).
- Cover variety: one read, one write, one that needs login/session, one that calls a third party. Skip startup, health checks and cron unless the user asked.
- Order them by how often a typical change touches them.

### 3.2 Components (4–9 in total)

- One component per **runtime or system**, never per file or class: browser/app, gateway/proxy, each service, each datastore, each third party.
- `kind`: `client` · `gateway` (reverse proxy, edge, ingress, API gateway, Next rewrites) · `service` · `datastore` (DB, cache, queue, object store) · `external` (third party you do not run).
- **A gateway is optional.** If requests go straight from client to service, the step is `from: client, to: service` with no `via`. Do not invent a gateway; do not hide a real one (scan's "gateway leads" show nginx/Traefik/Caddy/Ingress/rewrites/forwarding fetches).
- External services are often addressed through env vars (`PAYMENTS_URL`). Name the service by what it is after you read the call and its config, not by the variable.
- `lane`/`row` (0–9) are layout hints only; leave them out unless two nodes overlap.

### 3.3 Steps (5–10 per use case)

- One step per **hop or decision a reviewer might care about**: the request, an auth/session check, each validation or permission gate, each database access, each third-party call, building the response, the response.
- `request` (one way in), `response` (one way out), `call` (round trip to a datastore or third party; needs `request` and `response` summaries), `internal` (a decision inside one component).
- Merge trivia (logging, small mapping) into the neighbouring step unless that is what changed. Split things that can fail differently (auth vs validation vs permission).
- One step per external call. Never one step per function.
- `via` lists the gateway(s) between `from` and `to`; every hop needs a declared `link`.
- `narration`: one or two plain sentences, written for someone who does not read code. `request`/`response`: one line, never real secrets, tokens or personal data.

### 3.4 Choosing evidence (this is what the diff is matched against)

Evidence is `{file, lines:[start,end], contains}`. After a change, the CLI marks a step as changed when the diff overlaps its evidence, so evidence must be **tight and honest**:

- Cite the **smallest range that proves the claim** — the route registration, the call site, the SQL statement, the config line. 1–3 ranges per item, usually ≤ 15 lines each.
- Always give `contains`: a distinctive token on a line inside the range (not `async`, not `return`). `verify` fails if the token is not there, which is how it notices lines that drifted; without `contains` it only checks that the range exists (and warns).
- Prefer the code future changes will touch (handlers, queries, calls, config), not imports or type declarations.
- **Do not cite a whole route function or file** for a step: every edit nearby would light the step up. If the step is "ask the shipping tracker", cite the tracker call, not the 50-line handler.
- A step can be reported as **`added`** only when *all* its evidence is brand-new code. Keep evidence to code that implements that one step (not a shared helper or an unchanged neighbour).
- Do not cite the same lines for two steps unless they genuinely share them; both would light up.
- Component evidence = where it is started/configured/initialised. Link evidence = where the connection is made (the URL, the driver connect, the proxy rule).
- `model.source.commit` is the commit whose files you read. **Read the tree of `--head` for the range you will explain** (`git show <head>:path | cat -n`) or, if the checkout is at a different commit, say so in the model (`source.commit` = what you read). Line numbers are translated through the diff automatically, but only between the commit you read and `--head`, so the nearer the better.
- **Cite the statement, not the whole function.** When the change is one line inside a larger statement (a `select: {...}` list, a multi-line call), cite that statement (≤ ~12 lines) with `contains` = its first line.
- **Reformatting and moves.** A commit that re-indents or moves code lights up every step it touches even if behaviour is unchanged. Say so in your explanation: "these steps are marked because their code was moved/reformatted; behaviour looks the same" (only claim "looks the same" if you read both sides).
- **Shared helpers** (token creation, auth guard): cite the helper in the step that is about it. If several use cases genuinely share it, citing it in each is fine, and a later change will correctly light all of them.

### 3.4.1 Optional drill-down detail (parts, wires, tables, endpoints, payload, transforms)

This is the detail of the `full` depth (§0.1); a `brief` or `diff`-without-detail model has none of it. Add it only after the flow model passes `verify`, and only what you read in code. A node without detail stays a plain node; that is fine. Full field list: `docs/model-schema.md` → "Optional drill-down detail".

- **Parts** of a service = what a reviewer would name: each route/socket handler, the auth extractor or middleware, each service, each adapter (DB pool, HTTP client). 6–16 parts, not one per function. Cite the declaration line (`pub struct OrderService {`, `app.get("/x"`, `impl Storage for PgStore`). Set `connects` on adapters to the datastore/external they reach.
- **Wires** = a call you saw from one part to another. Cite the call site (`self.orders.list(`), not the callee. No wire without a call site.
- **`trace`** on a step = the parts this step passes, in order. Consecutive parts need a wire; if the validator says one is missing, either you skipped a part or the wire does not exist — read again, do not add a wire to silence it.
- **Tables** from migrations/schema (`CREATE TABLE`, later `ALTER TABLE … ADD COLUMN`, renames). List the columns a reviewer needs (keys, the columns your steps touch), not every column. Cite the `CREATE TABLE` range plus each `ALTER` you rely on.
- **`data`** on a step = the actual query: `op` from the SQL verb (`INSERT … ON CONFLICT DO UPDATE` = `upsert`), `columns` from the statement, evidence = the statement lines in the repo code. An ORM call counts if you read which columns it writes.
- **Endpoints** of a third party: method + path from the call site, request/response key fields from the body you saw built and the struct it is parsed into. `auth` is a name only (`"Bearer API key (env TRACKER_API_KEY)"`); never a value — the validator rejects key/token-like strings.
- If you cannot find the call site for a wire or the statement for a column, leave it out and say so.
- **`payload`** on a moving step = the concrete data the user sees when clicking the dot: the HTTP line and JSON body you saw built (`json!({...})`, `JSON.stringify({...})`, the request struct), the SQL text with its bind parameters, or the row shape from the table definition. Values are placeholders (`<uuid>`, `<text>`, `<int>`), never real data or keys. Copy field names from the code; write `…` for what you did not read.
- **`transforms`** on a step = where the data changes shape on its `trace`: input type → part → output type, with a short field map (`text → masked (redact)`, `ttlMs → expires_at (Date.now() + ttlMs)`). Cite the conversion lines (the struct literal, the `.bind(` list, the mapping call). One transform per part that actually converts; a part that only passes data on needs none.

### 3.5 Good and bad (from the bundled demo shop)

| Item | Bad | Good |
|---|---|---|
| Step "Ask the tracker for each status" | evidence `api.js:36-85` (whole route) | `api.js` lines of `async function trackShipping`, with `contains: "async function trackShipping"` |
| `contains` | `"async"` | `"DELETE FROM oauth_state WHERE state = ? RETURNING state"` |
| Components | `api.js`, `db.js`, `helpers.js` | `Order API`, `SQLite`, `Shipping tracker` |
| Login use case | 31 steps, one per helper function | 10 steps: start, make state, save state, redirect, consent, callback, consume state, exchange code, save session, done |
| Step label | `Call trackShipping()` | `Ask the tracker for each status` |
| Narration | `Invokes fetch with encodeURIComponent on o.tracking and maps the Promise.all` | `Orders that have a tracking code are looked up in parallel. A failed lookup becomes "unknown" instead of failing the list.` |
| Unknown behaviour | "probably retries on 500" | omit; tell the user it was not verified |

### 3.6 Reading a repo fast

- Start from `scan` leads: routes → pick use cases; data/clients/env addresses → components and `call` steps; gateways/configs → the gateway and how requests reach the service.
- Node: routers (`app.get`, Hono, Fastify, Nest decorators, Next `pages/api` and `app/**/route.ts`), middleware order for auth/CSRF. Python: FastAPI/Flask decorators, dependencies (auth), ORM sessions, `httpx`/`requests` calls, Django `urls.py`. Go: `HandleFunc("GET /x")`, chi/gin routers, middleware chain, `database/sql` calls, `http.Get`/`Do`.
- Rust: `scan` has no framework rules for it yet and may list nothing. Read it with `grep -rn '\.route(\|\.nest(' crates/` (axum: `routes/mod.rs` is the route table; `extract.rs` holds auth extractors; `ws/` holds sockets), `sqlx::query` for SQL, `reqwest` / `self.post(` for outbound calls, and the service layer (`services/*.rs`) for the steps in between. In hexagonal layouts the real step lives in `application/services`; the adapter files are the datastore/external side.
- Pure domain functions that implement a step (a ranking, a classifier, a state transition) belong to that step: cite the one signature line (`pub fn rank_hits(`) next to the service call, so a change to the algorithm lights the step.
- Inline unit-test files (`tests.rs`, `tests_*.rs`, `*_test.rs`) are not recognised as tests; they will show under "not in the model". Say so in one line to the user; do not cite them.
- Generated files (OpenAPI json, lock-like dumps, codegen output) will also show as unmapped. Leave them; mention them once.
- A merge commit is a range too: `git log -1 --format=%P <merge>` prints its parents; use `--base <first parent> --head <merge>` to explain the whole branch that was merged. You may read the model from a later commit than `--head` (`source.commit`); the CLI translates lines and says so in `changes.json`.
- Monorepo: model one product at a time (one `model.json` each).
- For compose/k8s/nginx/Traefik repos, the gateway and ports are in those files, not in app code.

## 4. Reading the result to the user

Use plain words, not file names first. Tell three things from `build` output and `report.json`:

1. **What changed** — `changedSteps` / `changedComponents` as use-case names and step titles (e.g. "In *List my orders*, the new step *Ask the tracker for each status*").
2. **Changes the model does not cover** — `unmapped`, with file names. Meaning: a new path exists, or the model is out of date. Offer to add evidence and rebuild.
3. **How to open it** — the output path (Claude: paste the artifact). Pick a flow on the left and press Play; click a box to watch the same step inside it; the dock under the stage lists what is left to check (planner / QA / developer). The top-right switch shows/hides the change highlight.

If you could not open the page in a browser, say so; do not claim it "looks right".

### 4.0 Commits that are not features (dependency bumps, CI, formatting)

If the diff is mostly lock files, `pyproject.toml`, `package.json`, `go.mod`, CI workflows: the CLI ignores lock files, lists manifests and CI files as **config** (soft grey line, not an error) and the flow usually barely changes. Do not invent a step to give the change a home. Report it as it is: "this is a dependency/tooling change; N flow steps are touched, the rest is maintenance". Cite a dependency line as component evidence only if the claim is real ("the API is built on FastAPI") and you want future version changes to light that component.

Mixed dev/prod infrastructure (a Mailpit container only in `compose.override.yml`): model what runs in production, mention the dev-only container in the `detail` text, and cite the production config.

### 4.1 Triage `unmapped` — never try to zero it in one go

`unmapped` is "changes the model did not see", not an error list.

| Kind | Examples | What to do |
|---|---|---|
| Belongs to a request flow | routes, handlers, queries, config, third-party calls, auth | Add the lines to the right step's `evidence` (a new behaviour = a new step), then `verify` → `build` |
| Not part of any flow | page markup, formatting helpers, type declarations, migrations | Leave it; tell the user in one line that it is UI/helper code and does not appear in the flow |
| Stylesheets, dependency manifests, CI files | `.css`, `pyproject.toml`, `requirements*.txt`, `go.mod`, `package.json`, `.github/workflows/*` | Reported separately (`category: "style"` / `"config"`), soft line only, ignored by `--strict` |

A first model on a new repo will show warnings. Handle new server-side files first; the rest only if the user wants. **Never attach evidence to a step just to silence a warning.**

## 5. Exit codes (for CI later; this skill wires up no CI)

| Code | Meaning | Action |
|---|---|---|
| 0 | Success | — |
| 1 | Model/evidence problem (template unfilled, structure error, evidence differs from the source) | Fix the JSON path / `file:line` in the message |
| 2 | Usage, I/O or git error (unknown ref, wrong path) | Check arguments |
| 3 | `--strict` found changed **code** the model does not cover (style-only files do not count; output is still written) | Add evidence or accept |
| 4 | `--strict-intent`: at least one planner expectation is unmet (output is still written) | Fix the code, or tell the planner the expectation is not met |

In CI, upload `--out` as an artifact and read `report.json` (`ok`, `unmapped`, `depth`, `depthWarnings`).

## 6. Quality bar before you report

- `validate` and `verify` exit 0; `build` exit 0 (or 3 only if the user asked for `--strict`).
- 2–4 use cases, each 3–10 steps (3 is fine for a tiny service; do not pad), every step with evidence you read; no item cites more than ~3 ranges.
- No step is a bare restatement of a function name; narration reads fine to a non-developer.
- The model declares its `depth`, and `validate` printed no depth warning (or you can say why each remaining one is right).
- You did not touch the target repo (check `git status` there).
- You can name what you did **not** model.
- If you added drill-down detail: every part, wire, table, column list and endpoint field came from code you opened, and `verify` covers them (its count includes them).

## 7. Common mistakes

- Typing line numbers from memory → `verify` catches it; open the file and count.
- Skipping the gateway in a step without a direct `link` → validation fails (declare the link or route `via` the gateway).
- Expecting a database or third-party change to mark that component as changed → by design only client/gateway/service code in this repo marks components; datastores/externals show only when their own evidence changes.
- Tests, docs and lock files appear under `ignored` with a reason; they are not silently dropped.
- Citing a huge range to "be safe" → every nearby edit becomes a false "changed step". Narrow it.

## 8. Review dock: before/after, intent check, regression map

Full reference: `docs/review.md` in the repository. Use these when the user asks "what was it before?", "is this what we asked for?" or "what else can this break?".

- **Before/after** is on by default whenever there is a change overlay. For a real flow comparison, write (or reuse) a second model against the **base** commit and pass `--before-model`; without it a modified step shows only its changed evidence, never a guessed old text. Do not invent a before-model: read the base tree.
- **Intent check**: turn the planner's words into `intent.json` (`expectations[]`: `id`, `text` in the planner's own words, `useCase`, optional `check`). Give an expectation a `check` only when a model step can prove it (`step` / `absent` / `order`, matchers `kind|from|to|with|table|op|text`). If you cannot name the step that would prove it, **leave `check` out**: it is reported `unknown` and a human checks it. Never write a check just to get a green result. Run `intent` (or `build --intent`), then tell the user: met / unmet / unknown counts, which met expectations were touched by this work, and the *uncovered* changes (possible scope drift; the user decides).
- **Regression map** needs `--repo --base`. Report the use cases to re-check and why (shared table / endpoint / part / wire), and the ones with `none-found` tests. `none-found` means "no test file mentions the route", not "untested".
- Keep `verify` green first: all three views read the model, so a wrong model gives a wrong verdict.

## 9. Put it in the pull request (nacholens ≥ 0.4.0)

Use this when the user wants the change explained **in the PR itself** ("put it in the PR", "so reviewers understand from the PR alone"). Full reference: `docs/pr.md`. The goal: someone who reads only the PR page understands what changed, where, why it matters and what to re-test.

1. **Build for the PR range**: `SV build --repo R --base <PR base branch or merge-base> --head <PR head> --out nacholens-out --lang <user's language>`. Add `--intent` when there is a plan (§8) and `--before-model` when you wrote one. Keep `verify` green: the comment is only as true as the model.
2. **Pictures (optional)**: `SV snap --page nacholens-out/<product>.html --lang <lang>` (Node 22+ and a local Chrome; it finds Playwright's Chromium too). It writes `nacholens-out/media/` (`map.png`, one GIF per changed flow, dark versions, `manifest.json`). No Chrome: skip it, the comment still works with Mermaid diagrams.
3. **Host the pictures (ask first)**: GitHub has no upload API for comments, so pictures need a URL. With the user's OK, push them to an orphan branch `nacholens-media` of the same repository under `pr-<n>/<head7>/` and pass `--media-url https://github.com/<o>/<r>/raw/<that commit>/pr-<n>/<head7>` (commands in `docs/pr.md`). Never put pictures of a private repository anywhere public. If pushing is not allowed, leave `--media-url` out.
4. **Player link**: if you are Claude and gave the page as an artifact, the user can publish it ("Publish" gives a link anyone with the link can open). For a private repository ask before suggesting that. Pass the link as `--player-url`. Other agents: only link a page the user already hosts.
5. **Write the comment**: `SV pr --from nacholens-out --lang <lang> --repo-url https://github.com/<o>/<r> --pr <n> [--media-url …] [--player-url …]` → `nacholens-out/pr.md`. Read it once before posting: the flow sections must name the use cases you expect, and the "outside the flows" list is the honest remainder (§4.1).
6. **Post or update ONE comment (ask first unless asked)**: find the comment containing `<!-- nacholens:pr -->` and PATCH it, otherwise post it with `gh pr comment` (commands in `docs/pr.md`). After each new push to the PR, rebuild, re-snap and update the same comment; the comment names the commit it was made for.
7. Tell the user the comment URL, what it shows (changed flows and steps by name) and what you left out (no pictures, no player link, flows listed by name only).
