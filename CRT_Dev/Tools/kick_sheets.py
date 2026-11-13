"""Builds the Interrupts marker sprite sheets (CRT_Media/Media/Kicks/).

A raid marker read from a nameplate is a secret value, so CRT can't compare it with a group's marker. It can pass it
to Texture:SetSpriteSheetCell, which draws that cell of a sheet. So every sheet here is one row of 8 cells, one per
raid marker (1 Star to 8 Skull), with only cell k drawn and the other 7 fully transparent: the plate shows the image
only when its marker is k (CRT_Modules/Interrupts/Plates.lua).

    Box<k>.tga       cell k a filled white square with a 1 px black outline (tinted by SetVertexColor)
    Num<k>_<N>.tga   cell k the number N (1 to 10) in white with a dark outline (tinted by SetVertexColor)

The digits are drawn here as stroked shapes, supersampled and scaled down, so no font file is used.
32-bit RLE TGA, power-of-two sizes. Run from anywhere: python CRT_Dev/Tools/kick_sheets.py
"""

import math
import os

from PIL import Image, ImageDraw

MARKERS = 8
MAX_SLOTS = 10  # Setup.MAX_SLOTS
BOX_CELL = 32  # the box sheet: 256 x 32
NUM_CELL = 64  # the number sheets: 512 x 64
SUPER = 4  # supersampling for the digits

# The digits' shapes in a box 0.6 wide and 1.0 high (y down): each a list of strokes, a stroke a list of points.
DIGIT_W = 0.6
STROKE = 0.14  # the white stroke's width, in digit heights
OUTLINE = 0.06  # the dark outline on each side
DIGIT_H = 0.56  # a digit's height in the cell
GAP = 0.1  # between the two digits of 10


def arc(cx, cy, rx, ry, a0, a1, steps=40):
    pts = []
    for i in range(steps + 1):
        a = math.radians(a0 + (a1 - a0) * i / steps)
        pts.append((cx + rx * math.cos(a), cy - ry * math.sin(a)))
    return pts


def bezier(p0, p1, p2, steps=30):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0]
        y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]
        pts.append((x, y))
    return pts


DIGITS = {
    "0": [arc(0.3, 0.5, 0.24, 0.43, 0, 360, 60)],
    "1": [[(0.12, 0.22), (0.34, 0.07), (0.34, 0.93)]],
    "2": [arc(0.3, 0.3, 0.22, 0.22, 160, -35) + [(0.08, 0.93), (0.54, 0.93)]],
    "3": [arc(0.3, 0.28, 0.2, 0.2, 150, -90), arc(0.3, 0.71, 0.23, 0.23, 90, -150)],
    "4": [[(0.44, 0.93), (0.44, 0.07), (0.06, 0.66), (0.56, 0.66)]],
    "5": [[(0.52, 0.07), (0.14, 0.07), (0.11, 0.46)] + arc(0.3, 0.67, 0.23, 0.26, 130, -150)],
    "6": [arc(0.3, 0.68, 0.23, 0.25, 0, 360, 60), bezier((0.5, 0.1), (0.08, 0.14), (0.07, 0.68))],
    "7": [[(0.06, 0.07), (0.54, 0.07), (0.24, 0.93)]],
    "8": [arc(0.3, 0.29, 0.19, 0.22, 0, 360, 60), arc(0.3, 0.71, 0.23, 0.22, 0, 360, 60)],
    "9": [arc(0.3, 0.32, 0.23, 0.25, 0, 360, 60), bezier((0.53, 0.32), (0.52, 0.86), (0.1, 0.9))],
}


def stroke(draw, pts, width, fill):
    draw.line(pts, fill=fill, width=int(round(width)), joint="curve")
    r = width / 2
    for x, y in (pts[0], pts[-1]):
        draw.ellipse((x - r, y - r, x + r, y + r), fill=fill)


def number_cell(n):
    """One NUM_CELL square holding the number n, white with a dark outline, anti-aliased."""
    size = NUM_CELL * SUPER
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    text = str(n)
    h = DIGIT_H * size
    width = (len(text) * DIGIT_W + (len(text) - 1) * GAP) * h
    left, top = (size - width) / 2, (size - h) / 2
    shapes = []
    for i, ch in enumerate(text):
        ox = left + i * (DIGIT_W + GAP) * h
        for s in DIGITS[ch]:
            shapes.append([(ox + x * h, top + y * h) for x, y in s])
    for s in shapes:  # the outline under every stroke first, so the white is never cut
        stroke(draw, s, (STROKE + 2 * OUTLINE) * h, (10, 10, 10, 255))
    for s in shapes:
        stroke(draw, s, STROKE * h, (255, 255, 255, 255))
    return img.resize((NUM_CELL, NUM_CELL), Image.LANCZOS)


def box_cell():
    """One BOX_CELL square: a 1 px transparent gutter (no bleed into the next cell), then the box with its outline."""
    img = Image.new("RGBA", (BOX_CELL, BOX_CELL), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rectangle((1, 1, BOX_CELL - 2, BOX_CELL - 2), fill=(0, 0, 0, 255))
    draw.rectangle((2, 2, BOX_CELL - 3, BOX_CELL - 3), fill=(255, 255, 255, 255))
    return img


def sheet(cell_img, cell, k):
    img = Image.new("RGBA", (cell * MARKERS, cell), (0, 0, 0, 0))
    img.paste(cell_img, ((k - 1) * cell, 0))
    return img


def main():
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    out = os.path.join(root, "CRT_Media", "Media", "Kicks")
    os.makedirs(out, exist_ok=True)
    box = box_cell()
    numbers = {n: number_cell(n) for n in range(1, MAX_SLOTS + 1)}
    for k in range(1, MARKERS + 1):
        sheet(box, BOX_CELL, k).save(os.path.join(out, "Box%d.tga" % k), compression="tga_rle", orientation=1)
        for n, cell in numbers.items():
            sheet(cell, NUM_CELL, k).save(os.path.join(out, "Num%d_%d.tga" % (k, n)), compression="tga_rle", orientation=1)
    print("wrote %d files to %s" % (MARKERS * (1 + MAX_SLOTS), out))


if __name__ == "__main__":
    main()
