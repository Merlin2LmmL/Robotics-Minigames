// Pose graph: the back end of graph SLAM.
//
// Nodes are robot poses { x, y, th } (m, rad). Edges are measurements of where node j is as
// seen from node i (from odometry or scan matching), each with an information matrix
// (inverse covariance) saying how much it can be trusted. optimize() moves all nodes at
// once so that the edges disagree as little as possible, weighted by their information:
// nonlinear least squares, solved with Gauss-Newton.
//
// Following Grisetti, Kümmerle, Stachniss, Burgard: "A Tutorial on Graph-Based SLAM" (2010).

// ---- SE(2) helpers: a pose { x, y, th } is a translation plus a rotation ----

export const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// a ⊕ b: b given in a's frame, returned in the frame a is given in
export function compose(a, b) {
    const c = Math.cos(a.th), s = Math.sin(a.th);
    return { x: a.x + c * b.x - s * b.y, y: a.y + s * b.x + c * b.y, th: wrap(a.th + b.th) };
}

export function inverse(a) {
    const c = Math.cos(a.th), s = Math.sin(a.th);
    return { x: -c * a.x - s * a.y, y: s * a.x - c * a.y, th: -a.th };
}

// a⁻¹ ⊕ b: where b is as seen from a
export function between(a, b) {
    const c = Math.cos(a.th), s = Math.sin(a.th), dx = b.x - a.x, dy = b.y - a.y;
    return { x: c * dx + s * dy, y: -s * dx + c * dy, th: wrap(b.th - a.th) };
}

export function transformPoint(pose, p) {
    const c = Math.cos(pose.th), s = Math.sin(pose.th);
    return { x: pose.x + c * p.x - s * p.y, y: pose.y + s * p.x + c * p.y };
}

// ---- small dense helpers: 3x3 matrices are flat arrays of 9, row major ----

export function diagInfo(sx, sy, sth) {
    return [1 / (sx * sx), 0, 0, 0, 1 / (sy * sy), 0, 0, 0, 1 / (sth * sth)];
}

export const addMat = (a, b) => a.map((v, i) => v + b[i]);

function inv3(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-300) return [0, 0, 0, 0, 0, 0, 0, 0, 0];
    return [A / det, (c * h - b * i) / det, (b * f - c * e) / det,
            B / det, (a * i - c * g) / det, (c * d - a * f) / det,
            C / det, (b * g - a * h) / det, (a * e - b * d) / det];
}

// out += Aᵀ Ω B for 3x3 A, Ω, B
function addAtWB(out, A, W, B) {
    for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) {
            let t = 0;
            for (let k = 0; k < 3; k++) {
                let wb = 0;
                for (let l = 0; l < 3; l++) wb += W[k * 3 + l] * B[l * 3 + c];
                t += A[k * 3 + r] * wb;
            }
            out[r * 3 + c] += t;
        }
}

// ---- the graph ----

const ROBUST_C = 3;      // Cauchy kernel width (in sigmas) for edges marked robust
const STOP_STEP = 1e-4;  // stop when no node moves more than this (m or rad) in one iteration...
const STOP_GAIN = 1e-3;  // ...or the error shrank by less than this share

// Error of edge e: e = t2v(Z⁻¹ (Xi⁻¹ Xj)), zero when the nodes agree with the measurement.
// Also returns its Jacobians A = ∂e/∂xi and B = ∂e/∂xj.
function edgeError(xi, xj, z, withJacobians) {
    const ci = Math.cos(xi.th), si = Math.sin(xi.th), cz = Math.cos(z.th), sz = Math.sin(z.th);
    const dx = xj.x - xi.x, dy = xj.y - xi.y;
    const rx = ci * dx + si * dy - z.x, ry = -si * dx + ci * dy - z.y; // in i's frame, minus the measurement
    const e = [cz * rx + sz * ry, -sz * rx + cz * ry, wrap(xj.th - xi.th - z.th)];
    if (!withJacobians) return { e };
    // RzᵀRiᵀ and Rzᵀ (dRiᵀ/dθi) (tj - ti)
    const c = Math.cos(xi.th + z.th), s = Math.sin(xi.th + z.th);
    const ddx = -si * dx + ci * dy, ddy = -ci * dx - si * dy;
    const gx = cz * ddx + sz * ddy, gy = -sz * ddx + cz * ddy;
    const A = [-c, -s, gx, s, -c, gy, 0, 0, -1];
    const B = [c, s, 0, -s, c, 0, 0, 0, 1];
    return { e, A, B };
}

