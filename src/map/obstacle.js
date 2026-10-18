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

// SAT between the robot's rotated rectangle and a convex polygon / segment / circle.
// `other` is { pts } or { cx, cy, r }. Returns { nx, ny, depth }, normal pointing obstacle -> robot.
// (Concave polygons are treated as convex.)
function rectContact(robot, other) {
    const rect = robotCorners(robot);
    let axes = edgeNormals(rect, true).slice(0, 2);
    let ocx, ocy;
    if (other.pts) {
        axes = axes.concat(edgeNormals(other.pts, other.closed));
        ocx = other.pts.reduce((t, p) => t + p.x, 0) / other.pts.length;
        ocy = other.pts.reduce((t, p) => t + p.y, 0) / other.pts.length;
    } else {
        // extra axis: from the circle center to the nearest rectangle corner
        let best = null, bestD2 = Infinity;
        for (const p of rect) {
            const d2 = (p.x - other.cx) ** 2 + (p.y - other.cy) ** 2;
            if (d2 < bestD2) { bestD2 = d2; best = p; }
        }
        const d = Math.sqrt(bestD2);
        if (d > EPS) axes.push({ x: (best.x - other.cx) / d, y: (best.y - other.cy) / d });
        ocx = other.cx; ocy = other.cy;
    }

    let depth = Infinity, nx = 0, ny = 0;
    for (const ax of axes) {
        const [rmin, rmax] = project(rect, ax.x, ax.y);
        const [omin, omax] = other.pts
            ? project(other.pts, ax.x, ax.y)
            : (() => { const c = other.cx * ax.x + other.cy * ax.y; return [c - other.r, c + other.r]; })();
        const overlap = Math.min(rmax - omin, omax - rmin);
        if (overlap <= 0) return null; // separating axis
        if (overlap < depth) { depth = overlap; nx = ax.x; ny = ax.y; }
    }
    if ((robot.x - ocx) * nx + (robot.y - ocy) * ny < 0) { nx = -nx; ny = -ny; }
    return { nx, ny, depth };
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

    contact(robot) {
        switch (this.shape) {
            case "rectangle": {
                const { x, y, width: w, height: h } = this;
                return rectContact(robot, { closed: true,
                    pts: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] });
            }
            case "circle":
                return rectContact(robot, { cx: this.x, cy: this.y, r: this.radius });
            case "polygon":
                return rectContact(robot, { pts: this.points, closed: true });
            case "line":
                return rectContact(robot, { closed: false,
                    pts: [{ x: this.x1, y: this.y1 }, { x: this.x2, y: this.y2 }] });
            default:
                return null;
        }
    }

    checkCollision(robot) { return this.contact(robot) !== null; }

    translate(dx, dy) {
        switch (this.shape) {
            case "polygon": for (const p of this.points) { p.x += dx; p.y += dy; } break;
            case "line": this.x1 += dx; this.x2 += dx; this.y1 += dy; this.y2 += dy; break;
            default: this.x += dx; this.y += dy;
        }
    }

    // Axis-aligned rectangle standing in for this obstacle when it is tested against others
    // (a circle is approximated by its bounding square).
    probe() {
        switch (this.shape) {
            case "rectangle":
                return { x: this.x + this.width / 2, y: this.y + this.height / 2, angle: 0, width: this.width, height: this.height };
            case "circle":
                return { x: this.x, y: this.y, angle: 0, width: 2 * this.radius, height: 2 * this.radius };
            default: return null; // polygons / lines can't be moved by pushing
        }
    }

    // Move by (dx, dy) unless that would overlap one of `blockers` (or the optional `robot`).
    // Returns true if it moved.
    tryMove(dx, dy, blockers, robot = null) {
        this.translate(dx, dy);
        const pr = this.probe();
        if ((pr && blockers.some(b => b !== this && b.contact(pr))) || (robot && this.contact(robot))) {
            this.translate(-dx, -dy);
            return false;
        }
        return true;
    }

    update(dt, world) { this.behavior?.(this, dt, world); }
}