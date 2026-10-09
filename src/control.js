import {isWall} from "./map.js";
import {STEP} from "./main.js";

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

const ORDER = ["up", "left", "down", "right"];
const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };
const SCATTER = {
  red: [25, -3],
  pink: [2, -3],
  cyan: [27, 31],
  orange: [0, 31],
};

const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

function aheadOfPacman(p, n) {
  const [dx, dy] = STEP[p.dir];
  let tx = p.x + dx * n;
  const ty = p.y + dy * n;
  if (p.dir === "up") tx -= n; // Overflow-Bug
  return [tx, ty];
}

function chaseTarget(color, x, y, game) {
  const { pacman: p, blinky } = game;
  switch (color) {
    case "red":
      return [p.x, p.y];
    case "pink":
      return aheadOfPacman(p, 4);
    case "cyan": {
      const [ax, ay] = aheadOfPacman(p, 2);
      return [2 * ax - blinky.x, 2 * ay - blinky.y];
    }
    case "orange":
      return dist2(x, y, p.x, p.y) > 64 ? [p.x, p.y] : SCATTER.orange;
  }
}

export function choseDirection(s, x, y, game) {
  if (s.kind !== "ghost") return;

  let options = possibleDirections(x, y);
  // No U-turn except when there is no other option
  if (options.length > 1) options = options.filter((d) => d !== OPPOSITE[s.dir]);

  if (game.mode === "frightened") {
    return options[Math.floor(Math.random() * options.length)];
  }

  const [tx, ty] =
    game.mode === "scatter" ? SCATTER[s.color] : chaseTarget(s.color, x, y, game);

  let best = null;
  let bestD = Infinity;
  for (const d of ORDER) {
    if (!options.includes(d)) continue;
    const dd = dist2(x + STEP[d][0], y + STEP[d][1], tx, ty);
    if (dd < bestD) { // Choose the direction that minimizes the distance to the target
      best = d;
      bestD = dd;
    }
  }
  return best;
}

function possibleDirections(x, y) {
  const dirs = [];
  if (!isWall(x, y - 1)) dirs.push("up");
  if (!isWall(x, y + 1)) dirs.push("down");
  if (!isWall(x - 1, y)) dirs.push("left");
  if (!isWall(x + 1, y)) dirs.push("right");
  return dirs;
}

// BFS to find the shortest path from start to target on the grid, avoiding walls
function gridDistance(start, target, width, height) {
  const [sx, sy] = start;
  const [tx, ty] = target;

  if (isWall(sx, sy) || isWall(tx, ty)) return -1;
  if (sx === tx && sy === ty) return 0;

  const dist = new Int32Array(width * height).fill(-1);
  const idx = (x, y) => y * width + x;

  const queue = [[sx, sy]];
  dist[idx(sx, sy)] = 0;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (let head = 0; head < queue.length; head++) {
    const [x, y] = queue[head];
    const d = dist[idx(x, y)];

    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (dist[idx(nx, ny)] !== -1 || isWall(nx, ny)) continue;

      if (nx === tx && ny === ty) return d + 1;

      dist[idx(nx, ny)] = d + 1;
      queue.push([nx, ny]);
    }
  }
  return -1;
}