const quad = (e, W) => {
    let t = 0;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) t += e[r] * W[r * 3 + c] * e[c];
    return t;
};

export class PoseGraph {
    constructor() {
        this.nodes = []; // { x, y, th }
        this.edges = []; // { i, j, z, info, robust, weight }
    }

    addNode(pose) {
        this.nodes.push({ x: pose.x, y: pose.y, th: pose.th });
        return this.nodes.length - 1;
    }

    // z: node j as seen from node i. robust: down-weight the edge when it disagrees a lot with
    // the rest of the graph (for loop closures, which can be plain wrong).
    addEdge(i, j, z, info, robust = false) {
        const edge = { i, j, z: { ...z }, info: info.slice(), robust, weight: 1 };
        this.edges.push(edge);
        return edge;
    }

    // squared error of one edge, in units of its own uncertainty
    edgeChi2(ed) {
        return quad(edgeError(this.nodes[ed.i], this.nodes[ed.j], ed.z).e, ed.info);
    }

    // Weighted squared error of the whole graph (the thing optimize() makes small)
    chi2() {
        let t = 0;
        for (const ed of this.edges) t += ed.weight * this.edgeChi2(ed);
        return t;
    }

    // Gauss-Newton: linearize every edge around the current nodes, solve the sparse linear
    // system H Δ = -b for a step of all nodes at once, apply it, repeat.
    optimize(iterations = 10) {
        const n = this.nodes.length;
        if (n < 2) return { iterations: 0, cgSteps: 0, chi2: 0 };
        let it = 0, cgSteps = 0, chi2 = this.chi2();
        for (; it < iterations; it++) {
            // H as one row of 3x3 blocks per node: rows[i] = Map(j -> block)
            const rows = Array.from({ length: n }, () => new Map());
            const b = new Float64Array(3 * n);
            const block = (i, j) => {
                let m = rows[i].get(j);
                if (!m) { m = new Float64Array(9); rows[i].set(j, m); }
                return m;
            };

            for (const ed of this.edges) {
                const { e, A, B } = edgeError(this.nodes[ed.i], this.nodes[ed.j], ed.z, true);
                if (ed.robust) ed.weight = 1 / (1 + quad(e, ed.info) / (ROBUST_C * ROBUST_C));
                const W = ed.info.map(v => v * ed.weight);
                addAtWB(block(ed.i, ed.i), A, W, A);
                addAtWB(block(ed.i, ed.j), A, W, B);
                addAtWB(block(ed.j, ed.i), B, W, A);
                addAtWB(block(ed.j, ed.j), B, W, B);
                // b += Jᵀ W e
                for (let r = 0; r < 3; r++) {
                    let ta = 0, tb = 0;
                    for (let k = 0; k < 3; k++) {
                        const we = W[k * 3] * e[0] + W[k * 3 + 1] * e[1] + W[k * 3 + 2] * e[2];
                        ta += A[k * 3 + r] * we;
                        tb += B[k * 3 + r] * we;
                    }
                    b[3 * ed.i + r] += ta;
                    b[3 * ed.j + r] += tb;
                }
            }
            // the first node stays where it is, so the whole graph can't drift away: drop its
            // row and column and give it the equation Δ0 = 0
            for (const row of rows) row.delete(0);
            rows[0] = new Map([[0, Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1)]]);
            b[0] = b[1] = b[2] = 0;

            const { x: dx, steps } = solve(rows, b.map(v => -v));
            cgSteps += steps;
            let biggest = 0;
            for (let i = 0; i < n; i++) {
                const p = this.nodes[i];
                p.x += dx[3 * i]; p.y += dx[3 * i + 1]; p.th = wrap(p.th + dx[3 * i + 2]);
                biggest = Math.max(biggest, Math.abs(dx[3 * i]), Math.abs(dx[3 * i + 1]), Math.abs(dx[3 * i + 2]));
            }
            const now = this.chi2();
            if (biggest < STOP_STEP || now > chi2 * (1 - STOP_GAIN)) { it++; chi2 = now; break; }
            chi2 = now;
        }
        return { iterations: it, cgSteps, chi2 };
    }
}

