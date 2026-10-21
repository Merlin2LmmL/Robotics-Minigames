const ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
const DIRV = { right: [1, 0], down: [0, 1], left: [-1, 0], up: [0, -1] };

// ---------- party helpers ----------
// PacState is expected to be a global (or import it here instead).
const party = () => typeof PacState !== "undefined" && !!PacState.partying;
const clock = () => performance.now();
const hue = (offset = 0, speed = 0.12) => clock() * speed + offset;
const hsl = (h, s = 100, l = 55) => `hsl(${((h % 360) + 360) % 360} ${s}% ${l}%)`;

function drawEyes(ctx, cx, cy, r, dir, scale = 1) {
  const [dx, dy] = DIRV[dir] ?? [0, 0];
  const p = party();
  for (const side of [-1, 1]) {
    const ex = cx + side * r * 0.38 * scale;
    const ey = cy - r * 0.15 * (scale === 1 ? 1 : 0); // dead eyes sit centered
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(ex, ey, r * 0.28 * scale, 0, Math.PI * 2);
    ctx.fill();
    // party: pupils cycle through the rainbow, each eye offset in hue
    ctx.fillStyle = p ? hsl(hue(side * 90, 0.35), 100, 50) : "#1a3cff";
    ctx.beginPath();
    ctx.arc(ex + dx * r * 0.12 * scale, ey + dy * r * 0.12 * scale, r * 0.14 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}

function partyFruit(draw) {
  return function (ctx, cx, cy, r, s, t = 0) {
    if (!party()) return draw(ctx, cx, cy, r);
    const wob = Math.sin(clock() / 120);
    ctx.save();
    ctx.shadowColor = hsl(hue(0, 0.3), 100, 60);
    ctx.shadowBlur = r * (0.8 + 0.4 * Math.sin(t * Math.PI * 2));
    ctx.translate(cx, cy + wob * r * 0.08);
    ctx.rotate(wob * 0.12);
    const k = 1 + 0.06 * Math.sin(t * Math.PI * 2);
    ctx.scale(k, k);
    draw(ctx, 0, 0, r);
    ctx.restore();
  };
}

const cherryBase = (ctx, cx, cy, r) => {
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
};

const appleBase = (ctx, cx, cy, r) => {
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
};

const orangeBase = (ctx, cx, cy, r) => {
  ctx.fillStyle = "#ff9a1a";
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.1, r * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3a8a2a";
  ctx.beginPath();
  ctx.ellipse(cx + r * 0.2, cy - r * 0.6, r * 0.3, r * 0.13, -0.4, 0, Math.PI * 2);
  ctx.fill();
};

export const shapes = {
  // t = 0..1 progress through the current tick, drives the mouth
  pacman(ctx, cx, cy, r, s, t = 0) {
    const mouth = 0.08 + 0.5 * Math.abs(Math.sin(t * Math.PI));
    const a = ANGLE[s.dir] ?? 0;
    const p = party();

    if (p) {
      ctx.save();
      // rainbow gradient across the body, spinning with time
      const h = hue(0, 0.3);
      const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      g.addColorStop(0, hsl(h, 100, 58));
      g.addColorStop(0.5, hsl(h + 120, 100, 58));
      g.addColorStop(1, hsl(h + 240, 100, 58));
      ctx.fillStyle = g;
      ctx.shadowColor = hsl(h + 60, 100, 60);
      ctx.shadowBlur = r * (0.9 + 0.5 * Math.sin(t * Math.PI * 2));
    }

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a + mouth, a + 2 * Math.PI - mouth);
    ctx.closePath();
    ctx.fill();

    if (p) {
      // three little orbiting sparkles
      ctx.shadowBlur = 0;
      for (let i = 0; i < 3; i++) {
        const ang = clock() / 250 + (i * Math.PI * 2) / 3;
        const rad = r * (1.3 + 0.1 * Math.sin(t * Math.PI * 2 + i));
        ctx.fillStyle = hsl(hue(i * 120, 0.5), 100, 75);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, r * 0.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  },

  ghost(ctx, cx, cy, r, s = {}, t = 0) {
    const p = party();

    if (s.state === "eaten") {
      // only the googly eyes, a bit bigger so they read well on their own
      drawEyes(ctx, cx, cy, r, s.dir, 1.25);
      return;
    }

    const frightened = s.state === "frightened";
    // Frightened ghosts stay in the blue/purple range so they're still
    // clearly "edible"; they just shimmer.
    if (frightened) {
      ctx.fillStyle = p ? hsl(250 + 35 * Math.sin(clock() / 150), 80, 45) : "#2121de";
    }

    const bottom = cy + r, right = cx + r;
    const teeth = 3, w = (2 * r) / teeth;
    const wig = p ? 1 + 0.25 * Math.sin(t * Math.PI * 2) : 1;

    ctx.save();
    if (p && !frightened) {
      // keep the ghost's own body color (identity!), add a rainbow halo
      ctx.shadowColor = hsl(hue(0, 0.4), 100, 60);
      ctx.shadowBlur = r * 1.1;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 0);
    ctx.lineTo(right, bottom);
    for (let i = 0; i < teeth; i++) {
      ctx.lineTo(right - w * (i + 0.5), bottom - r * 0.35 * wig);
      ctx.lineTo(right - w * (i + 1), bottom);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    if (!frightened) {
      drawEyes(ctx, cx, cy, r, s.dir);
      return;
    }

    // Frightened face: two dots and a zigzag mouth
    ctx.save();
    const face = p ? hsl(hue(0, 0.6), 100, 75) : "#ffb8ae";
    ctx.fillStyle = ctx.strokeStyle = face;
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.lineJoin = "round";

    const eyeY = cy - r * 0.2, eyeR = r * 0.13;
    for (const dx of [-0.3, 0.3]) {
      ctx.beginPath();
      ctx.arc(cx + dx * r, eyeY, eyeR, 0, Math.PI * 2);
      ctx.fill();
    }

    const segs = 6, mouthY = cy + r * 0.35, amp = r * 0.12 * (p ? 1 + 0.5 * Math.sin(t * Math.PI * 4) : 1);
    const x0 = cx - r * 0.6, step = (r * 1.2) / segs;
    ctx.beginPath();
    ctx.moveTo(x0, mouthY);
    for (let i = 1; i <= segs; i++) {
      ctx.lineTo(x0 + step * i, mouthY + (i % 2 ? -amp : amp));
    }
    ctx.stroke();
    ctx.restore();
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

    const wallColor = party()
      ? hsl(hue((cx + cy) * 0.6, 0.15), 100, 50)
      : (s.color ?? "#2121de");

    ctx.lineCap = "butt";
    ctx.strokeStyle = wallColor;
    ctx.lineWidth = r * 0.4;
    ctx.stroke();                       // outer line
    ctx.strokeStyle = s.bg ?? "#000";
    ctx.lineWidth = r * 0.16;
    ctx.stroke();                       // black core -> double line
  },

  // ghost-house door: thin bar. s.vertical = true for a vertical door
  door(ctx, cx, cy, r, s = {}) {
    const thick = r * 0.28;
    ctx.fillStyle = party()
      ? hsl(310 + 40 * Math.sin(clock() / 200 + cx * 0.05), 100, 70)
      : (s.color ?? "#ffb8de");
    ctx.beginPath();
    if (s.vertical) ctx.roundRect(cx - thick / 2, cy - r, thick, 2 * r, thick / 3);
    else ctx.roundRect(cx - r, cy - thick / 2, 2 * r, thick, thick / 3);
    ctx.fill();
  },

  dot(ctx, cx, cy, r, s = {}) {
    ctx.fillStyle = party()
      ? hsl(hue(cx * 0.8 + cy * 0.8, 0.25), 100, 75)
      : (s.color ?? "#ffd9a0");
    ctx.beginPath();
    ctx.arc(cx, cy, r * (party() ? 0.18 : 0.15), 0, Math.PI * 2);
    ctx.fill();
  },

  pellet(ctx, cx, cy, r, s = {}, t = 0) {
    const p = party();
    ctx.save();
    if (p) {
      ctx.fillStyle = hsl(hue(0, 0.6), 100, 65);
      ctx.shadowColor = hsl(hue(180, 0.6), 100, 60);
      ctx.shadowBlur = r * 1.2;
    } else {
      ctx.fillStyle = s.color ?? "#ffd9a0";
    }
    const pulse = p ? 0.14 : 0.08;
    ctx.beginPath();
    ctx.arc(cx, cy, r * (0.4 + pulse * Math.sin(t * Math.PI * 2)), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },

  cherry: partyFruit(cherryBase),
  apple: partyFruit(appleBase),
  orange: partyFruit(orangeBase),
};