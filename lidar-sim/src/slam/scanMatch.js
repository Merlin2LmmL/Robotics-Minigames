// Scan matching: find the pose at which a scan lines up best with a reference point cloud.
//
// Point-to-line ICP (iterative closest point): pair every scan point with the closest
// reference point, measure how far it is from the wall through that point (along the wall's
// normal, so sliding along a wall costs nothing), and solve for the small pose change that
// shrinks those distances most. Repeat until nothing moves.
//
// Censi, "An ICP variant using a point-to-line metric" (ICRA 2008); the Hessian of the last
// iteration doubles as the information matrix of the result, which is what the pose graph needs.
// All units are meters and radians.

import { compose, between, transformPoint } from "./poseGraph.js";

const CELL = 0.5;           // m, spatial hash cell for nearest-neighbor search (also the largest pairing distance)
const NORMAL_RADIUS = 0.3;  // m, neighbors used to fit the wall direction at a point
const MIN_NEIGHBORS = 3;
const MAX_CURVE = 0.08;     // smallest/largest spread of those neighbors; above this the point is a corner or clutter
const SIGMA = 0.03;         // m, assumed point-to-line error of a good match
const HUBER = 0.05;         // m, residuals beyond this count linearly, not squared
const ITERATIONS = 30;
const INLIER = 0.1;         // m, a matched point closer than this to its line is an inlier
// Weak pull toward the starting guess, in the same units as the point terms (one point is 1).
// Along a straight wall the points say nothing about where along it the scan is, and without
// this the match could slide anywhere in that direction. Odometry is the better guess there.
const PRIOR_POS = 2;        // per m²
const PRIOR_TURN = 20;      // per rad²

// Spatial hash over points, for fast "everything within r of p" queries
class Grid {
    constructor(points, cell = CELL) {
        this.cell = cell;
        this.map = new Map();
        for (const p of points) {
            const k = this.key(Math.floor(p.x / cell), Math.floor(p.y / cell));
            let bucket = this.map.get(k);
            if (!bucket) this.map.set(k, bucket = []);
            bucket.push(p);
        }
    }

    key(i, j) { return i * 73856093 ^ j * 19349663; }

    // closest point within r (r <= cell), or null
    nearest(x, y, r) {
        const i0 = Math.floor(x / this.cell), j0 = Math.floor(y / this.cell);
        let best = null, bd = r * r;
        for (let i = i0 - 1; i <= i0 + 1; i++)
            for (let j = j0 - 1; j <= j0 + 1; j++)
                for (const p of this.map.get(this.key(i, j)) ?? []) {
                    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
                    if (d < bd) { bd = d; best = p; }
                }
        return best;
    }

    within(x, y, r) {
        const out = [], i0 = Math.floor(x / this.cell), j0 = Math.floor(y / this.cell);
        for (let i = i0 - 1; i <= i0 + 1; i++)
            for (let j = j0 - 1; j <= j0 + 1; j++)
                for (const p of this.map.get(this.key(i, j)) ?? [])
                    if ((p.x - x) ** 2 + (p.y - y) ** 2 <= r * r) out.push(p);
        return out;
    }
}

// Reference cloud for matching: the points (world frame), each with the normal of the wall
// it lies on. Points with no clear wall direction (corners, clutter, too few neighbors) get
// no normal and are never matched against, they would only pull the match sideways.
export function buildReference(points) {
    const all = new Grid(points);
    const lined = [];
    for (const p of points) {
        const nb = all.within(p.x, p.y, NORMAL_RADIUS);
        if (nb.length < MIN_NEIGHBORS) continue;
        // principal directions of the neighborhood: the normal is the direction of least spread
        let mx = 0, my = 0;
        for (const q of nb) { mx += q.x; my += q.y; }
        mx /= nb.length; my /= nb.length;
        let sxx = 0, sxy = 0, syy = 0;
        for (const q of nb) { const dx = q.x - mx, dy = q.y - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
        const mid = (sxx + syy) / 2, half = Math.hypot((sxx - syy) / 2, sxy);
        const big = mid + half, small = mid - half;
        if (!(big > 0) || small / big > MAX_CURVE) continue;
        const t = Math.atan2(2 * sxy, sxx - syy) / 2; // direction of most spread: along the wall
        lined.push({ x: p.x, y: p.y, nx: -Math.sin(t), ny: Math.cos(t) });
    }
    return { grid: new Grid(lined), size: lined.length };
}

function solve3(H, g) {
    const [a, b, c, , e, f, , , i] = H; // symmetric
    const A = e * i - f * f, B = c * f - b * i, C = b * f - c * e;
    const det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-12) return null;
    return [
        (A * g[0] + B * g[1] + C * g[2]) / det,
        (B * g[0] + (a * i - c * c) * g[1] + (b * c - a * f) * g[2]) / det,
        (C * g[0] + (b * c - a * f) * g[1] + (a * e - b * b) * g[2]) / det,
    ];
}