const mul3 = (a, b) => {
    const c = new Float64Array(9);
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) c[r * 3 + j] += a[r * 3 + k] * b[k * 3 + j];
    return c;
};
const transpose3 = a => Float64Array.of(a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]);

// out[o..o+2] += sign * M[m..m+8] v[v0..v0+2]
function madd(M, m, v, v0, out, o, sign) {
    const x = v[v0], y = v[v0 + 1], z = v[v0 + 2];
    out[o] += sign * (M[m] * x + M[m + 1] * y + M[m + 2] * z);
    out[o + 1] += sign * (M[m + 3] * x + M[m + 4] * y + M[m + 5] * z);
    out[o + 2] += sign * (M[m + 6] * x + M[m + 7] * y + M[m + 8] * z);
}

// Preconditioner: H with every block dropped except the diagonal and the links between
// consecutive nodes. That is the robot's chain of odometry edges, block tridiagonal, so it
// factors exactly in O(n) (block LDLᵀ). The loop closures are what is left for CG, and there
// are few of them, so it needs few iterations instead of about one per node.
function chainFactor(rows) {
    const n = rows.length;
    const Dinv = new Float64Array(9 * n), L = new Float64Array(9 * n), Lt = new Float64Array(9 * n);
    let prevInv = inv3(rows[0].get(0));
    Dinv.set(prevInv, 0);
    for (let i = 1; i < n; i++) {
        const C = rows[i].get(i - 1) ?? new Float64Array(9);
        const Li = mul3(C, prevInv), LCt = mul3(Li, transpose3(C)), Mii = rows[i].get(i);
        prevInv = inv3(Array.from(Mii, (v, k) => v - LCt[k]));
        Dinv.set(prevInv, 9 * i);
        L.set(Li, 9 * i);
        Lt.set(transpose3(Li), 9 * i);
    }
    const y = new Float64Array(3 * n);
    return (r, out) => {
        y.set(r);
        for (let i = 1; i < n; i++) madd(L, 9 * i, y, 3 * (i - 1), y, 3 * i, -1);
        out.fill(0);
        for (let i = n - 1; i >= 0; i--) {
            madd(Dinv, 9 * i, y, 3 * i, out, 3 * i, 1);
            if (i + 1 < n) madd(Lt, 9 * (i + 1), out, 3 * (i + 1), out, 3 * i, -1);
        }
    };
}

// Solve H x = rhs for the sparse, symmetric positive definite block matrix H with
// preconditioned conjugate gradients. H is packed into flat arrays first (compressed rows
// of 3x3 blocks), the inner loop runs hundreds of times.
function solve(rows, rhs) {
    const n = rows.length, m = 3 * n;
    const start = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) start[i + 1] = start[i] + rows[i].size;
    const col = new Int32Array(start[n]), val = new Float64Array(9 * start[n]);
    for (let i = 0, k = 0; i < n; i++)
        for (const [j, B] of rows[i]) { col[k] = j; val.set(B, 9 * k); k++; }
    const mulH = (v, out) => {
        out.fill(0);
        for (let i = 0; i < n; i++)
            for (let k = start[i]; k < start[i + 1]; k++) madd(val, 9 * k, v, 3 * col[k], out, 3 * i, 1);
    };
    const precond = chainFactor(rows);
    const dot = (a, b) => { let t = 0; for (let i = 0; i < m; i++) t += a[i] * b[i]; return t; };

    const x = new Float64Array(m), r = Float64Array.from(rhs), z = new Float64Array(m), Hp = new Float64Array(m);
    precond(r, z);
    const p = Float64Array.from(z);
    let rz = dot(r, z);
    const stop = 1e-6 * Math.max(dot(rhs, rhs), 1e-30); // residual down to 1e-3 of where it started: Gauss-Newton
    // takes another step anyway, so an exact solve would be wasted
    let k = 0;
    for (; k < m && dot(r, r) > stop; k++) {
        mulH(p, Hp);
        const pHp = dot(p, Hp);
        if (!(pHp > 0)) break;
        const alpha = rz / pHp;
        for (let i = 0; i < m; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Hp[i]; }
        precond(r, z);
        const rz2 = dot(r, z), beta = rz2 / rz;
        rz = rz2;
        for (let i = 0; i < m; i++) p[i] = z[i] + beta * p[i];
    }
    return { x, steps: k };
}
