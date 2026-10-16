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
        ctx.strokeStyle = "rgba(255, 0, 0, 1)";
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
}