# Explain a pull request in the pull request

`nacholens pr` turns a build into one GitHub comment that a reviewer can understand without opening anything else:
what changed in which flow, in pictures and in words, what the plan said, what to re-test, and what the flows do not show.
`nacholens snap` adds pictures of the real player (a still and one animation per changed flow, light and dark).

```bash
nacholens build --repo . --base origin/main --head HEAD --out nacholens-out [--intent intent.json] [--lang ko]
nacholens snap  --page nacholens-out/<product>.html [--lang ko] [--optional]    # optional: needs Node 24+ and a local Chrome
nacholens media upload --from nacholens-out --pr <number>                       # optional: host the pictures (below)
nacholens pr    --from nacholens-out --repo-url https://github.com/<owner>/<repo> --pr <number> [--comment] \
                [--media-url <where the pictures are>] [--player-url <link to the page>] [--lang ko]
```

`pr --comment` posts the text as the pull request's comment, or updates the one that is already there (see below). To run all of this on every push, use the [GitHub Action example](#run-it-on-every-push-github-action).

## What the comment holds

From top to bottom, in the order a reviewer asks:

1. **Summary**: the change title, how many flows and steps changed (new · changed · removed), how many flows to re-test, how many changed files no flow shows. A link to the interactive player when you pass `--player-url` (a Claude artifact link is named as such).
2. **At a glance**: the still of the player (`map.png`, the dark version for dark mode) or, without pictures, a Mermaid diagram of the architecture with changed parts in yellow and new parts in green. GitHub draws Mermaid itself, so the diagram works in private repositories with no hosting.
3. **One section per changed flow**: the flow's summary, its animation (or a Mermaid sequence diagram with the changed steps in coloured boxes), and the steps. Unchanged steps are one line; a changed step lists what happens, the route, what it sends and gets back, and links to its code. The step numbers ①②③ are the player's numbers, the same in the diagram, the animation's corner label and the re-test list.
4. **Does it do what was planned?** (with `build --intent`): met / not met / unknown per expectation, the steps that prove it, and changed steps that no expectation mentions.
5. **What to re-test**: a task list a reviewer ticks in the pull request, with the reason for each flow and whether a test mentions it ("no test found" is not proof that nothing tests it).
6. **Changes the flows do not show**: changed files that no step cites.
7. **Can I trust this?** (folded): compared range, the commit the model was read at, depth, and the commit the comment was made for. A comment for an older commit is out of date; rebuild it on every push.

Nothing is guessed. A modified step whose old wording is not in the model says so instead of inventing it (pass `--before-model` to `build` for a real before/after).

## Code links

With `--repo-url` and `--pr`, a step's code links open the line in the pull request's **Files changed** tab (`#diff-<sha256 of the path>R<line>`) when the model was read at the head commit. If the model was read at another commit, the links are permalinks to that commit (`/blob/<commit>/<file>#L…`), which always point at the cited lines. Without `--repo-url` they are plain `file:lines`.

## Pictures

`snap` opens the built page in a local headless Chrome (a throwaway profile, nothing leaves the machine) and drives the player itself, so the pictures are exactly what the page shows:

- `map.png`, `map.dark.png`: the stage of the first changed flow at its first changed step, at 2x for sharpness.
- `<use case>.gif`, `<use case>.dark.gif`: each changed flow (at most `--flows`, default 3) step by step at `--fps` (default 10). Changed steps hold 1.8 s, others 0.5 s. A corner label shows the step number, name and change word, the same words as the comment. Typical size: about 100 KB.
- `manifest.json`: what was written; `pr` reads it from `<from>/media/`.

Chrome is looked up in `--chrome`, `$CHROME`, `PATH`, the macOS application folder and Playwright's download cache. The GIF encoder is part of nacholens (one shared palette, no dithering, only the changed rectangle per frame).

Without Chrome (a runner without a browser, `--optional`): `snap --optional` says so and exits 0 without writing pictures, and the comment shows the Mermaid diagrams instead. Without `--optional` a missing Chrome is an error.

## Hosting the pictures: `media upload`

GitHub has no API to upload a comment attachment, so the pictures need a URL. For a repository you can push to, the home is a separate **orphan branch of the same repository** that holds only pictures, `nacholens-media`:

```bash
nacholens media upload --from nacholens-out --pr <number> [--repo <checkout>] [--head <sha>]
# media upload: 3 files -> nacholens-media/pr-12/a1b2c3d (new commit 7f3e9a1)
# media URL: https://github.com/<owner>/<repo>/raw/<media commit>/pr-12/a1b2c3d
```

