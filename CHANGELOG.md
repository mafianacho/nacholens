# Changelog

## 0.3.1

**Collection depth: `diff`, `brief`, `full`.** Decide how much of a repository a model covers before writing it.

- Model: optional top-level `depth` (`diff | brief | full`). A model without it behaves exactly as before. Other values are a validation error. No new required field, no secrets.
- CLI: `--depth diff|brief|full` on `scan`, `validate`, `verify` and `build` (and `demo`). `validate`, `verify` and `build` check the model against the rules of its depth and **warn** (exit code unchanged): `brief` with drill-down, `full` without tables / parts / endpoints / trace, `diff` with anything the change does not touch. A `--depth` that contradicts the model's own `depth` exits 1.
- `scan --repo R --depth diff --base B [--head H] [--json]` prints the modelling candidates of a change: changed files, changed lines, and the routes, data accesses, calls, hosts and env-injected addresses inside them. `scan --depth brief` shows fewer leads per section.
- `build` shows `Depth: <level>` in the top bar and writes `depth` and `depthWarnings` to `report.json`.
- `nacholens --version` prints the CLI version.
- Playbook (`skills/nacholens/SKILL.md`, 1.4.0): how to choose the depth (default included: the agent decides from the request, never stops to ask, and says which depth it built), what each depth contains and leaves out, size guides, and the collection procedure per depth.
- Docs: depth comparison and example commands in `docs/guide.md` / `docs/guide.ko.md`; one depth line in the copy-paste agent block of all six READMEs; `depth` in `docs/model-schema.md`.
- Demo shop: `model.json` declares `depth: "full"`; `model.brief.json` and `model.diff.json` are derived from it (`npm run build:depth-models`).

## Earlier

See the git history.
