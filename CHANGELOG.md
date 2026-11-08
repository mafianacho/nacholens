# Changelog

## 0.5.0

**Node 24 is the baseline, and a pull request explains itself on every push.** Breaking: Node 20 and 22 are no longer supported (see below).

- **Node 24+.** `engines` is `>=24`, CI runs Node 24, the publish workflow uses Node 24, and every document says "Node 24+". A Node older than 24 stops at startup with one clear message instead of a missing-feature crash. The `snap` Node-22 branch (global `WebSocket`) is gone: Node 24 has it built in, and the demo-shop test no longer skips for `node:sqlite`. Why breaking: 0.4.0 allowed Node 20 and 22 (`engines >=20`); 0.5.0 does not, so it is a minor bump while 0.x.
- **Pictures hosted for you.** `nacholens media upload --from <build out> --pr N` pushes the `snap` pictures to the orphan branch `nacholens-media` under `pr-<n>/<head7>/` and records the commit-pinned URL in `media/media-url.json`; `pr` links it by itself when it was made for the same commit. The work is done in a throw-away clone (your working tree, index and branches are not touched), pushes are never forced (a lost race is redone on the new tip), uploading the same head again makes no commit, the PR number, head and file names are checked against an allow-list, and a branch that does not look like a picture branch is refused. No permission to push (fork PR, read-only token): a clear failure, or `--skip-on-denied` to skip with exit 0.
- **Tidy up.** `nacholens media prune` lists the pictures of closed and merged PRs (`gh pr list`, dry run by default); `--apply` removes them in a new commit, `--superseded` also the older heads of open PRs. PRs that `gh` does not list are kept. History is never rewritten, so old comments keep their pictures.
- **One sticky comment.** `nacholens pr --comment` (with `--repo-url` and `--pr`) posts `pr.md`, or updates the comment that starts with `<!-- nacholens:pr -->` (the first one when there are several; comments that only quote the marker are never touched), using `gh api`. `--skip-on-denied` turns a refused write (fork PR) into a log line and exit 0.
- **No Chrome, no problem.** `snap --optional` exits 0 with a note when there is no Chrome/Chromium; the comment then uses Mermaid diagrams.
- **GitHub Action example**: `docs/action/nacholens-pr.yml`. Three jobs (build `contents: read`; host-pictures `contents: write`, opt-in via the variable `NACHOLENS_PICTURES`, checks out no code; comment `pull-requests: write`, checks out no code), every action pinned to a commit, `pull_request` only, fork PRs skipped, values reach scripts only through `env:`. A test pins that shape.
- Skill: §9 now uses `media upload`, `pr --comment` and the Action (skill version 1.6.0).

## 0.4.0

**Explain a pull request in the pull request.** A reviewer who reads only the PR page understands what changed, in which flow, what the plan said and what to re-test. See `docs/pr.md`.

- `nacholens pr --from <build out> [--repo-url … --pr N] [--media-url …] [--player-url …] [--lang ko]` writes `pr.md`, one GitHub comment: summary counts, an architecture picture or Mermaid diagram (changed parts yellow, new parts green), one section per changed flow (animation or Mermaid sequence diagram with the changed steps boxed, every step listed, changed steps with what happens, route, payload and code links into the PR's Files tab), the intent check, a re-test task list, changed files the flows do not show, and a folded "can I trust this" block naming the commit it was made for. One numbering everywhere (the player's step numbers). Nothing is guessed. No network.
- `nacholens snap --page <html> [--flows N] [--fps N] [--themes light,dark] [--lang ko]` takes pictures of the real player with a local headless Chrome (Node 22+, DevTools protocol, no packages): `map.png` and one GIF per changed flow, light and dark, plus `manifest.json`. The GIF encoder (shared median-cut palette, changed rectangle only) and the PNG decoder are part of nacholens, so there are still no dependencies.
- Player: `window.__nacholens.seek(step, at)` holds a step at one point of its motion (used by `snap`; the `#…&at=` capture hash uses the same code).
- Skill: §9 "Put it in the pull request" (build → snap → host the pictures → pr → one sticky comment, asking before anything is pushed or posted).

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
