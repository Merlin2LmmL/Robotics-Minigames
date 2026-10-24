"""Trace the ground floor of the straightened floor plan into a lidar-sim map file.

The plan's walls are turned into clean straight lines of one thickness: pieces that lie on
the same line are joined, ends are snapped onto the wall they meet, and tiny gaps are closed.
Gaps the size of a door are widened to DOOR, so the robot fits through like on a robotics
course. Stairs (solid black blocks on the plan) and the door thresholds go into the floor
layer: they are drawn, but the robot drives over them and the lidar doesn't see them. The
pillars become small squares and the round bays next to the aula half disks. Text, the floor
separators and the green "Standort" marker are left out.

    python3 trace_floorplan.py PLAN OUT.json [DEBUG.png]

Needs OpenCV and NumPy (apt install python3-opencv).
"""
import json
import math
import sys
import cv2
import numpy as np

# Where the ground floor ("Erdgeschoss") is on the straightened sheet, px
REGION = (900, 580, 2340, 2110)  # x0, y0, x1, y1
# Bits of the region that aren't building, in region px: separator lines and the title
NOT_BUILDING = [(0, 0, 70, 700), (0, 1380, 45, 1530), (1425, 0, 1440, 1530), (660, 1420, 980, 1490)]
# The four round bays beside the aula (three concentric rings each), measured off the plan:
# center x, center y, outer radius (region px), side the half circle bulges to
BAYS = [(456, 806, 48, -1), (455, 1031, 48, -1), (998, 805, 48, 1), (998, 1030, 48, 1)]

# The plan has no usable scale bar, so the size comes from a classroom: E033 is ~131 px, taken as 9 m
PLAN_PX_PER_M = 14.5
SCALE = 20        # world px per m in the map file
MARGIN = 40       # world px around the building
BORDER = 12       # world px, walls along the world edge
START = (720, 1120)  # region px, open hall south of the aula
COLOR = "rgba(90, 90, 90, 0.8)"
STAIR_COLOR = "rgba(150, 125, 95, 0.45)"
STEP_COLOR = "rgba(80, 65, 50, 0.55)"
DOOR_COLOR = "rgba(80, 160, 100, 0.35)"

m = lambda v: v * PLAN_PX_PER_M  # meters -> region px
WALL_MIN_LEN = 15  # region px (~1 m), shorter straight pieces of ink aren't walls
WALL = m(0.3)      # every wall gets this thickness
MERGE = 6          # region px, pieces this close across are on the same line
SNAP = 8           # region px, wall ends this close to another wall are moved onto it
MIN_GAP = m(0.6)   # narrower gaps are drawing errors and get closed
MAX_DOOR = m(2.5)  # wider gaps are open passages and stay as they are
DOOR = m(1.5)      # door gaps are widened to this
MIN_PIECE = m(0.4) # a widened door leaves at least this much wall next to a corner
STUB = m(0.8)      # shorter walls that touch nothing are dropped
STAIR_MIN = 12     # region px, dark blocks at least this thick both ways can be stairs
STAIR_AREA = 900   # region px², smaller dark blocks are letters
LEAF = m(1.8)      # shorter straight pieces in the middle of door arcs are door leaves, not walls
STEP = m(0.3)      # distance between the drawn steps


def kernel(w, h):
    return cv2.getStructuringElement(cv2.MORPH_RECT, (w, h))


def boxes(mask):
    n, _, st, _ = cv2.connectedComponentsWithStats(mask, 8)
    return [tuple(int(v) for v in st[i]) for i in range(1, n)]  # x, y, w, h, area


