import { GRIDSIZE, isWall } from "./map.js";
import { generateSprites } from "./sprites.js";
import { setupKeyListener, choseDirection, DOOR, RELEASE } from "./control.js";

export const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const TICK_MS = 300;
const RESTART_BTN = { width: 240, height: 90, fontSize: 40 };

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const dir = { val: "right" };
const game = { pacman: null, sprites: null, mode: "chase" };
let sprites, player;
let sinceTick = 0;
let tickCount = 0;
let last = 0;

// ---------- Setup ----------

function init() {
  sprites = generateSprites(ctx);
  game.sprites = sprites;
  player = sprites.find((s) => s.kind === "pacman");
  game.pacman = player;
  game.mode = "chase";

  for (const s of sprites) {
    if (s.kind === "ghost") s.state = s.color === "red" ? "active" : "house";
  }

  dir.val = "right";
  sinceTick = 0;
  tickCount = 0;
}

// ---------- Game logic ----------

function canMove(s, d) {
  const [dx, dy] = STEP[d] ?? [0, 0];
  return !isWall(s.x + dx, s.y + dy);
}

// Walk a waiting ghost out of the house once its release time is reached
function leaveHouse(s) {
  if (tickCount < RELEASE[s.color]) return;
  if (s.x !== DOOR[0]) s.x += Math.sign(DOOR[0] - s.x);       // 1. align with the door column
  else if (s.y !== DOOR[1]) s.y += Math.sign(DOOR[1] - s.y);  // 2. walk straight out
  else { s.state = "active"; s.dir = "left"; }                // 3. hand over to normal AI
}

const touchesPlayer = (s) => s.kind === "ghost" && s.x === player.x && s.y === player.y;

function tick() {
  tickCount++;

  for (const s of sprites) {
    s.prevX = s.x;
    s.prevY = s.y;
    if (s.isStatic) continue;

    if (s.kind === "ghost" && s.state !== "active") {
      leaveHouse(s);
      continue;
    }

    if (s === player && canMove(s, dir.val)) s.dir = dir.val;

    if (s.kind === "ghost") {
      const d = choseDirection(s, s.x, s.y, game);
      if (d) s.dir = d;
    }

    if (canMove(s, s.dir)) {
      s.x += STEP[s.dir][0];
      s.y += STEP[s.dir][1];
    }

    // Check right after each move, so the player can't step into a ghost
    // and have the ghost move away again before the collision is detected
    if (s === player ? sprites.some(touchesPlayer) : touchesPlayer(s)) {
      game.mode = "over";
    }
  }

  // Catches ghosts that moved onto the player while leaving the house
  if (sprites.some(touchesPlayer)) game.mode = "over";
}

function update(delta) {
  sinceTick += delta;
  while (sinceTick >= TICK_MS && game.mode !== "over") {
    sinceTick -= TICK_MS;
    tick();
  }
}

// ---------- Drawing ----------

function drawSprite(s, t) {
  const px = (s.prevX + (s.x - s.prevX) * t) * GRIDSIZE + GRIDSIZE / 2;
  const py = (s.prevY + (s.y - s.prevY) * t) * GRIDSIZE + GRIDSIZE / 2;
  const r = (GRIDSIZE / 2 - 2) * (s.scale || 1);
  ctx.fillStyle = s.color;
  s.shape(ctx, px, py, r, s, t);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const t = sinceTick / TICK_MS;
  for (const s of sprites) drawSprite(s, t);
}

function restartRect() {
  const { width: w, height: h } = RESTART_BTN;
  return { x: canvas.width / 2 - w / 2, y: canvas.height / 2 + 40, w, h };
}

function drawGameOver() {
  ctx.textAlign = "center";

  ctx.fillStyle = "red";
  ctx.font = "bold 128px sans-serif";
  ctx.fillText("Game Over", canvas.width / 2, canvas.height / 2);

  const r = restartRect();
  ctx.fillStyle = "white";
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = "black";
  ctx.lineWidth = 3;
  ctx.strokeRect(r.x, r.y, r.w, r.h);

  ctx.fillStyle = "black";
  ctx.font = `${RESTART_BTN.fontSize}px sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText("Restart", r.x + r.w / 2, r.y + r.h / 2);
  ctx.textBaseline = "alphabetic";
}

// ---------- Main loop ----------

function frame(now) {
  const delta = now - last;
  last = now;

  if (game.mode !== "over") {
    update(delta);
    draw();
  }
  if (game.mode === "over") drawGameOver();

  requestAnimationFrame(frame);
}

// ---------- Input ----------

canvas.addEventListener("click", (e) => {
  if (game.mode !== "over") return;
  const b = canvas.getBoundingClientRect();
  const x = (e.clientX - b.left) * (canvas.width / b.width);
  const y = (e.clientY - b.top) * (canvas.height / b.height);
  const r = restartRect();
  if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) init();
});

setupKeyListener(dir);
init();
requestAnimationFrame(frame);