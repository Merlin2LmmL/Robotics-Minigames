import { isPortal, getPortalExit, GRIDSIZE, MAP, isWall } from "./map.js";
import { generateSprites, createSprite } from "./sprites.js";
import {
  setupKeyListener, choseDirection, RELEASE,
  resetGhostMode, updateGhostMode, frightenGhosts, reachedHome,
} from "./control.js";

export const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const TICK_MS = 300;        // time a sprite needs per tile at speed 1
const MAX_FRAME_MS = 100;   // clamp so a background tab doesn't cause a burst of moves
const RESTART_BTN = { width: 240, height: 90, fontSize: 40 };
const START_LIVES = 3;      // set to 1 for "game over on the first hit"
const DEATH_PAUSE_MS = 1200;

// tiles per TICK_MS, keyed by ghost state
const GHOST_SPEED = { house: 0.5, active: 1, frightened: 0.5, eaten: 2.5 };

// Bonus fruit
const FRUIT = {
  cherry: { points: 100, color: "red" },
  orange: { points: 500, color: "orange" },
  apple: { points: 700, color: "#ff3030" },
};
const FRUIT_ORDER = ["cherry", "orange", "apple"];   // kind of the 1st, 2nd, ... spawn
let FRUIT_TILE;                                      // tile where the fruit appears
const FRUIT_AT_DOTS = [70, 170];                     // dots eaten when a fruit appears
const FRUIT_MS = 9500;                               // how long a fruit stays

const CONSUMABLE_KINDS = new Set(["dot", "pellet", ...Object.keys(FRUIT)]);
const isFruit = (o) => o.kind in FRUIT;

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const dir = { val: "right" };
const game = { pacman: null, sprites: null, mode: "scatter", result: null };
let sprites, player;
let exit;
let elapsed = 0;
let tickCount = 0;
let last = 0;

let score = 0;
let lives = START_LIVES;
let ghostCombo = 0;         // ghosts eaten since the last pellet (200/400/800/1600)
let dotsEaten = 0;
let fruitsSpawned = 0;
let pauseMs = 0;            // > 0 while the scene is frozen after losing a life

// ---------- Setup ----------

function findDoor() {
  for (let y = 0; y < MAP.length; y++) {
    const x = MAP[y].indexOf("-");
    if (x !== -1) return [x, y - 1];   // the tile above the door is the exit
  }
  throw new Error('No door ("-") found in MAP');
}

function getFruitTile() {
  for (let y = 0; y < MAP.length; y++) {
    const x = MAP[y].indexOf("F");
    if (x !== -1) return [x, y];
  }
  throw new Error('No fruit tile ("F") found in MAP');
}

const isDoor = (x, y) => MAP[y]?.[x] === "-";

function init() {
  FRUIT_TILE = getFruitTile();
  exit = findDoor();
  sprites = generateSprites(ctx);
  game.sprites = sprites;
  player = sprites.find((s) => s.kind === "pacman");
  game.pacman = player;
  game.result = null;

  for (const s of sprites) {
    s.prevX = s.x;
    s.prevY = s.y;
    s.clock = 0;
    if (s.kind === "pacman" || s.kind === "ghost") {
      s.startX = s.x;
      s.startY = s.y;
      s.startDir = s.dir;
    }
    if (s.kind === "ghost") s.state = s.color === "red" ? "active" : "house";
  }

  dir.val = "right";
  elapsed = 0;
  tickCount = 0;
  score = 0;
  lives = START_LIVES;
  ghostCombo = 0;
  dotsEaten = 0;
  fruitsSpawned = 0;
  pauseMs = 0;
  resetGhostMode(game);     // sets game.mode to the first scatter phase
}

// After losing a life: everybody back to the start, dots and pellets stay as they are
function resetRound() {
  removeFruit();
  for (const s of sprites) {
    if (s.kind !== "pacman" && s.kind !== "ghost") continue;
    s.x = s.prevX = s.startX;
    s.y = s.prevY = s.startY;
    s.dir = s.startDir;
    s.clock = 0;
    if (s.kind === "ghost") s.state = s.color === "red" ? "active" : "house";
  }
  dir.val = "right";
  elapsed = 0;
  tickCount = 0;
  ghostCombo = 0;
  pauseMs = 0;
  resetGhostMode(game);
}

