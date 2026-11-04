# Model and change-overlay formats

`src/model.js` (`validateModel`, `validateChanges`) is the source of truth; this page is its description.

## `model.json`

```jsonc
{
  "schemaVersion": 1,
  "product": { "id": "my-api", "name": "My API", "description": "One or two sentences." },
  "source":  { "repo": "owner/repo", "commit": "SHA of the commit whose code you read" },
  "components": [{
    "id": "api",                              // lowercase-with-hyphens, unique
    "kind": "client | gateway | service | datastore | external",
    "label": "Order API\nNode http",          // text after \n is the sub-title
    "detail": "What it is and does, one or two sentences.",
    "lane": 2, "row": 1,                      // optional layout hints (0-9). Default lanes: client 0, gateway 1, service 2, datastore/external 3
    "evidence": [{ "file": "api.js", "lines": [36, 85], "contains": "async function route" }]
  }],
  "links": [{ "a": "browser", "b": "gateway", "label": "HTTP, same origin /api/*", "evidence": [ ... ] }],  // one per pair, undirected
  "useCases": [{
    "id": "list-orders", "title": "List my orders", "summary": "...", "trigger": "GET /api/orders",
    "steps": [{
      "id": "query",
      "kind": "request | response | call | internal",
      "from": "api", "via": ["gateway"], "to": "db",   // via: components passed through (e.g. the gateway); every hop needs a link
      "label": "Read the user's orders",
      "narration": "One or two plain sentences for a non-developer.",
      "request": "one-line summary",                    // required for request and call
      "response": "one-line summary",                   // required for response and call
      "evidence": [ ... ]
    }]
  }]
}
```

Step kinds: `request` one way in · `response` one way out · `call` a round trip (database, third party) · `internal` a decision inside one component (`from` = `to`, no `via`).

`evidence` entries are `{file, lines:[start,end], contains?}`: a repository-relative path (no `..`, not absolute), an inclusive line range, and an optional string that must appear inside that range. `verify` fails when the file, the range or the string does not match the source at `source.commit`. Use `contains`: without it a range that drifted onto other code goes unnoticed (`verify` warns).

Validation rejects: items without evidence, links or steps over undeclared links, duplicate ids, unknown kinds or keys, absolute or `..` paths, `call` steps without a response summary, leftover `TODO`s from the template.

## Optional `depth` (collection depth)

```jsonc
{ "schemaVersion": 1, "depth": "diff | brief | full", ... }
```

`depth` says how much of the repository the model covers. It is optional and top-level: a model without it behaves exactly as before and gets no depth check. Any other value is a validation error. The CLI warns (exit code unchanged) when a model does not follow its depth:

| Depth | The model holds | Warned when |
|---|---|---|
| `diff` | only what a git change touches: changed steps, the components, links, tables and `trace` parts they pass | a component, link, table or part no step passes; with a change scope (`--repo --base` or `--changes`), a step the change does not touch |
| `brief` | the whole composition without drill-down | any `parts`, `wires`, `tables`, `endpoints`, or step `trace`, `data`, `endpoints`, `payload`, `transforms` |
| `full` | the whole composition and all drill-down | a datastore without `tables`, a service without `parts` (or parts without `wires`), an external without `endpoints`, a call step without `data` / `endpoints`, a step through parts without `trace`, no `payload` at all |

`--depth diff|brief|full` on `validate`, `verify` and `build` applies the same rules to a model without the field; if the model declares another depth the command exits 1. `build` shows the depth in the page's top bar and writes `depth` and `depthWarnings` into `report.json`. Comparison and example commands: [`guide.md`](guide.md#collection-depth-diff-brief-full). `models/demo-shop/` has all three: `model.json` (full), `model.brief.json`, `model.diff.json`.

## Optional drill-down detail

All fields below are **optional**. A model without them is valid and renders exactly as before; a node that has any of them gets a "· 상세" caption and opens a detail view on click (Esc, the back button or browser Back closes it). Every item carries its own `evidence` and `verify` checks it like any other item.

```jsonc
// on a client / gateway / service component: its inside and the wiring between the parts
"parts": [{
  "id": "orders-svc", "label": "OrderService",
  "role": "route | handler | middleware | service | port | adapter | job | module",
  "detail": "What this part does, one or two sentences.",
  "connects": "db",                       // optional: the component this part talks to (adapters)
  "evidence": [ ... ]
}],
"wires": [{ "from": "orders-route", "to": "orders-svc", "label": "listOrders(user)", "evidence": [ ... ] }],   // directed, both ends are parts of this component

// on a datastore component: its tables and columns
"tables": [{
  "name": "order_events", "detail": "...",
  "columns": [{ "name": "kind", "type": "text", "note": "created|paid|shipped" }],   // type and note optional
  "evidence": [ ... ]                     // the migration / schema lines
}],

// on an external component: the endpoints this code calls
"endpoints": [{
  "id": "track", "method": "GET | POST | PUT | PATCH | DELETE | HEAD | WS | RPC | SSE", "path": "/v1/track",
  "auth": "Bearer API key (server setting)",   // optional, the NAME of the scheme only
  "detail": "...",
  "request":  [{ "name": "code", "note": "tracking code" }],    // optional, key fields only
  "response": [{ "name": "status" }],                      // optional
  "evidence": [ ... ]
}]

// on a step: how the step uses that detail
"trace": ["api/orders-route", "api/orders-svc"],        // "component/part" in the order the request passes them
"data": [{ "store": "db", "table": "orders", "op": "read | insert | update | upsert | delete",
           "columns": ["user_id", "status"], "evidence": [ ... ] }],   // the query lines; columns must be declared on the table
"endpoints": ["tracker/track"]                  // "component/endpoint" this step calls
```

