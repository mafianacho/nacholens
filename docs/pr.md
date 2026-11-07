# Explain a pull request in the pull request

`nacholens pr` turns a build into one GitHub comment that a reviewer can understand without opening anything else:
what changed in which flow, in pictures and in words, what the plan said, what to re-test, and what the flows do not show.
`nacholens snap` adds pictures of the real player (a still and one animation per changed flow, light and dark).

```bash
nacholens build --repo . --base origin/main --head HEAD --out nacholens-out [--intent intent.json] [--lang ko]
nacholens snap  --page nacholens-out/<product>.html [--lang ko]          # optional: needs Node 22+ and a local Chrome
nacholens pr    --from nacholens-out --repo-url https://github.com/<owner>/<repo> --pr <number> \
                [--media-url <where the pictures are>] [--player-url <link to the page>] [--lang ko]
gh pr comment <number> --body-file nacholens-out/pr.md                     # or update the existing one (below)
```

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

GitHub has no API to upload a comment attachment, so the pictures need a URL. For a repository you can push to, the simplest home is a separate branch of the same repository that holds only pictures:

```bash
git worktree add --detach ../nacholens-media && cd ../nacholens-media
git switch nacholens-media 2>/dev/null || git switch --orphan nacholens-media
mkdir -p pr-<n>/<head7> && cp ../<repo>/nacholens-out/media/*.png ../<repo>/nacholens-out/media/*.gif pr-<n>/<head7>/
git add pr-<n> && git commit -m "nacholens pictures for #<n> at <head7>" && git push origin nacholens-media
echo "https://github.com/<owner>/<repo>/raw/$(git rev-parse HEAD)/pr-<n>/<head7>"   # → --media-url
```

The commit in the URL keeps old comments pointing at their own pictures. GitHub shows `github.com/<owner>/<repo>/raw/…` images directly (not through its image proxy). In a public repository anyone can see them, as they can see the code; in a private one only people with access. Pictures of a private repository must not go to a public place.

## One comment per pull request

The comment starts with `<!-- nacholens:pr -->`. Update it instead of adding a new one on every push:

```bash
id=$(gh api "repos/<owner>/<repo>/issues/<n>/comments" --paginate --jq '.[] | select(.body | contains("<!-- nacholens:pr -->")) | .id' | head -1)
if [ -n "$id" ]; then gh api -X PATCH "repos/<owner>/<repo>/issues/comments/$id" -F body=@nacholens-out/pr.md
else gh pr comment <n> --body-file nacholens-out/pr.md; fi
```

Posting is a visible action in someone's repository: an agent asks before it posts or pushes pictures, unless it was asked to.

## Limits

- GitHub stops a comment at 65,536 characters. Very large changes keep the first flows in full and list the rest by name (the player shows them).
- The review texts (reasons, intent verdicts) come from the CLI in English; headings and labels follow `--lang`. Model text (labels, narration) is shown as written.
- An interactive page cannot run inside GitHub. The comment is complete without it; `--player-url` only adds a link.
