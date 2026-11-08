# README motion graphic

Source of `docs/images/blackbox-to-whitebox.gif` (English) and `docs/images/blackbox-to-whitebox.ko.gif` (Korean).
It is not part of the npm package.

The story, in one loop (about 19 s, 25 frames per second): **Before**, a request goes into an AI agent that is a black box and comes out as a
wall of diff with three open questions (what did it touch, any new outside calls, what to re-test). A magnifier wipes
the black box away. **After**, the same change is the nacholens page: the request moves through the services, changed
parts are orange, the new outside call is green, and the three questions get their answers. End card: black box → white box, on the dark ground again so the loop is seamless.

- `blackbox-to-whitebox.html`: the scene as plain SVG. `window.renderFrame(t)` draws second `t`. Open it with `?lang=en|ko`,
  and add `&t=9.4` for a still. Colours are the Nacho Combo tokens of `src/player/player.css` (paper, nacho, guac, salsa, board);
  type is Nacho Sans from `src/player/fonts`, with Anton only for the end card's loud line and the wordmark. Hangul uses
  Pretendard (the design-system stack) if `docs/motion/fonts/PretendardVariable.woff2` is present (OFL, not committed, git-ignored;
  `npm pack pretendard@1.3.9` has it under `dist/web/variable/woff2/`), otherwise a system CJK font.
  Icons are inline line icons (one 1.8 px stroke family), no icon package.
- `render.mjs`: captures frames with headless Chrome over the DevTools protocol (Node 24+, no npm packages).
- `encode.mjs`: encodes the frames into a GIF with one shared palette (Node; dev-only packages from `scripts/tools`: `npm --prefix scripts/tools ci`).

```bash
export CHROME=/path/to/chrome                      # a Chrome or Chromium binary
node docs/motion/render.mjs --lang en --out /tmp/fr-en        # 25 fps by default (--fps N)
node docs/motion/encode.mjs /tmp/fr-en docs/images/blackbox-to-whitebox.gif --hold-last 1500
node docs/motion/render.mjs --lang ko --out /tmp/fr-ko
node docs/motion/encode.mjs /tmp/fr-ko docs/images/blackbox-to-whitebox.ko.gif --hold-last 1500
```

To change the words, edit the `STR` table at the top of the HTML (one block per language). To retime a scene, edit the
`reveal(...)`/`capPill(...)` seconds; the walk-through is slowed by the `warp` function near the end.