function endGame(result) {
  game.mode = "over";
  game.result = result;
}

function loseLife() {
  lives--;
  if (lives <= 0) endGame("lost");
  else pauseMs = DEATH_PAUSE_MS;   // freeze the scene, update() calls resetRound() afterwards
}

// ---------- Fruit ----------

function removeFruit() {
  for (let i = sprites.length - 1; i >= 0; i--) {
    if (isFruit(sprites[i])) sprites.splice(i, 1);
  }
}

function spawnFruit() {
  removeFruit();
  const kind = FRUIT_ORDER[fruitsSpawned % FRUIT_ORDER.length];
  const fruit = createSprite(FRUIT_TILE[0], FRUIT_TILE[1], kind, FRUIT[kind].color, true);
  fruit.life = FRUIT_MS;
  sprites.push(fruit);
  fruitsSpawned++;
}

function updateFruit(delta) {
  for (const f of sprites.filter(isFruit)) {
    f.life -= delta;
    if (f.life <= 0) sprites.splice(sprites.indexOf(f), 1);
  }
}

function countDot() {
  dotsEaten++;
  if (fruitsSpawned < FRUIT_AT_DOTS.length && dotsEaten >= FRUIT_AT_DOTS[fruitsSpawned]) {
    spawnFruit();
  }
}

// ---------- Game logic ----------

function speedOf(s) {
  if (s.kind === "ghost") return GHOST_SPEED[s.state] ?? 1;
  return s.speed ?? 1;
}

function canMove(s, d) {
  const [dx, dy] = STEP[d] ?? [0, 0];
  const nx = s.x + dx, ny = s.y + dy;
  // eaten ghosts may pass through the door to get back into the house
  if (s.kind === "ghost" && s.state === "eaten" && isDoor(nx, ny)) return true;
  return !isWall(nx, ny);
}

// Walk a waiting ghost out of the house once its release time is reached
function leaveHouse(s) {
  if (tickCount < RELEASE[s.color]) return;
  if (s.x !== exit[0]) s.x += Math.sign(exit[0] - s.x);       // 1. align with the door column
  else if (s.y !== exit[1]) s.y += Math.sign(exit[1] - s.y);  // 2. walk up through the door
  else { s.state = "active"; s.dir = "left"; }                // 3. hand over to normal AI
}

// Returns the consumable on the same tile as sprite s, or undefined if there is none
const findTouchedConsumable = (s) =>
  sprites.find((o) => o !== s && CONSUMABLE_KINDS.has(o.kind) && o.x === s.x && o.y === s.y);

const touchesPlayer = (s) => s.kind === "ghost" && s.x === player.x && s.y === player.y;

// Jump a sprite to the matching portal tile
function teleport(s) {
  const out = getPortalExit(s.x, s.y);
  if (!out) return;
  s.x = s.prevX = out.x;
  s.y = s.prevY = out.y;
}

function eatConsumable(item) {
  sprites.splice(sprites.indexOf(item), 1);

  switch (item.kind) {
    case "dot":
      score += 10;
      countDot();
      break;
    case "pellet":
      score += 50;
      ghostCombo = 0;
      frightenGhosts(game);
      countDot();
      break;
    default:   // fruit
      score += FRUIT[item.kind]?.points ?? 0;
  }

  // all dots and pellets gone: the player has won
  if (!sprites.some((o) => o.kind === "dot" || o.kind === "pellet")) endGame("won");
}

// Active ghost on the player's tile kills, frightened ghost gets eaten, others are harmless
function resolveGhostContact() {
  for (const g of sprites) {
    if (!touchesPlayer(g)) continue;
    if (g.state === "frightened") {
      g.state = "eaten";
      score += 200 * 2 ** Math.min(ghostCombo++, 3);
    } else if (g.state === "active") {
      loseLife();
      return;
    }
  }
}

