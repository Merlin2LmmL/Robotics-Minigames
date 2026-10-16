const EPS = 1e-6;

function closestOnSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { x: x1 + t * dx, y: y1 + t * dy };
}

function pointInPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > py) !== (b.y > py) &&
        px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Circle (cx, cy, r) vs a closed polygon or an open polyline.
// Returns { nx, ny, depth } where (nx, ny) points from the obstacle toward the robot.
function circleVsPath(cx, cy, r, pts, closed) {
  let best = null, bestD2 = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const c = closestOnSegment(cx, cy, a.x, a.y, b.x, b.y);
    const d2 = (cx - c.x) ** 2 + (cy - c.y) ** 2;
    if (d2 < bestD2) { bestD2 = d2; best = c; }
  }
  const dist = Math.sqrt(bestD2);
  const inside = closed && pointInPolygon(cx, cy, pts);
  if (!inside && dist >= r) return null;
  if (dist < EPS) return { nx: 0, ny: -1, depth: r }; // degenerate, center exactly on an edge

  const nx = (cx - best.x) / dist, ny = (cy - best.y) / dist;
  // center already inside: push out through the nearest edge, past it by r
  return inside
    ? { nx: -nx, ny: -ny, depth: dist + r }
    : { nx, ny, depth: r - dist };
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
        const r = robot.radius ?? Math.max(robot.width, robot.height) / 2;
        switch (this.shape) {
            case "rectangle": {
            const { x, y, width: w, height: h } = this;
            return circleVsPath(robot.x, robot.y, r,
                [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], true);
            }
            case "circle": {
            const dx = robot.x - this.x, dy = robot.y - this.y;
            const dist = Math.hypot(dx, dy);
            const minDist = r + this.radius;
            if (dist >= minDist) return null;
            if (dist < EPS) return { nx: 0, ny: -1, depth: minDist };
            return { nx: dx / dist, ny: dy / dist, depth: minDist - dist };
            }
            case "polygon":
            return circleVsPath(robot.x, robot.y, r, this.points, true);
            case "line":
            return circleVsPath(robot.x, robot.y, r,
                [{ x: this.x1, y: this.y1 }, { x: this.x2, y: this.y2 }], false);
            default:
            return null;
        }
    }

    checkCollision(robot) { return this.contact(robot) !== null; }
}