- The files go to `pr-<n>/<head7>/` (PR number and the first 7 characters of the head commit). The URL is pinned to the **media commit**, so an old comment keeps showing its own pictures. The address is written to `nacholens-out/media/media-url.json`, and `pr` uses it by itself when it was made for the same commit (`--media-url` still wins).
- Nothing else is touched. The work happens in a throw-away clone in the temp folder; your working tree, index, branches and git config do not change, and a code branch's diff never contains pictures. The push is never forced; if another job pushed first, the upload is redone on top of the new tip.
- Uploading the same head again changes nothing (no new commit). A re-snap with different pictures replaces that head's folder in a new commit.
- `--pr`, `--head` and the file names are checked against a short allow-list first (digits; lowercase hex; letters, digits, `._-` with `.png`/`.gif`; no links). The branch must look like a picture branch (only `pr-<n>` folders at the top), otherwise nothing is pushed.
- `--repo-url` is the public address of the repository (default: taken from the remote). `--remote` is a remote name or an address (default `origin`), for a job that has no checkout.
- No permission to push (a fork pull request, a read-only token): it fails with a clear message, and with `--skip-on-denied` it says so and exits 0, so the comment is still posted, with Mermaid diagrams.
- In a public repository anyone can see the pictures, as they can see the code; in a private one only people with access. Pictures of a private repository must not go to a public place: this command only ever writes to the repository you point it at.

### Tidy up: `media prune`

```bash
nacholens media prune                  # dry run: lists the pictures of closed and merged PRs (uses `gh pr list`)
nacholens media prune --apply          # removes them in a NEW commit on the media branch (no force push)
nacholens media prune --apply --superseded   # also the older heads of PRs that are still open
```

A PR that `gh` does not list is kept, and so is every open PR. The deletion is a normal commit, so the files stay in the branch history: links in old comments keep working, but the repository does not get smaller (the branch tip does, so a fresh clone is quick).

## One comment per pull request

The comment starts with `<!-- nacholens:pr -->`. `pr --comment` (needs `gh`, `--repo-url` and `--pr`) updates it instead of adding a new one on every push:

- no comment that starts with the marker -> a new comment is posted;
- one -> that comment is edited in place (same link, same place in the conversation);
- two or more (for example from an older setup) -> the first, oldest one is edited and the others are named in the log and left alone.

A comment that only quotes the marker somewhere in its text is never overwritten. The comment carries the commit it was made for, so an older comment is recognisably out of date.

Posting is a visible action in someone's repository: an agent asks before it posts or pushes pictures, unless it was asked to (installing the workflow below is that ask).

Without a read-write token (a fork pull request, or Dependabot) GitHub refuses the write. `pr --comment` then fails with "no write permission", and `--skip-on-denied` turns that into a log line and exit 0; `pr.md` is still written.

## Run it on every push (GitHub Action)

[`docs/action/nacholens-pr.yml`](action/nacholens-pr.yml) is a ready workflow: copy it to `.github/workflows/`, commit the model as `.nacholens/model.json`, and every push to a pull request rebuilds the explanation and updates the same comment.

It runs `checkout -> setup-node 24 -> build -> snap -> media upload -> pr --comment` in three jobs, because posting and hosting need different permissions:

| Job | Permissions | Does |
|---|---|---|
| `build` | `contents: read` | runs the tool on the pull request's code, takes the pictures |
| `host-pictures` (opt-in) | `contents: write` | pushes `pr-<n>/<head7>/` to `nacholens-media`; checks out no code |
| `comment` | `contents: read`, `pull-requests: write` | writes or updates the one comment; checks out no code |

- **Pictures are opt-in**: set the repository variable `NACHOLENS_PICTURES` to `true`. Without it, no job can write to the repository and the comment uses Mermaid diagrams, which GitHub draws itself.
- **Fork pull requests** get a read-only token, so every job skips them (`head.repo.full_name == github.repository`), and the CLI also treats a refused write as a skip (`--skip-on-denied`).
- **No Chrome** (a self-hosted runner without a browser): `snap --optional` skips the pictures and the comment falls back to Mermaid.
- Every action is pinned to a commit SHA (the release is in a comment); the workflow uses `pull_request`, never `pull_request_target`, and values reach shell scripts only through `env:`.
- `NACHOLENS_PKG` at the top pins the nacholens version.
- Clean up now and then with `nacholens media prune --apply` (it needs `contents: write`, so run it by hand or in its own scheduled workflow).

## Limits

- GitHub stops a comment at 65,536 characters. Very large changes keep the first flows in full and list the rest by name (the player shows them).
- The review texts (reasons, intent verdicts) come from the CLI in English; headings and labels follow `--lang`. Model text (labels, narration) is shown as written.
- An interactive page cannot run inside GitHub. The comment is complete without it; `--player-url` only adds a link.
