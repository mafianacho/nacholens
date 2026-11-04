# Changelog

## 0.3.2

0.3.1 was never published; everything below is in 0.3.2.

- Node: CI runs on Node 20, 22 and 24 (was 20 and 22); the publish workflow uses Node 24. `engines` stays `>=20`, so Node 20 and 22 users are not blocked. Docs say "Node 20+, checked on Node 24".

### Collection depth

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