def find_stairs(ink, gray):
    """Hatched dark blocks -> (x, y, w, h, steps run horizontally?). Walls are thin lines and pillars small."""
    # solid ones are plain dark (the ink test leaves holes in big dark areas), hatched ones only
    # become blocks once the lines are closed (which can also glue a solid one to the walls
    # around it, so both are looked at)
    closed = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, kernel(5, 5))
    found = []
    for mask in ((gray < 90).astype(np.uint8), closed):
        found += boxes(cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel(STAIR_MIN, STAIR_MIN)))
    stairs = []
    for x, y, w, h, a in found:
        # letters close into blocks too, but they are small; the stairs are nearly black, or big and dark
        dark = (gray[y:y + h, x:x + w] < 90).mean()
        if a < STAIR_AREA or not (dark > 0.85 or (dark > 0.64 and min(w, h) >= 25)):
            continue
        if any(overlaps((x, y, w, h), s[:4], 0) for s in stairs):
            continue
        # the steps are faint lines inside the block: whichever way the gray changes more is across them
        inner = gray[y + 2:y + h - 2, x + 2:x + w - 2]
        across_y = np.abs(np.diff(inner, axis=0)).mean()
        across_x = np.abs(np.diff(inner, axis=1)).mean()
        stairs.append((x, y, w, h, across_y > across_x))
    return stairs


def merge_lines(segs):
    """(c, a0, a1) pieces -> lines {c, pieces: [[a0, a1, extend0, extend1]]}, c across, a along."""
    groups = []
    for s in sorted(segs):
        if groups and s[0] - groups[-1][0][0] <= MERGE:
            groups[-1].append(s)
        else:
            groups.append([s])
    lines = []
    for g in groups:
        c = sum(c * (a1 - a0) for c, a0, a1 in g) / sum(a1 - a0 for _, a0, a1 in g)
        pieces = []
        for _, a0, a1 in sorted(g, key=lambda s: s[1]):
            if pieces and a0 <= pieces[-1][1] + 1:
                pieces[-1][1] = max(pieces[-1][1], a1)
            else:
                pieces.append([a0, a1, True, True])
        lines.append({"c": c, "pieces": pieces, "anchors": [], "walls": []})
    return lines


def snap(lines, cross):
    """Moves wall ends that stop just short of (or poke past) a crossing wall onto it."""
    for l in lines:
        for p in l["pieces"]:
            for end in (0, 1):
                near = [(abs(o["c"] - p[end]), o) for o in cross
                        if abs(o["c"] - p[end]) <= SNAP
                        and any(q[0] - SNAP <= l["c"] <= q[1] + SNAP for q in o["pieces"])]
                if near:
                    o = min(near, key=lambda t: t[0])[1]
                    p[end] = o["c"]
                    o["anchors"].append(l["c"])
                    if p[1] - p[0] >= LEAF:  # a real wall, not a door leaf
                        o["walls"].append(l["c"])


def corridor_doors(residue):
    """Pairs of door leaves across a whole corridor (drawn like "(|)(|)") -> boxes.
    Their arcs are taken out of residue, so they don't count for the doors next to them."""
    found = []
    clumps = cv2.morphologyEx(residue, cv2.MORPH_CLOSE, kernel(9, 9))
    for x, y, w, h, _ in boxes(clumps):
        if min(w, h) > m(1.2) and max(w, h) < m(4.5) and residue[y:y + h, x:x + w].sum() > 150:
            found.append((x, y, w, h))
            residue[y:y + h, x:x + w] = 0
    return found


def cut_double_doors(lines, cross, side_ink, axis):
    """Double doors across a corridor are a row of arcs and leaves on a straight threshold
    line, which would otherwise be traced as a wall. Cuts them out of the lines, together
    with their leaves; returns the doors."""
    r = side_ink if axis == "h" else side_ink.T
    doors = []
    for l in lines:
        c = int(round(l["c"]))
        # all leaves of a double door swing to the same side; two doors facing each other
        # across a wall have one arc on each side
        runs = []
        for band in (r[max(0, c - 14):max(0, c - 3)], r[c + 4:c + 15]):
            arcs = np.convolve(band.sum(0) > 0, np.ones(5), "same") > 0
            edges = np.flatnonzero(np.diff(np.r_[0, arcs.astype(np.int8), 0]))
            runs += zip(edges[::2], edges[1::2])
        for a0, a1 in runs:
            # a row of arcs that long is no single door; a wall joining in the middle means it's
            # two doors side by side
            if not m(1.5) <= a1 - a0 <= m(5) or any(a0 + 3 < a < a1 - 3 for a in l["walls"]):
                continue
            if not any(p[0] < a1 and p[1] > a0 for p in l["pieces"]):
                continue
            kept = []
            for p in l["pieces"]:
                if p[1] <= a0 or p[0] >= a1:
                    kept.append(p)
                    continue
                if p[0] < a0:
                    kept.append([p[0], a0, p[2], False])
                if p[1] > a1:
                    kept.append([a1, p[1], False, p[3]])
            l["pieces"] = kept
            for o in cross:
                if a0 < o["c"] < a1:
                    o["pieces"] = [p for p in o["pieces"] if p[1] - p[0] >= LEAF
                                   or not (p[0] - SNAP <= l["c"] <= p[1] + SNAP)]
            doors.append((axis, l["c"], float(a0), float(a1)))
    return doors


