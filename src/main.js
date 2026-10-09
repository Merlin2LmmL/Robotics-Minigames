import { isPortal, getPortalExit, GRIDSIZE, MAP, isWall } from "./map.js";
import { generateSprites } from "./sprites.js";
import { setupKeyListener, choseDirection, RELEASE } from "./control.js";

export const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const TICK_MS = 300;
const RESTART_BTN = { width: 240, height: 90, fontSize: 40 };

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const dir = { val: "right" };
const game = { pacman: null, sprites: null, mode: "chase" };
let sprites, player;
let exit;
let sinceTick = 0;
let tickCount = 0;
let last = 0;

// ---------- Setup ----------

function findDoor() {
  for (let y = 0; y < MAP.length; y++) {
    const x = MAP[y].indexOf("-");
    if (x !== -1) return [x, y - 1];   // the tile above the door is the exit
  }
  throw new Error('No door ("-") found in MAP');
}

function init() {
  exit = findDoor();
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
  if (s.x !== exit[0]) s.x += Math.sign(exit[0] - s.x);       // 1. align with the door column
  else if (s.y !== exit[1]) s.y += Math.sign(exit[1] - s.y);  // 2. walk up through the door
  else { s.state = "active"; s.dir = "left"; }                // 3. hand over to normal AI
}

const touchesPlayer = (s) => s.kind === "ghost" && s.x === player.x && s.y === player.y;

// Jump a sprite to the matching portal tile
function teleport(s) {
  const out = getPortalExit(s.x, s.y);
  if (!out) return;
  s.x = s.prevX = out.x;
  s.y = s.prevY = out.y;
}

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

    // Standing on a portal and the way ahead is blocked: wrap to the other side
    if (isPortal(s.x, s.y) && !canMove(s, s.dir)) teleport(s);

    if (s.kind === "ghost") {
      const d = choseDirection(s, s.x, s.y, game);
      if (d) s.dir = d;
    }

    if (canMove(s, s.dir)) {
      s.x += STEP[s.dir][0];
      s.y += STEP[s.dir][1];
    }

    if (s === player ? sprites.some(touchesPlayer) : touchesPlayer(s)) {
      game.mode = "over";
    }
  }

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
  const full = s.kind === "wall" || s.kind === "door";
  const big = s.kind === "ghost" || s.kind === "pacman" ? 1.5 : 1;
  const r = (full ? GRIDSIZE / 2 : GRIDSIZE / 2 - 2) * (s.scale || big);
  ctx.fillStyle = s.color;
  s.shape(ctx, px, py, r, s, t);
}

function draw() {
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const t = Math.min(sinceTick / TICK_MS, 1);
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

let overAt = 0;

function frame(now) {
  const delta = now - last;
  last = now;

  if (game.mode !== "over") {
    update(delta);
    draw();
    if (game.mode === "over") overAt = now;
  } else if (now - overAt < TICK_MS) {
    sinceTick = Math.min(sinceTick + delta, TICK_MS);
    draw();
  } else {
    drawGameOver();
  }

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