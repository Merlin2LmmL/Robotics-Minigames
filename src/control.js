import { MAP, isWall, isHouse } from "./map.js";
import { STEP } from "./main.js";

export function setupKeyListener(dir) {
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    switch (event.key) {
      case "w":
      case "W": dir.val = "up"; break;
      case "s":
      case "S": dir.val = "down"; break;
      case "a":
      case "A": dir.val = "left"; break;
      case "d":
      case "D": dir.val = "right"; break;
      default: return;
    }
    event.preventDefault();
  });
}

// ---------- Constants ----------

// Ticks (TICK_MS each) before a ghost leaves the house
export const RELEASE = { red: 0, pink: 5, cyan: 30, orange: 60 };

export const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };
const ORDER = ["up", "left", "down", "right"];   // tie-break priority of the original

// Corner each ghost heads for in scatter mode (classic 28x31 maze coordinates)
const SCATTER = {
  red: [25, -3],
  pink: [2, -3],
  cyan: [27, 31],
  orange: [0, 31],
};

// Tiles where active ghosts may not turn upwards in chase/scatter (classic maze coordinates, adjust to your map)
const NO_UP = [[12, 11], [15, 11], [12, 23], [15, 23]];

// Level-1 timings in ms. The last phase lasts forever.
const SCHEDULE = [
  { mode: "scatter", ms: 7000 },
  { mode: "chase", ms: 20000 },
  { mode: "scatter", ms: 7000 },
  { mode: "chase", ms: 20000 },
  { mode: "scatter", ms: 5000 },
  { mode: "chase", ms: 20000 },
  { mode: "scatter", ms: 5000 },
  { mode: "chase", ms: Infinity },
];
const FRIGHT_MS = 6000;

// ---------- Ghost house ----------

const isDoor = (x, y) => MAP[y]?.[x] === "-";

// Home = the tile below the door, in the middle of the house. Eaten ghosts head here.
let home = null;
function getHome() {
  if (home) return home;
  let doorX = -1, sumY = 0, n = 0;
  for (let y = 0; y < MAP.length; y++) {
    for (let x = 0; x < MAP[y].length; x++) {
      if (MAP[y][x] === "-") { if (doorX < 0) doorX = x; }
      else if (isHouse(x, y)) { sumY += y; n++; }
    }
  }
  home = { x: doorX, y: Math.round(sumY / n) };
  return home;
}

export const reachedHome = (s) =>
  s.state === "eaten" && s.x === getHome().x && s.y === getHome().y;

// ---------- Global ghost mode (scatter/chase schedule + frightened timer) ----------

export function resetGhostMode(game) {
  game.mode = SCHEDULE[0].mode;
  game.phaseIndex = 0;
  game.phaseMs = 0;
  game.frightenedMs = 0;
}

const reverseGhosts = (game) => {
  for (const g of game.sprites) if (g.kind === "ghost" && g.state === "active") g.reverse = true;
};

// Call once per frame with the (clamped) frame delta
export function updateGhostMode(game, delta) {
  if (game.mode === "over") return;

  if (game.frightenedMs > 0) {
    game.frightenedMs = Math.max(0, game.frightenedMs - delta);
    if (game.frightenedMs === 0) {
      for (const g of game.sprites) if (g.state === "frightened") g.state = "active";
    }
  }

  // The schedule is paused as long as any ghost is frightened
  if (game.sprites.some((g) => g.state === "frightened")) return;
  game.frightenedMs = 0;

  const phase = SCHEDULE[game.phaseIndex];
  if (phase.ms === Infinity) return;
  game.phaseMs += delta;
  if (game.phaseMs >= phase.ms) {
    game.phaseMs -= phase.ms;
    game.mode = SCHEDULE[++game.phaseIndex].mode;
    reverseGhosts(game);   // ghosts turn around whenever scatter <-> chase switches
  }
}

// Power pellet eaten
export function frightenGhosts(game) {
  for (const g of game.sprites) {
    if (g.kind === "ghost" && (g.state === "active" || g.state === "frightened")) {
      g.state = "frightened";
      g.reverse = true;
    }
  }
  game.frightenedMs = FRIGHT_MS;
}

// ---------- Targeting ----------

const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

function aheadOfPacman(p, n) {
  const [dx, dy] = STEP[p.dir] ?? [0, 0];
  let tx = p.x + dx * n;
  const ty = p.y + dy * n;
  if (p.dir === "up") tx -= n;   // overflow bug of the original
  return [tx, ty];
}

function chaseTarget(color, x, y, game) {
  const { pacman: p } = game;
  switch (color) {
    case "red":
      return [p.x, p.y];
    case "pink":
      return aheadOfPacman(p, 4);
    case "cyan": {
      const blinky = game.sprites.find((s) => s.color === "red") ?? p;
      const [ax, ay] = aheadOfPacman(p, 2);
      return [2 * ax - blinky.x, 2 * ay - blinky.y];
    }
    case "orange":
      return dist2(x, y, p.x, p.y) > 64 ? [p.x, p.y] : SCATTER.orange;
    default:
      return [p.x, p.y];
  }
}

// ---------- Direction choice ----------

export function possibleDirections(x, y, canUseDoor = false) {
  const free = (tx, ty) => !isWall(tx, ty) || (canUseDoor && isDoor(tx, ty));
  const dirs = [];
  if (free(x, y - 1)) dirs.push("up");
  if (free(x, y + 1)) dirs.push("down");
  if (free(x - 1, y)) dirs.push("left");
  if (free(x + 1, y)) dirs.push("right");
  return dirs;
}

export function choseDirection(s, x, y, game) {
  if (s.kind !== "ghost") return;

  const eaten = s.state === "eaten";
  let options = possibleDirections(x, y, eaten);

  // Only eaten ghosts may enter the house
  if (!eaten) options = options.filter((d) => !isHouse(x + STEP[d][0], y + STEP[d][1]));

  // Forced reversal (mode switch or pellet) overrides everything else
  if (s.reverse) {
    s.reverse = false;
    const back = OPPOSITE[s.dir];
    if (back && options.includes(back)) return back;
  }

  // No U-turn except when there is no other option
  if (options.length > 1) options = options.filter((d) => d !== OPPOSITE[s.dir]);

  if (s.state === "frightened") {
    return options[Math.floor(Math.random() * options.length)];
  }

  if (!eaten && NO_UP.some(([nx, ny]) => nx === x && ny === y) && options.length > 1) {
    options = options.filter((d) => d !== "up");
  }

  let target;
  if (eaten) target = [getHome().x, getHome().y];
  else if (game.mode === "scatter") target = SCATTER[s.color];
  else target = chaseTarget(s.color, x, y, game);
  const [tx, ty] = target;

  let best = null;
  let bestD = Infinity;
  for (const d of ORDER) {
    if (!options.includes(d)) continue;
    const dd = dist2(x + STEP[d][0], y + STEP[d][1], tx, ty);
    if (dd < bestD) {   // choose the direction that minimizes the distance to the target
      best = d;
      bestD = dd;
    }
  }
  return best;
}