import { GRIDSIZE, isWall } from "./map.js";
import { generateSprites } from "./sprites.js";
import { setupKeyListener, choseDirection } from "./control.js";

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const TICK_MS = 500;
let sinceTick = 0;

let dir = { val: "right" }; // initial direction
const sprites = generateSprites(ctx);
const player = sprites.find(s => s.kind === "pacman");
const blinky = sprites.find(s => s.kind === "ghost" && s.color === "red");
const game = { pacman: player, blinky, mode: "chase" };
setupKeyListener(dir);

export const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function canMove(s, d) {
  const [dx, dy] = STEP[d] ?? [0, 0];
  return !isWall(s.x + dx, s.y + dy);
}

function tick() {
  for (const s of sprites) {
    s.prevX = s.x;
    s.prevY = s.y;
    if (s.isStatic) continue;

    if (s === player && canMove(s, dir.val)) s.dir = dir.val;

    if (s.kind === "ghost") {
      const d = choseDirection(s, s.x, s.y, game);
      if (d) s.dir = d;
    }

    if (canMove(s, s.dir)) {
      s.x += STEP[s.dir][0];
      s.y += STEP[s.dir][1];
    }
  }
}

function drawSprite(s, t) {
    const px = (s.prevX + (s.x - s.prevX) * t) * GRIDSIZE + GRIDSIZE / 2;
    const py = (s.prevY + (s.y - s.prevY) * t) * GRIDSIZE + GRIDSIZE / 2;
    const r = (GRIDSIZE / 2 - 2) * (s.scale || 1);
    ctx.fillStyle = s.color;
    s.shape(ctx, px, py, r, s, t);
}

function update(delta) {
    sinceTick += delta;
    while (sinceTick >= TICK_MS) {
        sinceTick -= TICK_MS;
        tick();
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const t = sinceTick / TICK_MS;
    for (const s of sprites) {
        drawSprite(s, t);
    }
}

let last = 0;
function frame(now) {
    const delta = now - last;
    last = now;
    update(delta);
    draw();
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);