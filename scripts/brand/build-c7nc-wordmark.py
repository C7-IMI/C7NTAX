"""
Builds the C7NC logotype's two alpha masks out of the C7NTAX ones.

C7NC is not artwork of its own: it is the same logotype with letters C7NTAX already
has, so it is composed from those masks rather than drawn again — the C, the 7 and
the N in the positions the mark uses, with a second C closed onto the end. That keeps
the typeface, the tracking and the crimson 7 identical to the wordmark it sits beside,
which is what "the red 7 just like C7NTAX" asks for.

**The slots come from the artwork, not from arithmetic.** The letters mask has four
ink runs — `C`, `N`, and `TA` and `X` (T and A touch) — and the seven mask has one,
the 7, which sits between the C and the N. Sorting those five run starts gives the
column each glyph occupies: 0, 51, 111, 167, 275. C7NC fills the first four, so its
spacing is the mark's own rhythm rather than a guess at it. An earlier version derived
"advances" from the runs and produced an uneven, over-wide mark.

Run from the repository root:

    python scripts/brand/build-c7nc-wordmark.py

Writes `apps/web/public/brand/wordmark-c7nc-mask.png` and `...-c7nc-7-mask.png`, and
prints the aspect ratio to use in `index.css`.
"""
from __future__ import annotations

import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
BRAND = ROOT / "apps" / "web" / "public" / "brand"

LETTERS = BRAND / "wordmark-mask.png"
SEVEN = BRAND / "wordmark-7-mask.png"
OUT_LETTERS = BRAND / "wordmark-c7nc-mask.png"
OUT_SEVEN = BRAND / "wordmark-c7nc-7-mask.png"

# What counts as ink in the masks.
INK = 8
# C7NC: the C and the N, the 7 where it always sits, and the C again to close it.
TARGET = ["C", "7", "N", "C"]


def alpha(path: pathlib.Path) -> np.ndarray:
    return np.array(Image.open(path).convert("RGBA"))[:, :, 3]


def glyph_runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Column ranges of the glyphs, found by their ink rather than by guessing."""
    inked = (mask > INK).any(axis=0)
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for x, on in enumerate(inked):
        if on and start is None:
            start = x
        elif not on and start is not None:
            runs.append((start, x))
            start = None
    if start is not None:
        runs.append((start, len(inked)))
    return runs


def write_mask(array: np.ndarray, out: pathlib.Path) -> None:
    """An LA png: fully opaque, with `array` as the alpha channel."""
    image = Image.new("LA", (array.shape[1], array.shape[0]))
    image.putdata(list(zip([255] * array.size, array.flatten().tolist())))
    image.save(out)
    print(f"wrote {out.relative_to(ROOT)}  {array.shape[1]}x{array.shape[0]}")


def main() -> None:
    letters = alpha(LETTERS)
    seven = alpha(SEVEN)

    letters_runs = glyph_runs(letters)
    seven_runs = glyph_runs(seven)
    if len(letters_runs) != 4 or len(seven_runs) != 1:
        raise SystemExit(
            f"the masks are not the shapes this script knows: {LETTERS.name} has "
            f"{len(letters_runs)} runs {letters_runs}, {SEVEN.name} has {len(seven_runs)} {seven_runs}."
        )
    if not letters_runs[0][1] <= seven_runs[0][0] <= letters_runs[1][0]:
        raise SystemExit("the 7 is no longer between the first two letters; check the masks")

    c_left, c_right = letters_runs[0]
    n_left, n_right = letters_runs[1]

    # The five columns the mark lays its letters on, in the order it lays them.
    slots = sorted([run[0] for run in letters_runs] + [seven_runs[0][0]])
    print(f"slots: {slots}")
    print(f"  C: columns {c_left}-{c_right}")
    print(f"  7: columns {seven_runs[0][0]}-{seven_runs[0][1]}")
    print(f"  N: columns {n_left}-{n_right}")

    # Ink for each glyph of the target: the C's own for both Cs, the N's, the 7's.
    ink: dict[str, tuple[str, int, int]] = {
        "C": ("letters", c_left, c_right),
        "7": ("seven", seven_runs[0][0], seven_runs[0][1]),
        "N": ("letters", n_left, n_right),
    }

    placements = [(name, *ink[name], slots[index]) for index, name in enumerate(TARGET)]
    for name, layer, left, right, x in placements:
        print(f"  {name} from the {layer} mask, columns {left}-{right}, placed at {x}")

    height = letters.shape[0]
    width = placements[-1][4] + (placements[-1][3] - placements[-1][2])
    composed_letters = np.zeros((height, width), dtype=np.uint8)
    composed_seven = np.zeros((height, width), dtype=np.uint8)

    for _name, layer, left, right, x in placements:
        source = seven if layer == "seven" else letters
        glyph = source[:, left:right]
        target = composed_seven if layer == "seven" else composed_letters
        target[:, x : x + glyph.shape[1]] = np.maximum(target[:, x : x + glyph.shape[1]], glyph)

    # Trim the empty margins so the aspect ratio is the ink's, not the canvas's — and
    # the ink is *both* layers: the 7 descends below the letters' baseline, so trimming
    # on the letters alone clips the bottom of the 7.
    ink_mask = np.maximum(composed_letters, composed_seven)
    rows = (ink_mask > INK).any(axis=1)
    cols = (ink_mask > INK).any(axis=0)
    top, bottom = int(np.argmax(rows)), height - int(np.argmax(rows[::-1]))
    first, last = int(np.argmax(cols)), width - int(np.argmax(cols[::-1]))

    write_mask(composed_letters[top:bottom, first:last], OUT_LETTERS)
    write_mask(composed_seven[top:bottom, first:last], OUT_SEVEN)
    print(f"aspect-ratio for index.css: {last - first} / {bottom - top}")


if __name__ == "__main__":
    main()
