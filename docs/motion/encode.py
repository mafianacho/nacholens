#!/usr/bin/env python3
"""Encode captured frames (render.mjs output) into one looping GIF with a shared palette.

  python3 docs/motion/encode.py <frames dir> <out.gif> [--fps 25] [--hold-last 1500]

Needs Pillow. The shared 255-colour palette is built from a sample of the frames, so the colours do not
flicker between frames and unchanged areas stay identical (Pillow then stores only the changed rectangle).
"""
import argparse
import glob
import sys

from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("frames")
ap.add_argument("out")
ap.add_argument("--fps", type=float, default=25.0)
ap.add_argument("--hold-last", type=int, default=0, help="extra milliseconds on the last frame")
ap.add_argument("--colors", type=int, default=255)
a = ap.parse_args()

files = sorted(glob.glob(f"{a.frames}/f*.png"))
if not files:
    sys.exit("no frames found")
frames = [Image.open(f).convert("RGB") for f in files]

# palette from a contact sheet of every 6th frame
sample = frames[::6]
w, h = frames[0].size
sheet = Image.new("RGB", (w, h * len(sample)))
for i, im in enumerate(sample):
    sheet.paste(im, (0, i * h))
pal = sheet.quantize(colors=a.colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)

out = [im.quantize(palette=pal, dither=Image.Dither.NONE) for im in frames]
delay = round(1000 / a.fps)
durations = [delay] * len(out)
durations[-1] += a.hold_last
out[0].save(a.out, save_all=True, append_images=out[1:], duration=durations, loop=0, optimize=False, disposal=1)
import os
print(f"{len(out)} frames, {os.path.getsize(a.out) / 1024:.0f} KiB -> {a.out}")