def find_leaves(lines, residue, axis):
    """Doors where the plan draws a leaf (an arc) but the wall line runs on across the door.
    Returns the door centers per line, {id(line): [along, ...]}. The arc has to reach further
    from the wall than the little pillars built into some walls do."""
    r = residue if axis == "h" else residue.T
    centers = {}
    for l in lines:
        c = int(round(l["c"]))
        # the pillars stick out up to ~10 px from the middle of the wall, the arcs ~15
        for band in (r[max(0, c - 18):max(0, c - 10)], r[c + 11:c + 19]):
            prof = band.sum(0)
            on = np.convolve(prof > 0, np.ones(3), "same") > 0
            edges = np.flatnonzero(np.diff(np.r_[0, on.astype(np.int8), 0]))
            for a0, a1 in zip(edges[::2], edges[1::2]):
                mid = (a0 + a1) / 2
                if (m(0.4) <= a1 - a0 <= m(1.6) and prof[a0:a1].sum() >= 8
                        and any(p[0] + MIN_PIECE < mid < p[1] - MIN_PIECE for p in l["pieces"])):
                    centers.setdefault(id(l), []).append(mid)
    return centers


def open_doors(lines, residue, axis):
    """Cuts the doors found by their leaves, closes tiny gaps and widens door sized ones.
    Returns the doors (axis, c, d0, d1)."""
    r = residue if axis == "h" else residue.T
    leaves = find_leaves(lines, residue, axis)
    doors = []
    for l in lines:
        ps = sorted(l["pieces"])
        if not ps:
            continue
        # a door in the middle of a piece splits it, so it is a gap like the others
        cuts = []
        for d in leaves.get(id(l), []):
            for i, p in enumerate(ps):
                if p[0] < d < p[1]:
                    ps[i:i + 1] = [[p[0], d, p[2], True], [d, p[1], True, p[3]]]
                    cuts.append(d)
                    break
        joined = [ps[0]]
        for p in ps[1:]:
            if p[0] - joined[-1][1] < MIN_GAP and not any(abs(p[0] - d) < 1 for d in cuts):
                joined[-1][1] = max(joined[-1][1], p[1])
                joined[-1][3] = p[3]
            else:
                joined.append(p)
        for left, right in zip(joined, joined[1:]):
            g0, g1 = left[1], right[0]
            if g1 - g0 > MAX_DOOR:
                continue
            # widen evenly, but keep some wall next to a corner and don't eat whole pieces
            floor_l = max([left[0]] + [a for a in l["anchors"] if left[0] <= a <= left[1]]) + MIN_PIECE
            ceil_r = min([right[1]] + [a for a in l["anchors"] if right[0] <= a <= right[1]]) - MIN_PIECE
            cap_l, cap_r = max(0, g0 - floor_l), max(0, ceil_r - g1)
            need = max(0, DOOR - (g1 - g0))
            el = min(cap_l, need / 2)
            er = min(cap_r, need - el)
            el = min(cap_l, need - er)
            left[1] -= el
            right[0] += er
            left[3] = right[2] = False
            # a threshold is drawn where the plan has a door leaf (an arc) at the gap
            c = int(round(l["c"]))
            if g1 - g0 < 1 or (g1 - g0 < m(1.5) and r[max(0, c - 15):c + 16, int(g0) - 2:int(g1) + 3].sum() >= 20):
                doors.append((axis, l["c"], left[1], right[0]))
        l["pieces"] = joined
    return doors


def wall_rects(lines, axis):
    rects = []
    for l in lines:
        for a0, a1, e0, e1 in l["pieces"]:
            a0 -= WALL / 2 if e0 else 0
            a1 += WALL / 2 if e1 else 0
            if a1 - a0 < 1:
                continue
            r = (a0, l["c"] - WALL / 2, a1 - a0, WALL)
            rects.append(r if axis == "h" else (r[1], r[0], r[3], r[2]))
    return rects


