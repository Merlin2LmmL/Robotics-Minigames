const ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
const DIRV = { right: [1, 0], down: [0, 1], left: [-1, 0], up: [0, -1] };

export const shapes = {
  // t = 0..1 progress through the current tick, drives the mouth
  pacman(ctx, cx, cy, r, s, t = 0) {
    const mouth = 0.08 + 0.5 * Math.abs(Math.sin(t * Math.PI));
    const a = ANGLE[s.dir] ?? 0;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a + mouth, a + 2 * Math.PI - mouth);
    ctx.closePath();
    ctx.fill();
  },

  ghost(ctx, cx, cy, r, s, t = 0) {
    const left = cx - r, right = cx + r, bottom = cy + r;
    const teeth = 3, w = (2 * r) / teeth;

    // body: dome on top, zigzag skirt on the bottom
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 0);
    ctx.lineTo(right, bottom);
    for (let i = 0; i < teeth; i++) {
      ctx.lineTo(right - w * (i + 0.5), bottom - r * 0.35);
      ctx.lineTo(right - w * (i + 1), bottom);
    }
    ctx.closePath();
    ctx.fill();

    // eyes look in the direction of travel
    const [dx, dy] = DIRV[s.dir] ?? [0, 0];
    for (const side of [-1, 1]) {
      const ex = cx + side * r * 0.38, ey = cy - r * 0.15;
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(ex, ey, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1a3cff";
      ctx.beginPath();
      ctx.arc(ex + dx * r * 0.12, ey + dy * r * 0.12, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  // r is HALF the tile size here, so the wall fills the whole cell
  wall(ctx, cx, cy, r, s = {}) {
    ctx.fillStyle = s.color ?? "#1a2a8a";
    ctx.beginPath();
    ctx.roundRect(cx - r, cy - r, 2 * r, 2 * r, r * 0.3);
    ctx.fill();
    ctx.strokeStyle = "#4a63ff";
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath();
    ctx.roundRect(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6, r * 0.25);
    ctx.stroke();
  },

  dot(ctx, cx, cy, r, s = {}) {
    ctx.fillStyle = s.color ?? "#ffd9a0";
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.15, 0, Math.PI * 2);
    ctx.fill();
  },

  pellet(ctx, cx, cy, r, s = {}, t = 0) {
    ctx.fillStyle = s.color ?? "#ffd9a0";
    ctx.beginPath();
    ctx.arc(cx, cy, r * (0.4 + 0.08 * Math.sin(t * Math.PI * 2)), 0, Math.PI * 2);
    ctx.fill();
  },

  cherry(ctx, cx, cy, r) {
    ctx.strokeStyle = "#3a8a2a";
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.35, cy + r * 0.3);
    ctx.quadraticCurveTo(cx - r * 0.1, cy - r * 0.6, cx + r * 0.3, cy - r * 0.8);
    ctx.moveTo(cx + r * 0.35, cy + r * 0.4);
    ctx.quadraticCurveTo(cx + r * 0.4, cy - r * 0.4, cx + r * 0.3, cy - r * 0.8);
    ctx.stroke();
    ctx.fillStyle = "#d8182a";
    for (const [ox, oy] of [[-0.35, 0.4], [0.35, 0.5]]) {
      ctx.beginPath();
      ctx.arc(cx + r * ox, cy + r * oy, r * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  apple(ctx, cx, cy, r) {
    ctx.fillStyle = "#e0262a";
    ctx.beginPath();
    ctx.arc(cx - r * 0.2, cy + r * 0.1, r * 0.6, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.2, cy + r * 0.1, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#6b3a1a";
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.35);
    ctx.lineTo(cx + r * 0.1, cy - r * 0.8);
    ctx.stroke();
    ctx.fillStyle = "#3a8a2a";
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.35, cy - r * 0.6, r * 0.28, r * 0.13, -0.5, 0, Math.PI * 2);
    ctx.fill();
  },

  orange(ctx, cx, cy, r) {
    ctx.fillStyle = "#ff9a1a";
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.1, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3a8a2a";
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.2, cy - r * 0.6, r * 0.3, r * 0.13, -0.4, 0, Math.PI * 2);
    ctx.fill();
  },
};