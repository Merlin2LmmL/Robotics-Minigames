const EPS = 1e-6;

function robotCorners(robot) {
    const c = Math.cos(robot.angle), s = Math.sin(robot.angle);
    const hw = robot.width / 2, hh = robot.height / 2;
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
        .map(([lx, ly]) => ({ x: robot.x + lx * c - ly * s, y: robot.y + lx * s + ly * c }));
}

function project(pts, ax, ay) {
    let min = Infinity, max = -Infinity;
    for (const p of pts) {
        const d = p.x * ax + p.y * ay;
        if (d < min) min = d;
        if (d > max) max = d;
    }
    return [min, max];
}

function edgeNormals(pts, closed) {
    const axes = [];
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len > EPS) axes.push({ x: -(b.y - a.y) / len, y: (b.x - a.x) / len });
    }
    return axes;
}

// Point in polygon (even-odd rule), so it works for concave shapes too
function inside(pts, p) {
    let hit = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
}

// SAT between a convex polygon `body` (the robot's rectangle, or a pushed obstacle) and a
// convex polygon / segment / circle. `other` is { pts, closed } or { cx, cy, r }.
// Returns { nx, ny, depth }, normal pointing other -> body. (Concave polygons are treated as convex.)
function satContact(body, other) {
    let axes = edgeNormals(body, true);
    let ocx, ocy;
    if (other.pts) {
        axes = axes.concat(edgeNormals(other.pts, other.closed));
        ocx = other.pts.reduce((t, p) => t + p.x, 0) / other.pts.length;
        ocy = other.pts.reduce((t, p) => t + p.y, 0) / other.pts.length;
    } else {
        // extra axis: from the circle center to the nearest corner of the body
        let best = null, bestD2 = Infinity;
        for (const p of body) {
            const d2 = (p.x - other.cx) ** 2 + (p.y - other.cy) ** 2;
            if (d2 < bestD2) { bestD2 = d2; best = p; }
        }
        const d = Math.sqrt(bestD2);
        if (d > EPS) axes.push({ x: (best.x - other.cx) / d, y: (best.y - other.cy) / d });
        ocx = other.cx; ocy = other.cy;
    }

    let depth = Infinity, nx = 0, ny = 0;
    for (const ax of axes) {
        const [rmin, rmax] = project(body, ax.x, ax.y);
        const [omin, omax] = other.pts
            ? project(other.pts, ax.x, ax.y)
            : (() => { const c = other.cx * ax.x + other.cy * ax.y; return [c - other.r, c + other.r]; })();
        const overlap = Math.min(rmax - omin, omax - rmin);
        if (overlap <= 0) return null; // separating axis
        if (overlap < depth) { depth = overlap; nx = ax.x; ny = ax.y; }
    }
    const bcx = body.reduce((t, p) => t + p.x, 0) / body.length;
    const bcy = body.reduce((t, p) => t + p.y, 0) / body.length;
    if ((bcx - ocx) * nx + (bcy - ocy) * ny < 0) { nx = -nx; ny = -ny; }
    return { nx, ny, depth };
}

// Where two overlapping polygons touch: the average of the corners of each that lie inside
// the other. If no corner is inside (two edges crossing), the corners deepest along the
// contact normal (pointing a -> b) are used instead.
function contactPoint(a, b, nx, ny) {
    const pts = a.filter(p => inside(b, p)).concat(b.filter(p => inside(a, p)));
    if (pts.length === 0) {
        const [, amax] = project(a, nx, ny), [bmin] = project(b, nx, ny);
        pts.push(...a.filter(p => p.x * nx + p.y * ny > amax - 1), ...b.filter(p => p.x * nx + p.y * ny < bmin + 1));
    }
    return { x: pts.reduce((t, p) => t + p.x, 0) / pts.length, y: pts.reduce((t, p) => t + p.y, 0) / pts.length };
}

// Center of mass of a polygon of even density, and k2 = I / m, its squared radius of gyration
// about that center: how hard it is to turn compared with how hard it is to shove.
function massProps(pts) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length], cr = p.x * q.y - q.x * p.y;
        a += cr; cx += (p.x + q.x) * cr; cy += (p.y + q.y) * cr;
    }
    if (Math.abs(a) < EPS) {
        cx = pts.reduce((t, p) => t + p.x, 0) / pts.length;
        cy = pts.reduce((t, p) => t + p.y, 0) / pts.length;
        return { cx, cy, k2: Math.max(pts.reduce((t, p) => t + (p.x - cx) ** 2 + (p.y - cy) ** 2, 0) / pts.length, EPS) };
    }
    cx /= 3 * a; cy /= 3 * a;
    // second moment about the center: sum over edges of cr (x^2 + x x' + x'^2 + y^2 + y y' + y'^2) / 12
    let j = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = { x: pts[i].x - cx, y: pts[i].y - cy };
        const q = { x: pts[(i + 1) % pts.length].x - cx, y: pts[(i + 1) % pts.length].y - cy };
        const cr = p.x * q.y - q.x * p.y;
        j += cr * (p.x * p.x + p.x * q.x + q.x * q.x + p.y * p.y + p.y * q.y + q.y * q.y);
    }
    return { cx, cy, k2: Math.max(j / 12 / (a / 2), EPS) }; // I / m, with m = area = a / 2
}

