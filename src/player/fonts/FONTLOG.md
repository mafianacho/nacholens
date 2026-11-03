# Embedded fonts

The player page embeds these fonts (as WOFF2 data in a `<style>` block). They are the type roles of the
[Nacho Combo design system](https://github.com/mafianacho/nachocombo): IBM Plex Sans for text, IBM Plex Mono
for code and labels, Anton for the one loud line.

All of them are licensed under the SIL Open Font License, Version 1.1 (`OFL-IBMPlex.txt`, `OFL-Anton.txt`).
They are not covered by this project's Apache-2.0 license.

| File | Family in the page | Source (unmodified, from Nacho Combo `Resources/Fonts`) | Source SHA-256 |
|---|---|---|---|
| `nacho-sans-400.woff2` | Nacho Sans 400 | IBMPlexSans-Regular.ttf | `975dcda37d80f038dcd143c22e33ca2d97a0cc5a929aace1c749153b0fe1afa5` |
| `nacho-sans-500.woff2` | Nacho Sans 500 | IBMPlexSans-Medium.ttf | `331c8639d7598b2cde62a911a71db195e30cb655cd6bdf2e324a7e984955f907` |
| `nacho-sans-600.woff2` | Nacho Sans 600 | IBMPlexSans-SemiBold.ttf | `a20caf8286023a6a7a85e40b1d2a4ae9fc3e3b1f9eda8f4c542dd4986af67bb1` |
| `nacho-sans-700.woff2` | Nacho Sans 700 | IBMPlexSans-Bold.ttf | `9e6c74a889a700d707613d24548fe4ffa6bc59559a0689d2cf9e133bdcdafb2f` |
| `nacho-mono-500.woff2` | Nacho Mono 500 | IBMPlexMono-Medium.ttf | `a9b4c49bb299e05b5f6c481e7fb5e78943d2793249a0c8874ab574a2d1ea6755` |
| `nacho-mono-600.woff2` | Nacho Mono 600 | IBMPlexMono-SemiBold.ttf | `d3c38e55c78f5b0f28009fddba4834ec503278936a5986032424c9bd2d23aa46` |
| `anton-400.woff2` | Anton 400 | Anton-Regular.ttf | `a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab` |

## Changes (2026, Mafianacho)

- **Subset** to Latin (U+0020–007E, U+00A0–00FF), general punctuation (U+2010–2027, U+2030–203A) and a few
  symbols and arrows (→ ← ↑ ↓ ↔ − ≠ ≤ ≥ ✓ € ₩ ™); Anton to U+0020–007E. All OpenType layout features of the kept
  glyphs are kept. Characters outside the subset (Hangul included) are drawn by the system font stack.
- **Converted** to WOFF2.
- **Renamed** IBM Plex Sans / Mono to "Nacho Sans" / "Nacho Mono": a subset is a Modified Version, and IBM Plex
  declares the Reserved Font Name "Plex". Anton declares no Reserved Font Name and keeps its name.
- Copyright, trademark, designer and license records are kept; a modification note is added to the copyright record.

Rebuild: `python3 scripts/build-fonts.py <dir with the source .ttf files>` (needs `fonttools` and `brotli`).
