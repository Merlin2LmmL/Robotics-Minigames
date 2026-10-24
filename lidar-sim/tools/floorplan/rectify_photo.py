"""Straighten a phone photo of a floor plan.

Fits a radial lens distortion and a homography so that the plan's line segments come out
horizontal or vertical, then fixes the aspect ratio and crops to the sheet.

    python3 rectify_photo.py PHOTO OUT

Needs OpenCV, NumPy and SciPy (apt install python3-opencv python3-scipy).
"""
import sys
import cv2
import numpy as np
from scipy.optimize import least_squares

# Fitting only makes the lines straight and level, it can't know how tall the sheet is
# compared to its width. ASPECT stretches y so the sheet comes out as A-format paper
# (sqrt 2), and CROP cuts it out, both in the straightened frame before the stretch.
ASPECT = 1.347
CROP = (333, 101, 3659, 1895)  # x0, y0, x1, y1

MIN_SEGMENT = 60   # px, shorter line segments are mostly text
MAX_TILT = 12      # degrees off horizontal/vertical a segment may be to count as a wall


def main(src, dst):
    im = cv2.imread(src)
    if im is None:
        sys.exit(f"can't read {src}")
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    h0, w0 = g.shape
    cx, cy, f = w0 / 2, h0 / 2, w0 / 2

    # line segments of the plan, on a contrast-boosted copy (the photo is unevenly lit)
    cl = cv2.createCLAHE(clipLimit=3, tileGridSize=(16, 16)).apply(g)
    segs = cv2.createLineSegmentDetector(0).detect(cv2.GaussianBlur(cl, (3, 3), 0))[0][:, 0, :]
    length = np.hypot(segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1])
    ang = np.degrees(np.arctan2(segs[:, 3] - segs[:, 1], segs[:, 2] - segs[:, 0])) % 90
    keep = (length > MIN_SEGMENT) & ((ang < MAX_TILT) | (ang > 90 - MAX_TILT))
    segs, length = segs[keep], length[keep]
    print(f"{len(segs)} segments")

    def undistort(p, k1):
        x, y = (p[:, 0] - cx) / f, (p[:, 1] - cy) / f
        s = 1 + k1 * (x * x + y * y)
        return np.stack([x * s, y * s], 1)

    def homography(p, h):
        q = np.c_[p, np.ones(len(p))] @ np.append(h, 1).reshape(3, 3).T
        return q[:, :2] / q[:, 2:3]

    # how far each segment is from horizontal/vertical after the mapping, longer ones count more
    def residuals(h, k1):
        a = homography(undistort(segs[:, :2], k1), h)
        b = homography(undistort(segs[:, 2:], k1), h)
        t = np.arctan2(b[:, 1] - a[:, 1], b[:, 0] - a[:, 0])
        dev = np.arcsin(np.clip(np.sin(2 * t), -1, 1)) / 2
        return np.sqrt(length) * np.clip(dev, -0.06, 0.06) * 100

    # the lens term is found by a plain scan, the optimizer gets stuck on it
    best = None
    for k1 in np.linspace(0, 0.04, 21):
        r = least_squares(residuals, np.array([1, 0, 0, 0, 1, 0, 0, 0.]), args=(k1,), loss="soft_l1")
        if best is None or r.cost < best[0]:
            best = (r.cost, k1, r.x)
    _, k1, h = best
    print(f"lens k1 {k1:.3f}")

    # straightened frame: the photo corners mapped, scaled back to about the photo's width
    corners = homography(undistort(np.array([[0, 0], [w0, 0], [w0, h0], [0, h0]], float), k1), h)
    lo, hi = corners.min(0), corners.max(0)
    scale = w0 / (hi[0] - lo[0])

    # every output pixel -> straightened frame -> plan coordinates -> back through H and the lens
    x0, y0, x1, y1 = CROP
    out_w, out_h = x1 - x0, int((y1 - y0) * ASPECT)
    u, v = np.meshgrid(np.arange(out_w, dtype=float), np.arange(out_h, dtype=float))
    px = (u.ravel() + x0) / scale + lo[0]
    py = (v.ravel() / ASPECT + y0) / scale + lo[1]
    q = np.c_[px, py, np.ones(len(px))] @ np.linalg.inv(np.append(h, 1).reshape(3, 3)).T
    xu, yu = q[:, 0] / q[:, 2], q[:, 1] / q[:, 2]
    xd, yd = xu.copy(), yu.copy()
    for _ in range(20):  # invert the lens term by fixed point iteration
        s = 1 + k1 * (xd * xd + yd * yd)
        xd, yd = xu / s, yu / s
    mx = (xd * f + cx).reshape(out_h, out_w).astype(np.float32)
    my = (yd * f + cy).reshape(out_h, out_w).astype(np.float32)
    out = cv2.remap(im, mx, my, cv2.INTER_CUBIC, borderValue=(255, 255, 255))
    cv2.imwrite(dst, out, [cv2.IMWRITE_JPEG_QUALITY, 90])
    print(f"wrote {dst} ({out_w} x {out_h})")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(*sys.argv[1:])