def overlaps(a, b, m=1):
    return a[0] - m < b[0] + b[2] and b[0] - m < a[0] + a[2] and a[1] - m < b[1] + b[3] and b[1] - m < a[1] + a[3]


def trace(plan):
    x0, y0, x1, y1 = REGION
    c = plan[y0:y1, x0:x1]
    hsv = cv2.cvtColor(c, cv2.COLOR_BGR2HSV)
    green = (hsv[..., 0] > 25) & (hsv[..., 0] < 85) & (hsv[..., 1] > 60)
    g = cv2.cvtColor(c, cv2.COLOR_BGR2GRAY).astype(np.float32)
    # ink: clearly darker than the paper around it (the lighting is uneven)
    ink = (((cv2.GaussianBlur(g, (0, 0), 25) - g) > 35) & ~green).astype(np.uint8)
    for bx0, by0, bx1, by1 in NOT_BUILDING:
        ink[by0:by1, bx0:bx1] = 0

    yy, xx = np.mgrid[:ink.shape[0], :ink.shape[1]]
    bays = []
    for cx, cy, r, side in BAYS:
        ink[(np.hypot(xx - cx, yy - cy) < r + 4) & ((xx - cx) * side > 0)] = 0
        a0 = math.pi / 2 if side < 0 else -math.pi / 2
        bays.append([(cx + r * math.cos(a0 + math.pi * i / 12), cy + r * math.sin(a0 + math.pi * i / 12)) for i in range(13)])

    stairs = find_stairs(ink, g)
    for x, y, w, h, _ in stairs:
        ink[y:y + h, x:x + w] = 0

    # pillars are small filled squares; other small pieces touching no wall are letters
    pillars = []
    n, lab, st, _ = cv2.connectedComponentsWithStats(ink, 8)
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if max(w, h) < 40 and a < 400:
            if 9 <= w <= 13 and 9 <= h <= 13 and abs(w - h) <= 2 and a > 0.8 * w * h:
                pillars.append((x, y, w, h))
            ink[lab == i] = 0

    hm = cv2.morphologyEx(ink, cv2.MORPH_OPEN, kernel(WALL_MIN_LEN, 1))
    vm = cv2.morphologyEx(ink, cv2.MORPH_OPEN, kernel(1, WALL_MIN_LEN))
    # what is left of the ink besides straight lines: door leaves, mostly
    residue = (ink & ~cv2.dilate(hm | vm, kernel(5, 5))).astype(np.uint8)

    def pieces(mask, axis):
        out = []
        for x, y, w, h, _ in boxes(mask):
            # the straight leaves in the middle of door arcs have lots of arc around them
            length = w if axis == "h" else h
            near = residue[max(0, y - 6):y + h + 6, max(0, x - 6):x + w + 6].sum()
            if length < LEAF and near >= length:
                continue
            out.append((y + h / 2, x, x + w) if axis == "h" else (x + w / 2, y, y + h))
        return out

    hl, vl = merge_lines(pieces(hm, "h")), merge_lines(pieces(vm, "v"))
    snap(hl, vl)
    snap(vl, hl)
    corridor = corridor_doors(residue)
    # ink beside a line: everything but the lines running the same way
    doors = (cut_double_doors(hl, vl, ink & ~cv2.dilate(hm, kernel(3, 3)), "h")
             + cut_double_doors(vl, hl, ink & ~cv2.dilate(vm, kernel(3, 3)), "v"))
    doors += open_doors(hl, residue, "h") + open_doors(vl, residue, "v")
    # corridor doors: a threshold across the corridor, along the symbol's longer side
    for x, y, w, h in corridor:
        doors.append(("h", y + h / 2, x, x + w) if w >= h else ("v", x + w / 2, y, y + h))

    walls = wall_rects(hl, "h") + wall_rects(vl, "v")
    # loose little stubs that touch no other wall are left over bits of symbols
    walls = [r for r in walls if max(r[2], r[3]) >= STUB or any(o is not r and overlaps(r, o) for o in walls)]
    walls += [(x, y, w, h) for x, y, w, h in pillars]
    return walls, bays, stairs, doors


