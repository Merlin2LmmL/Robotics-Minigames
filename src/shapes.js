const ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
const DIRV = { right: [1, 0], down: [0, 1], left: [-1, 0], up: [0, -1] };

function drawEyes(ctx, cx, cy, r, dir, scale = 1) {
  const [dx, dy] = DIRV[dir] ?? [0, 0];
  for (const side of [-1, 1]) {
    const ex = cx + side * r * 0.38 * scale;
    const ey = cy - r * 0.15 * (scale === 1 ? 1 : 0); // dead eyes sit centered
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(ex, ey, r * 0.28 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a3cff";
    ctx.beginPath();
    ctx.arc(ex + dx * r * 0.12 * scale, ey + dy * r * 0.12 * scale, r * 0.14 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}

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

  ghost(ctx, cx, cy, r, s = {}, t = 0, mode = s.mode ?? "normal") {
    if (mode === "dead") {
      // only the googly eyes, a bit bigger so they read well on their own
      drawEyes(ctx, cx, cy, r, s.dir, 1.25);
      return;
    }

    const bottom = cy + r, right = cx + r;
    const teeth = 3, w = (2 * r) / teeth;

    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 0);
    ctx.lineTo(right, bottom);
    for (let i = 0; i < teeth; i++) {
      ctx.lineTo(right - w * (i + 0.5), bottom - r * 0.35);
      ctx.lineTo(right - w * (i + 1), bottom);
    }
    ctx.closePath();
    ctx.fill();

    drawEyes(ctx, cx, cy, r, s.dir);
  },

  wall(ctx, cx, cy, r, s = {}) {
    const n = s.n ?? {}, d = s.d ?? {};
    const k = r * 0.3;        // how far the line sits inside the tile edge
    const cr = r * 0.5;       // corner radius
    const inset = cr - k;     // how much a line is shortened at an inside corner
    const L = cx - r + k, R = cx + r - k, T = cy - r + k, B = cy + r - k;
    const P = Math.PI;

    // End of a line along a tile edge.
    const end = (c, sign, side, diag) => c + sign * (r - (side ? (diag ? inset : 0) : k + cr));

    ctx.beginPath();
    if (!n.up)    { ctx.moveTo(end(cx, -1, n.left, d.ul), T); ctx.lineTo(end(cx, 1, n.right, d.ur), T); }
    if (!n.down)  { ctx.moveTo(end(cx, -1, n.left, d.dl), B); ctx.lineTo(end(cx, 1, n.right, d.dr), B); }
    if (!n.left)  { ctx.moveTo(L, end(cy, -1, n.up, d.ul)); ctx.lineTo(L, end(cy, 1, n.down, d.dl)); }
    if (!n.right) { ctx.moveTo(R, end(cy, -1, n.up, d.ur)); ctx.lineTo(R, end(cy, 1, n.down, d.dr)); }

    const arc = (x, y, a0, a1) => {
      ctx.moveTo(x + cr * Math.cos(a0), y + cr * Math.sin(a0));
      ctx.arc(x, y, cr, a0, a1);
    };

    // outer (convex) corners
    if (!n.up && !n.left)    arc(L + cr, T + cr, P, 1.5 * P);
    if (!n.up && !n.right)   arc(R - cr, T + cr, 1.5 * P, 2 * P);
    if (!n.down && !n.right) arc(R - cr, B - cr, 0, 0.5 * P);
    if (!n.down && !n.left)  arc(L + cr, B - cr, 0.5 * P, P);

    // inside (concave) corners: both neighbours are walls but the diagonal is open
    if (n.up && n.right && !d.ur)   arc(R + cr, T - cr, 0.5 * P, P);
    if (n.up && n.left && !d.ul)    arc(L - cr, T - cr, 0, 0.5 * P);
    if (n.down && n.right && !d.dr) arc(R + cr, B + cr, P, 1.5 * P);
    if (n.down && n.left && !d.dl)  arc(L - cr, B + cr, 1.5 * P, 2 * P);

    ctx.lineCap = "butt";
    ctx.strokeStyle = s.color ?? "#2121de";
    ctx.lineWidth = r * 0.4;
    ctx.stroke();                       // outer blue line
    ctx.strokeStyle = s.bg ?? "#000";
    ctx.lineWidth = r * 0.16;
    ctx.stroke();                       // black core -> double line
  },

  // ghost-house door: thin pink bar. s.vertical = true for a vertical door
  door(ctx, cx, cy, r, s = {}) {
    const thick = r * 0.28;
    ctx.fillStyle = s.color ?? "#ffb8de";
    ctx.beginPath();
    if (s.vertical) ctx.roundRect(cx - thick / 2, cy - r, thick, 2 * r, thick / 3);
    else ctx.roundRect(cx - r, cy - thick / 2, 2 * r, thick, thick / 3);
    ctx.fill();
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