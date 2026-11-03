# Review: before/after, intent check, regression map

These answer the questions a reviewer has *after* "what changed?": "what was it before?", "is this what we asked for?" and
"what else can this break?". Nothing is guessed: whatever the model cannot show is reported as `unknown` / "not found", never as a pass.

On the page they live in the **review dock** under the stage, as three tracks:

| Tab | For | Still to check (the count on the tab) |
|---|---|---|
| 기획 의도 | planner | expectations not met or not provable, and flows with changes no expectation points at |
| 회귀 테스트 | QA | use cases to re-test |
| 모델 밖 변경 | developer | folders with changed code that no step cites (config/style and ignored files are listed apart) |

Each tab carries its status (a coloured dot and how many items are left), so the tab bar is the page's to-do summary.
Ticks are a per-viewer convenience kept in browser storage when it is available. Rows never repeat a step: they link to it and the
stage moves there. `#dock=intent|impact|unmapped` in the URL opens a tab; clicking the open tab folds the dock; its top edge resizes it.
The dock is shown whenever there is a change overlay or review data.

## 1. Before / after (`compare`)

Rows are aligned by step id for every use case: **added** (nothing before), **removed** (nothing after), **modified**, **moved**, **same**,
with the component path before and after (a component reached only by an added step is marked new). They are in `review.json`.
On the page, before/after belongs to the step: with two models the current step's explanation lists the fields it had before
(name, kind, route, request, response) or says it only moved, and the flow overview lists the steps that are gone. In overlay mode the
step shows the reason from the overlay (its changed evidence) and nothing is claimed about the old text.

| Mode | How | What it can say |
|---|---|---|
| overlay (default) | model + change overlay | added / removed / "code changed". The old text of a modified step is not in the model, and the row says so. |
| two models | `build --before-model <model written against the base commit>` | the flow itself: label, kind, from/to/via, request/response differences per field, removed steps, moved steps, new/removed use cases |

## 2. Intent check (`intent`)

The planner (or the agent from the planner's words) writes `intent.json`; the CLI checks every expectation against the model.

```jsonc
{
  "schemaVersion": 1,
  "title": "Show shipping status on the order list",
  "source": "link or name of the spec",              // optional
  "expectations": [
    { "id": "ship-lookup", "text": "The order list asks the carrier for each status", "useCase": "list-orders",
      "check": { "type": "step", "match": { "kind": "call", "to": "shipping" } } },
    { "id": "login-first", "text": "Orders are read only after the session check", "useCase": "list-orders",
      "check": { "type": "order", "first": { "table": "sessions", "op": "read" }, "then": { "table": "orders", "op": "read" } } },
    { "id": "no-export", "text": "There is no CSV export", "useCase": "list-orders",
      "check": { "type": "absent", "match": { "text": "csv|export" } } },
    { "id": "wording", "text": "Shipping wording is friendly" }          // no check -> stays "unknown"
  ]
}
```

- `check.type`: `step` (some step matches), `absent` (no step matches), `order` (a `first` step comes before a `then` step).
- A matcher uses any of `kind`, `from`, `to`, `with` (component the step passes), `table`, `op`, `text` (alternatives separated by `|`, case-insensitive substring over label, narration, request, response and column names; no regular expressions).
- Verdict per expectation: **met** (with the proving steps and their `file:lines`), **unmet** (the use case exists but the model shows no such step, or the opposite), **unknown** (no check).
  An expectation whose proving steps were changed by this work is flagged *touched*, so the planner re-reads it.
- **Uncovered changes**: changed steps that no expectation points at. They are candidates for scope drift; a human decides. An expectation with a `useCase` but no `check` claims that use case's changed steps.
- Matching reads the *model*, which cites real code. If the model is wrong the verdict is wrong, so keep `verify` green.

`nacholens intent --model M --intent I [--repo R --base B | --changes C] [--out report.json] [--strict-intent]` prints the verdicts; with `--strict-intent` an unmet expectation exits with code **4**.

## 3. Regression map (`impact`)

For the change overlay, which use cases should be checked again, why, and whether a test mentions them.

- **direct**: the use case holds a changed step.
- **indirect**: a step of another use case shares something the change touched: a **table** (also a changed schema), an external **endpoint**, a **part**, a **wire** (a drill-down item whose own evidence changed), or a **component** whose own evidence changed.
  A component that is merely an end point of a changed step is *not* a link (every use case passes the API, that would flag everything). A changed step's own parts and endpoints are not repeated as reasons.
- **tests** (needs `--repo`): test files at `--head` that mention the use case's route (`/api/orders` matches `"/api/orders"` and `/api/orders/7`, not `/api/orders-archive`).
  States: `covered-changed` (the test file changed in this diff), `covered`, `none-found` (**not** "untested": a test that builds the URL differently is missed), `unknown` (no repository was read).
- Sorted so that use cases without a test come first.

`nacholens impact --repo R --base B [--head H] [--model M] [--out impact.json]` prints it.

## Output

`build` embeds the review data in the page whenever there is an overlay, `--before-model` or `--intent`; with `--repo` it also writes `review.json`
and adds a `review` summary (`compare`, `intent`, `impact` counts) to `report.json`. Without an overlay or review data the dock stays hidden.
