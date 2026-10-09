import { shapes } from "./shapes.js";
import { createSprite } from "./sprites.js";

export const GRIDSIZE = 50;
export const PORTALLETTERS = ["A", "B", "C", "D"];
export const MAP = [
    "############################",
    "#............##............#",
    "#.####.#####.##.#####.####.#",
    "#o####.#####.##.#####.####o#",
    "#.####.#####.##.#####.####.#",
    "#..........................#",
    "#.####.##.########.##.####.#",
    "#.####.##.########.##.####.#",
    "#......##....##....##......#",
    "######.##### ## #####.######",
    "     #.##### ## #####.#     ",
    "     #.##          ##.#     ",
    "     #.## ###--### ##.#     ",
    "######.## #HHHHHH# ##.######",
    "A     .   #HHHHHH#   .     A",
    "######.## #HHHHHH# ##.######",
    "     #.## ######## ##.#     ",
    "     #.##          ##.#     ",
    "     #.## ######## ##.#     ",
    "######.## ######## ##.######",
    "#............##............#",
    "#.####.#####.##.#####.####.#",
    "#.####.#####.##.#####.####.#",
    "#o..##................##..o#",
    "###.##.##.########.##.##.###",
    "###.##.##.########.##.##.###",
    "#......##....##....##......#",
    "#.##########.##.##########.#",
    "#.##########.##.##########.#",
    "#..........................#",
    "############################"
]

export const isWall = (x, y) => {
    if (y < 0 || y >= MAP.length) return true;
    if (x < 0 || x >= MAP[y].length) return true;
    return MAP[y][x] === "#" || MAP[y][x] === "-";
}

export const isHouse = (x, y) => MAP[y]?.[x] === "H" || MAP[y]?.[x] === "-";

export const isPortal = (x, y) => PORTALLETTERS.includes(MAP[y]?.[x]);

export const PORTALS = (() => {
  const found = {};
  for (let y = 0; y < MAP.length; y++) {
    for (let x = 0; x < MAP[y].length; x++) {
      const c = MAP[y][x];
      if (PORTALLETTERS.includes(c)) {
        (found[c] ??= []).push({ x, y });
      }
    }
  }
  return found;
})();

// Returns the exit tile for a portal at (x, y), or null
export const getPortalExit = (x, y) => {
  const letter = MAP[y]?.[x];
  const pair = PORTALS[letter];
  if (!pair || pair.length !== 2) return null;
  const [a, b] = pair;
  return (a.x === x && a.y === y) ? b : a;
};