// One tile of movement for a single sprite
function step(s) {
  s.prevX = s.x;
  s.prevY = s.y;

  if (s.kind === "ghost" && s.state === "house") {
    leaveHouse(s);
    return;
  }

  if (s === player) {
    // Pac-Man has visually arrived on his tile only now (the drawing lags one step behind
    // the logic), so this is the moment he eats what is on it
    const item = findTouchedConsumable(s);
    if (item) eatConsumable(item);
    if (game.mode === "over") return;
    if (canMove(s, dir.val)) s.dir = dir.val;
  }

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

  // An eaten ghost that arrived at the center of the house is revived and walks out again
  if (reachedHome(s)) s.state = "house";

  if (s === player || s.kind === "ghost") resolveGhostContact();
}

function update(delta) {
  delta = Math.min(delta, MAX_FRAME_MS);

  // Frozen after losing a life, then everybody goes back to the start
  if (pauseMs > 0) {
    pauseMs -= delta;
    if (pauseMs <= 0) resetRound();
    return;
  }

  elapsed += delta;
  tickCount = Math.floor(elapsed / TICK_MS);

  updateGhostMode(game, delta);   // scatter/chase schedule and the frightened timer
  updateFruit(delta);

  for (const s of [...sprites]) { // copy: step() may add or remove consumables
    if (s.isStatic) continue;
    if (pauseMs > 0 || game.mode === "over") break;
    s.clock += delta * speedOf(s);
    while (s.clock >= TICK_MS && game.mode !== "over" && pauseMs <= 0) {
      s.clock -= TICK_MS;
      step(s);
    }
  }
}

// ---------- Drawing ----------

function drawSprite(s) {
  const t = s.isStatic
    ? (elapsed % TICK_MS) / TICK_MS
    : Math.min(s.clock / TICK_MS, 1);
  const px = (s.prevX + (s.x - s.prevX) * t) * GRIDSIZE + GRIDSIZE / 2;
  const py = (s.prevY + (s.y - s.prevY) * t) * GRIDSIZE + GRIDSIZE / 2;
  const full = s.kind === "wall" || s.kind === "door";
  const big = s.kind === "ghost" || s.kind === "pacman" ? 1.5 : 1;
  const r = (full ? GRIDSIZE / 2 : GRIDSIZE / 2 - 2) * (s.scale || big);
  ctx.fillStyle = s.color;
  s.shape(ctx, px, py, r, s, t);
}

function drawHud() {
  ctx.save();
  ctx.font = "bold 20px sans-serif";
  ctx.textBaseline = "top";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "black";
  ctx.fillStyle = "white";
  ctx.textAlign = "left";
  ctx.strokeText(`Score: ${score}`, 8, 6);
  ctx.fillText(`Score: ${score}`, 8, 6);
  ctx.textAlign = "right";
  ctx.strokeText(`Lives: ${lives}`, canvas.width - 8, 6);
  ctx.fillText(`Lives: ${lives}`, canvas.width - 8, 6);
  ctx.restore();
}

function draw() {
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const s of sprites) drawSprite(s);
  drawHud();
}

function restartRect() {
  const { width: w, height: h } = RESTART_BTN;
  return { x: canvas.width / 2 - w / 2, y: canvas.height / 2 + 40, w, h };
}

function drawGameOver() {
  ctx.textAlign = "center";

  const won = game.result === "won";
  ctx.fillStyle = won ? "gold" : "red";
  ctx.font = "bold 128px sans-serif";
  ctx.fillText(won ? "You Win!" : "Game Over", canvas.width / 2, canvas.height / 2);

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
    // let the last step finish animating
    for (const s of sprites) {
      if (!s.isStatic) s.clock = Math.min(s.clock + delta * speedOf(s), TICK_MS);
    }
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

// ---------- Initialization ----------

init();
requestAnimationFrame(frame);