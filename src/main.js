import { GRIDSIZE, isWall } from "./map.js";
import { generateSprites } from "./sprites.js";
import { setupKeyListener, choseDirection } from "./control.js";

const TICK_MS = 300;
const RESTART_BTN = { width: 120, height: 44, fontSize: 18 };
let sinceTick = 0;
let restartBtn = null;

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const dir = { val: "right" };
const game = { pacman: null, blinky: null, mode: "chase" };
let sprites, player, blinky;

function init() {
  sprites = generateSprites(ctx);
  player = sprites.find(s => s.kind === "pacman");
  blinky = sprites.find(s => s.kind === "ghost" && s.color === "red");
  game.pacman = player;
  game.blinky = blinky;
  game.mode = "chase";
  dir.val = "right";
  sinceTick = 0;
}

init();
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
      if (s.x === player.x && s.y === player.y) {
        game.mode = "over";
      }
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

  if (game.mode !== "over") {
    update(delta);
    draw();
  } else {
    ctx.fillStyle = "white";
    ctx.font = "bold 48px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Game Over", canvas.width / 2, canvas.height / 2);

    if (!restartBtn) {
      const b = document.createElement("button");
      b.textContent = "Restart";
      b.style.position = "absolute";
      b.style.left = `${canvas.offsetLeft + canvas.width / 2}px`;
      b.style.top = `${canvas.offsetTop + canvas.height / 2 + 30}px`;
      b.style.transform = "translateX(-50%)";
      b.style.width = `${RESTART_BTN.width}px`;
      b.style.height = `${RESTART_BTN.height}px`;
      b.style.fontSize = `${RESTART_BTN.fontSize}px`;
      b.addEventListener("click", () => {
        b.remove();
        restartBtn = null;
        init();
      });
      document.body.appendChild(b);
      restartBtn = b;
    }
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);