export class Obstacle {
    constructor(shape, color = "rgba(255, 0, 0, 0.5)", ...args) {
        this.shape = shape;
        this.color = color;
        // movable: the robot can push it (as long as nothing static is in the way).
        // behavior(self, dt, world): optional per-frame hook for self-moving things
        // (people, animals, forklifts); see movers.js. world = { obstacles, robot }.
        this.movable = false;
        this.pushResistance = 0.5; // 0..1, how much pushing it slows the robot
        this.behavior = null;
        switch (shape) {
            case "rectangle":
                this.x = args[0];
                this.y = args[1];
                this.width = args[2];
                this.height = args[3];
                break;
            case "circle":
                this.x = args[0];
                this.y = args[1];
                this.radius = args[2];
                break;
            case "polygon":
                this.points = args[0];
                break;
            case "line":
                this.x1 = args[0];
                this.y1 = args[1];
                this.x2 = args[2];
                this.y2 = args[3];
                break;
        }
    }

    // Draw the obstacle on the canvas
    draw(ctx, scrollX = 0, scrollY = 0) {
        ctx.save();
        ctx.fillStyle = this.color;
        ctx.strokeStyle = this.outline === false ? "transparent" : "rgba(255, 0, 0, 1)";
        switch (this.shape) {
            case "rectangle":
                ctx.fillRect(this.x + scrollX, this.y + scrollY, this.width, this.height);
                ctx.strokeRect(this.x + scrollX, this.y + scrollY, this.width, this.height);
                break;
            case "circle":
                ctx.beginPath();
                ctx.arc(this.x + scrollX, this.y + scrollY, this.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                break;
            case "polygon":
                ctx.beginPath();
                ctx.moveTo(this.points[0].x + scrollX, this.points[0].y + scrollY);
                for (let i = 1; i < this.points.length; i++) {
                    ctx.lineTo(this.points[i].x + scrollX, this.points[i].y + scrollY);
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                break;
            case "line":
                ctx.beginPath();
                ctx.moveTo(this.x1 + scrollX, this.y1 + scrollY);
                ctx.lineTo(this.x2 + scrollX, this.y2 + scrollY);
                ctx.stroke();
                break;
        }
        ctx.restore();
    }

    // this obstacle as SAT input: { pts, closed } or { cx, cy, r }
    satShape() {
        switch (this.shape) {
            case "rectangle": {
                const { x, y, width: w, height: h } = this;
                return { closed: true, pts: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] };
            }
            case "circle": return { cx: this.x, cy: this.y, r: this.radius };
            case "polygon": return { pts: this.points, closed: true };
            case "line": return { closed: false, pts: [{ x: this.x1, y: this.y1 }, { x: this.x2, y: this.y2 }] };
            default: return null;
        }
    }

    // overlap with a convex polygon `body` (list of corners), normal pointing this -> body
    contactPts(body) {
        const other = this.satShape();
        return other && satContact(body, other);
    }

    contact(robot) { return this.contactPts(robotCorners(robot)); }

    checkCollision(robot) { return this.contact(robot) !== null; }

    translate(dx, dy) {
        switch (this.shape) {
            case "polygon": for (const p of this.points) { p.x += dx; p.y += dy; } break;
            case "line": this.x1 += dx; this.x2 += dx; this.y1 += dy; this.y2 += dy; break;
            default: this.x += dx; this.y += dy;
        }
    }

    // Turn by `angle` (rad) around (cx, cy). Only polygons turn; rectangles stay axis-aligned
    // and a circle looks the same either way.
    rotate(angle, cx, cy) {
        if (this.shape !== "polygon" || angle === 0) return;
        const c = Math.cos(angle), s = Math.sin(angle);
        for (const p of this.points) {
            const x = p.x - cx, y = p.y - cy;
            p.x = cx + x * c - y * s;
            p.y = cy + x * s + y * c;
        }
    }

    // Convex outline standing in for this obstacle when it is tested against others
    // (a circle is approximated by its bounding square, a concave polygon by its corners).
    probe() {
        switch (this.shape) {
            case "rectangle":
            case "polygon": return this.satShape().pts;
            case "circle": {
                const { x, y, radius: r } = this;
                return [{ x: x - r, y: y - r }, { x: x + r, y: y - r }, { x: x + r, y: y + r }, { x: x - r, y: y + r }];
            }
            default: return null; // lines can't be moved by pushing
        }
    }

    // Move by (dx, dy) and turn by `turn` around (cx, cy) unless that would overlap one of
    // `blockers` (or the optional `robot`). Returns true if it moved.
    tryMove(dx, dy, blockers, robot = null, turn = 0, cx = 0, cy = 0) {
        this.translate(dx, dy);
        this.rotate(turn, cx + dx, cy + dy);
        const pr = this.probe();
        if ((pr && blockers.some(b => b !== this && b.contactPts(pr))) || (robot && this.contact(robot))) {
            this.rotate(-turn, cx + dx, cy + dy);
            this.translate(-dx, -dy);
            return false;
        }
        return true;
    }

    // The robot overlaps this movable obstacle by contact c (normal pointing obstacle -> robot):
    // shove it out of the way. A polygon also turns when it is hit off-center, like a free body
    // getting a kick at the contact point: the kick is split between sliding and turning so
    // that the contact point moves exactly the overlap depth. Returns true if it moved.
    push(c, robot, blockers) {
        const ux = -c.nx, uy = -c.ny;
        if (this.shape === "polygon") {
            const { cx, cy, k2 } = massProps(this.points);
            const p = contactPoint(robotCorners(robot), this.points, ux, uy);
            const arm = (p.x - cx) * uy - (p.y - cy) * ux; // lever arm of the push about the center
            const s = c.depth / (1 + arm * arm / k2);
            if (this.tryMove(ux * s, uy * s, blockers, null, s * arm / k2, cx, cy)) return true;
            // turning would hit something: try sliding straight instead
        }
        return this.tryMove(ux * c.depth, uy * c.depth, blockers);
    }

    update(dt, world) { this.behavior?.(this, dt, world); }
}