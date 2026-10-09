import { isWall, isHouse } from "./map.js";
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

// Rectangle covering the ghost house INCLUDING the door tile. Adjust to your map.
export const RELEASE = { red: 0, pink: 5, cyan: 30, orange: 60 };

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
  const { pacman: p } = game;
  switch (color) {
    case "red":
      return [p.x, p.y];
    case "pink":
      return aheadOfPacman(p, 4);
    case "cyan": {
      const blinky = game.sprites.find((s) => s.color === "red");
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
  // Active ghosts may never step back into the house
  options = options.filter((d) => !isHouse(x + STEP[d][0], y + STEP[d][1]));
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

export function possibleDirections(x, y) {
  const dirs = [];
  if (!isWall(x, y - 1)) dirs.push("up");
  if (!isWall(x, y + 1)) dirs.push("down");
  if (!isWall(x - 1, y)) dirs.push("left");
  if (!isWall(x + 1, y)) dirs.push("right");
  return dirs;
}