Rules the validator enforces:

- `parts`/`wires` only on `client | gateway | service`; `tables` only on `datastore`; `endpoints` only on `external`. `wires` need `parts`.
- `trace`: every entry is a declared part of a component the step passes (`from`, `via`, `to`). Two consecutive parts of the same component need a declared wire between them (either direction); parts of different components need a declared link.
- `data`: `store` is a datastore the step passes; `table` and every `columns` entry are declared on it.
- `endpoints` on a step: declared on a component the step passes.
- **No secrets anywhere in a model.** Strings that look like keys or tokens (`sk-…`, `ghp_…`, `AKIA…`, JWTs, PEM blocks, `Bearer <long value>`) are rejected. Write the auth scheme's name, never a value.

### Optional data shapes and transforms (on a step)

`payload` is what travels on a moving step, shown when the user clicks the dot or the data label. `transforms` is how the data changes at a part on the step's `trace`, shown in the right panel and on the current wire inside the detail view. Both are optional; a step without them shows its `request`/`response` summary as before.

```jsonc
"payload": [{
  "leg": "request | response",           // call: both; request step: request; response step: response; internal: not allowed
  "format": "json | http | sql | row | text | vector | sse | ws",
  "title": "read my orders",             // optional, <= 80 chars
  "body": "SELECT id, item FROM orders WHERE email = ?",   // optional, <= 2000 chars / 40 lines
  "bind":    [{ "name": "?1 email", "value": "<email>" }],  // optional: SQL parameters
  "columns": [{ "name": "id", "value": "INTEGER" }],        // optional: row shape (table, column, value type)
  "evidence": [ ... ]                    // the statement, the struct, or the code that builds the body
}],
"transforms": [{
  "at": "api/orders-post",               // a "component/part" on this step's trace
  "in":  { "type": "validated order", "fields": ["item", "qty"] },
  "out": { "type": "insertOrder arguments", "fields": ["email", "item (cut to 80)", "qty", "tracking"] },
  "map": [{ "from": "item", "to": "item.slice(0, 80)", "how": "optional note" }],
  "evidence": [ ... ]                    // the lines that do the conversion
}]
```

- At least one of `body`, `bind`, `columns`. Values are **shapes and placeholders** (`<uuid>`, `<text>`, `<int>`, `<email>`, `INTEGER`), never real data: the validator refuses e-mail addresses (other than `example.com/org/net`), phone numbers, resident-number shapes and runs of 10+ digits, besides the secret patterns above.
- Write only fields you saw in code (the struct, the `json!` body, the SQL text). Elide the rest with `…`; do not guess.
- `transforms` need `trace`; `at` must be on it. List them in the order the data flows.
- Their evidence belongs to the step (`verify` checks it; a changed line marks the step).

`diff` maps changed lines to detail items too: `changes.details` lists parts, wires, tables and endpoints whose own evidence changed (`{component, kind: part|wire|table|endpoint, id, change, note}`; a wire's id is `from>to`). They mark items inside the detail view and never badge the component. Table access cited in `step.data` belongs to the step, so a changed query marks the step.

## `changes.json` (change overlay)

`nacholens diff` / `build --repo` produce it; a hand-written file with only the first four fields is accepted too.

```jsonc
{
  "title": "...", "summary": "...", "ref": "repo base..head",
  "components": [{ "id": "api", "change": "added | modified | removed", "note": "..." }],
  "steps":      [{ "useCase": "list-orders", "step": "shipping", "change": "added", "note": "..." }],
  // optional, written by `diff`
  "unmapped": [{ "file": "...", "category": "code | style", "status": "added | modified | deleted", "lines": "...", "hint": "..." }],
  "details":  [{ "component": "db", "kind": "table", "id": "order_events", "change": "added", "note": "..." }],
  "ignored":  [{ "file": "...", "reason": "tests | docs | lock file | static asset" }],
  "generated": { "by": "nacholens diff", "base": "sha", "head": "sha", "modelCommit": "sha", "lineTranslation": true }
}
```

A complete worked example lives in `models/demo-shop/`: `model.json`, the hand-written `changes.example.json` and the generated `changes.auto.json`. `model.brief.json` and `model.diff.json` are derived from them (`npm run build:depth-models`).
