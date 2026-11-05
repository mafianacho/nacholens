# README motion graphic

Source of `docs/images/blackbox-to-whitebox.gif` (English) and `docs/images/blackbox-to-whitebox.ko.gif` (Korean).
It is not part of the npm package.

The story, in one loop (about 19 s): **Before**, a request goes into an AI agent that is a black box and comes out as a
wall of diff with three open questions (what did it touch, any new outside calls, what to re-test). A magnifier wipes
the black box away. **After**, the same change is the nacholens page: the request moves through the services, changed
parts are orange, the new outside call is green, and the three questions get their answers. End card: black box → white box.

- `blackbox-to-whitebox.html`: the scene as plain SVG. `window.renderFrame(t)` draws second `t`. Open it with `?lang=en|ko`,
  and add `&t=9.4` for a still. Fonts are the ones already in `src/player/fonts` (Hangul falls back to a system CJK font).
- `render.mjs`: captures frames with headless Chrome over the DevTools protocol (Node 22+, no npm packages).
- `encode.py`: encodes the frames into a GIF with one shared palette (Pillow).

```bash
export CHROME=/path/to/chrome                      # a Chrome or Chromium binary
node docs/motion/render.mjs --lang en --out /tmp/fr-en
python3 docs/motion/encode.py /tmp/fr-en docs/images/blackbox-to-whitebox.gif --hold-last 1500
node docs/motion/render.mjs --lang ko --out /tmp/fr-ko
python3 docs/motion/encode.py /tmp/fr-ko docs/images/blackbox-to-whitebox.ko.gif --hold-last 1500
```

To change the words, edit the `STR` table at the top of the HTML (one block per language). To retime a scene, edit the
`reveal(...)`/`capPill(...)` seconds; the walk-through is slowed by the `warp` function near the end.