// Align `scan` (points in the scan's own frame) to `ref` (from buildReference), starting at
// `guess` (the scan frame's pose in the reference frame). Returns
//   pose:      the best pose found
//   info:      3x3 information matrix (flat, row major) of that pose, in the scan's own frame,
//              ready for PoseGraph.addEdge. It is small in directions the scan can't pin
//              down, like along a featureless corridor. (The pull toward the guess isn't in it.)
//   fraction:  share of scan points that ended up on a reference line (0..1)
//   rms:       their mean distance from it (m)
//   matched:   how many points were paired in the last iteration
export function matchScan(scan, ref, guess, { maxDist = 0.5, minDist = 0.15 } = {}) {
    let pose = { ...guess }, H = null, matched = 0;
    for (let it = 0; it < ITERATIONS; it++) {
        // pairing radius shrinks: generous at first, strict once the match is close
        const r = Math.max(minDist, maxDist * (1 - it / 10));
        const c = Math.cos(pose.th), s = Math.sin(pose.th);
        const h = [0, 0, 0, 0, 0, 0, 0, 0, 0], g = [0, 0, 0];
        matched = 0;
        for (const p of scan) {
            const qx = pose.x + c * p.x - s * p.y, qy = pose.y + s * p.x + c * p.y;
            const m = ref.grid.nearest(qx, qy, Math.min(r, ref.grid.cell));
            if (!m) continue;
            const res = m.nx * (qx - m.x) + m.ny * (qy - m.y);
            // derivative of res with respect to a pose change (dx, dy, dθ) in the scan's own frame
            const jx = m.nx * c + m.ny * s, jy = -m.nx * s + m.ny * c;
            const jt = jx * -p.y + jy * p.x;
            const w = Math.abs(res) <= HUBER ? 1 : HUBER / Math.abs(res);
            const J = [jx, jy, jt];
            for (let a = 0; a < 3; a++) {
                g[a] += w * J[a] * res;
                for (let b = 0; b < 3; b++) h[a * 3 + b] += w * J[a] * J[b];
            }
            matched++;
        }
        if (matched < 6) return null;
        H = h.slice();
        const off = between(guess, pose);
        h[0] += PRIOR_POS; h[4] += PRIOR_POS; h[8] += PRIOR_TURN;
        g[0] += PRIOR_POS * off.x; g[1] += PRIOR_POS * off.y; g[2] += PRIOR_TURN * off.th;
        const d = solve3(h, g);
        if (!d) return null;
        pose = compose(pose, { x: -d[0], y: -d[1], th: -d[2] });
        if (it >= 10 && Math.hypot(d[0], d[1]) < 1e-4 && Math.abs(d[2]) < 1e-4) break;
    }

    let inliers = 0, sq = 0;
    for (const p of scan) {
        const q = transformPoint(pose, p);
        const m = ref.grid.nearest(q.x, q.y, INLIER);
        if (!m) continue;
        const res = m.nx * (q.x - m.x) + m.ny * (q.y - m.y);
        if (Math.abs(res) < INLIER) { inliers++; sq += res * res; }
    }
    return {
        pose,
        info: H.map(v => v / (SIGMA * SIGMA)),
        fraction: inliers / scan.length,
        rms: inliers ? Math.sqrt(sq / inliers) : Infinity,
        matched,
    };
}

// How well a match pins down position: smallest over largest eigenvalue of the translation
// part of its information. Near 0 along a straight corridor, near 1 in a corner.
export function conditioning(info) {
    const a = info[0], b = info[1], c = info[4];
    const mid = (a + c) / 2, half = Math.hypot((a - c) / 2, b);
    return mid + half > 0 ? Math.max(mid - half, 0) / (mid + half) : 0;
}
