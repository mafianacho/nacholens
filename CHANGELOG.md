# Changelog

## 0.3.4

- Node: CI runs on Node 20, 22 and 24 (was 20 and 22); the publish workflow uses Node 24. `engines` stays `>=20`, so Node 20 and 22 users are not blocked. Docs say "Node 20+, checked on Node 24".
- Claude Code and Codex plugin manifests (git-installable marketplace).

## 0.3.3

Player usability pass. No model or CLI change.

- **Phones:** below 700px the top bar and the transport wrap and shrink instead of widening the page (the page was 504–611px wide on a 390px screen). The progress bar gets its own row.
- **Long names:** flow routes, step labels and the caption wrap to two lines and carry the full text as a tooltip, instead of being cut with an ellipsis.
- **Nothing changed (base = head, or no changed step):** the range reads `abc1234 · No changes` instead of `abc1234 → abc1234`, the highlight switch is disabled, every flow is listed open (no fold called "Not changed"), and the review dock starts folded and says "No changed steps, so nothing needs re-testing" instead of `0 · 0 · 0`.
- **Progress bar:** taller click targets, a mark on changed steps, the current step is outlined, and the tooltip names the step and its change word. The step being played scrolls into view in the sidebar.
- **Flow list:** the flow on screen is never folded away; search also matches step names.

## 0.3.2

- Player: **wires are routed around boxes.** A wire was a straight line between box centres, so it could run under a box between its ends, cross another wire or lie on top of one. Now each wire is an orthogonal path with rounded corners from the side of one box to the side of the other: only through free gaps (clear of every other box), separate exit points for wires sharing a side, separate lanes for wires sharing a gap, and the travelling packet follows exactly the drawn wire. No free path: the old straight hop is the fallback. The gaps between the columns inside a component are wider. No model change.

## 0.3.1

**Collection depth: 1 Changes only · 2 Overview · 3 Detailed** (stored as `diff` / `brief` / `full`). Decide how much of a repository a model covers before writing it. People say depth 1 / 2 / 3; depth 1 is not "shallow" but "limited to the change".

- Model: optional top-level `depth` (`diff | brief | full`). A model without it behaves exactly as before. Other values are a validation error. No new required field, no secrets.
- CLI: `--depth 1|2|3` (or `diff|brief|full`, same thing) on `scan`, `validate`, `verify` and `build` (and `demo`). `validate`, `verify` and `build` check the model against the rules of its depth and **warn** (exit code unchanged): `brief` with drill-down, `full` without tables / parts / endpoints / trace, `diff` with anything the change does not touch. A `--depth` that contradicts the model's own `depth` exits 1.
- `scan --repo R --depth diff --base B [--head H] [--json]` prints the modelling candidates of a change: changed files, changed lines, and the routes, data accesses, calls, hosts and env-injected addresses inside them. `scan --depth brief` shows fewer leads per section.
- `build` shows a chip such as `Depth 2 · Overview` (ko: `깊이 2 · 한눈에`) in the top bar and writes `depth` and `depthWarnings` to `report.json`.
- `nacholens --version` prints the CLI version.
- Playbook (`skills/nacholens/SKILL.md`, 1.4.0): how to choose the depth (default included: the agent decides from the request, never stops to ask, and says which depth it built), what each depth contains and leaves out, size guides, and the collection procedure per depth.
- Docs: depth comparison and example commands in `docs/guide.md` / `docs/guide.ko.md`; one depth line ("1 Changes only · 2 Overview · 3 Detailed") in the copy-paste agent block of all six READMEs; `depth` in `docs/model-schema.md`.
- Demo shop: `model.json` declares `depth: "full"`; `model.brief.json` and `model.diff.json` are derived from it (`npm run build:depth-models`).

## Earlier

See the git history.