def to_map(walls, bays, stairs, doors, size):
    f = SCALE / PLAN_PX_PER_M
    w, h = math.ceil(size[0] * f + 2 * MARGIN), math.ceil(size[1] * f + 2 * MARGIN)
    r1 = lambda v: round(v, 1)
    rect = lambda x, y, rw, rh, color: {"shape": "rectangle", "color": color, "x": r1(x * f + MARGIN), "y": r1(y * f + MARGIN),
                                        "width": r1(rw * f), "height": r1(rh * f)}
    obstacles = [rect(*r, COLOR) for r in walls]
    obstacles += [{"shape": "polygon", "color": COLOR,
                   "points": [{"x": r1(px * f + MARGIN), "y": r1(py * f + MARGIN)} for px, py in pts]} for pts in bays]
    obstacles += [{"shape": "rectangle", "color": COLOR, **r} for r in (
        {"x": 0, "y": 0, "width": w, "height": BORDER}, {"x": 0, "y": h - BORDER, "width": w, "height": BORDER},
        {"x": 0, "y": 0, "width": BORDER, "height": h}, {"x": w - BORDER, "y": 0, "width": BORDER, "height": h})]

    floor = []
    for x, y, sw, sh, horizontal in stairs:
        floor.append(rect(x, y, sw, sh, STAIR_COLOR))
        line = 2 / f  # 2 world px
        if horizontal:
            floor += [rect(x, y + t, sw, line, STEP_COLOR) for t in np.arange(STEP / 2, sh, STEP)]
        else:
            floor += [rect(x + t, y, line, sh, STEP_COLOR) for t in np.arange(STEP / 2, sw, STEP)]
    for axis, cc, d0, d1 in doors:
        floor.append(rect(d0, cc - WALL / 2, d1 - d0, WALL, DOOR_COLOR) if axis == "h"
                     else rect(cc - WALL / 2, d0, WALL, d1 - d0, DOOR_COLOR))
    for o in floor:
        o["outline"] = False

    return {"format": "lidar-sim-map", "version": 1, "name": "school floorplan",
            "worldSize": {"width": w, "height": h}, "scale": SCALE,
            "start": {"x": r1(START[0] * f + MARGIN), "y": r1(START[1] * f + MARGIN), "angle": 0},
            "obstacles": obstacles, "floor": floor}


def main(src, dst, debug=None):
    plan = cv2.imread(src)
    if plan is None:
        sys.exit(f"can't read {src}")
    walls, bays, stairs, doors = trace(plan)
    x0, y0, x1, y1 = REGION
    m_ = to_map(walls, bays, stairs, doors, (x1 - x0, y1 - y0))
    # one obstacle per line keeps diffs readable
    text = json.dumps(m_, separators=(",", ":")).replace('},{"shape"', '},\n{"shape"')
    with open(dst, "w") as fh:
        fh.write(text + "\n")
    print(f"wrote {dst}: {len(m_['obstacles'])} obstacles, {len(stairs)} stairs, {len(doors)} doors, "
          f"{m_['worldSize']['width']} x {m_['worldSize']['height']} px")

    if debug:
        plain = plan[y0:y1, x0:x1]
        img = plain.copy()
        p = lambda v: int(round(v))
        for x, y, w, h, _ in stairs:
            cv2.rectangle(img, (x, y), (x + w - 1, y + h - 1), (220, 120, 0), -1)
        for x, y, w, h in walls:
            cv2.rectangle(img, (p(x), p(y)), (p(x + w) - 1, p(y + h) - 1), (0, 0, 220), -1)
        for pts in bays:
            cv2.fillPoly(img, [np.array(pts, np.int32)], (200, 0, 200))
        for axis, cc, d0, d1 in doors:
            a, b = ((p(d0), p(cc)), (p(d1), p(cc))) if axis == "h" else ((p(cc), p(d0)), (p(cc), p(d1)))
            cv2.line(img, a, b, (0, 180, 0), 3)
        # half see-through, so the plan shows under what was found
        cv2.imwrite(debug, cv2.addWeighted(img, 0.6, plain, 0.4, 0))


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    main(*sys.argv[1:])
