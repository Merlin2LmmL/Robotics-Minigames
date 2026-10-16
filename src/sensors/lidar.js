// Ray vs segment: returns distance t along the ray (unit dir) or Infinity
function raySegment(ox, oy, dx, dy, x1, y1, x2, y2) {
  const ex = x2 - x1, ey = y2 - y1;
  const denom = dx * ey - dy * ex;
  if (Math.abs(denom) < 1e-9) return Infinity; // parallel
  const t = ((x1 - ox) * ey - (y1 - oy) * ex) / denom;
  const u = ((x1 - ox) * dy - (y1 - oy) * dx) / denom;
  return t >= 0 && u >= 0 && u <= 1 ? t : Infinity;
}

function rayCircle(ox, oy, dx, dy, cx, cy, r) {
  const fx = ox - cx, fy = oy - cy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  if (-b - s >= 0) return -b - s;
  return -b + s >= 0 ? -b + s : Infinity;
}

function rayPath(ox, oy, dx, dy, pts, closed) {
  let best = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    best = Math.min(best, raySegment(ox, oy, dx, dy, a.x, a.y, b.x, b.y));
  }
  return best;
}

function rayObstacle(ox, oy, dx, dy, o) {
  switch (o.shape) {
    case "rectangle": {
      const { x, y, width: w, height: h } = o;
      return rayPath(ox, oy, dx, dy,
        [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], true);
    }
    case "circle": return rayCircle(ox, oy, dx, dy, o.x, o.y, o.radius);
    case "polygon": return rayPath(ox, oy, dx, dy, o.points, true);
    case "line": return rayPath(ox, oy, dx, dy, [{ x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }], false);
    default: return Infinity;
  }
}

// offsetX/offsetY mount the sensor relative to the robot center (robot frame, +x = forward)
// Standard normal sample (Box-Muller)
function gaussian() {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

export function lidarSensor({
  rayCount = 36,
  fov = Math.PI * 2,
  range = 250,
  offsetX = 0,
  offsetY = 0,
  color = "rgba(255, 0, 0, 0.6)",
  angleNoise = 0.01, // std dev of per-ray direction jitter, radians
  rangeNoise = 1,    // std dev of per-hit distance error, world units
} = {}) {
  return {
    type: "lidar",
    rayCount, fov, range, offsetX, offsetY, color, angleNoise, rangeNoise,
    // one entry per ray: { angle, distance (null = no hit), x1, y1, x2, y2 } in world coords
    readings: [],

    scan(robot, obstacles) {
      const cos = Math.cos(robot.angle), sin = Math.sin(robot.angle);
      const ox = robot.x + this.offsetX * cos - this.offsetY * sin;
      const oy = robot.y + this.offsetX * sin + this.offsetY * cos;
      // full circle: don't duplicate the first ray at the end
      const steps = this.fov >= Math.PI * 2 - 1e-9 ? this.rayCount : Math.max(this.rayCount - 1, 1);
      const start = robot.angle - this.fov / 2;

      this.readings = [];
      for (let i = 0; i < this.rayCount; i++) {
        const a = (this.rayCount === 1 ? robot.angle : start + (this.fov * i) / steps)
          + gaussian() * this.angleNoise;
        const dx = Math.cos(a), dy = Math.sin(a);
        let d = this.range;
        let hit = false;
        for (const o of obstacles) {
          const t = rayObstacle(ox, oy, dx, dy, o);
          if (t < d) { d = t; hit = true; }
        }
        if (hit) d = Math.min(Math.max(d + gaussian() * this.rangeNoise, 0), this.range);
        this.readings.push({
          angle: a, distance: hit ? d : null,
          x1: ox, y1: oy, x2: ox + dx * d, y2: oy + dy * d,
        });
      }
      return this.readings;
    },

    draw(ctx, scrollX = 0, scrollY = 0) {
      if (document.body.dataset.lidar === "off") return;
      ctx.save();
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const r of this.readings) {
        ctx.moveTo(r.x1 + scrollX, r.y1 + scrollY);
        ctx.lineTo(r.x2 + scrollX, r.y2 + scrollY);
      }
      ctx.stroke();
      ctx.fillStyle = "red";
      for (const r of this.readings) {
        if (r.distance === null) continue;
        ctx.beginPath();
        ctx.arc(r.x2 + scrollX, r.y2 + scrollY, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },
  };
}
