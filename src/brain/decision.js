// brain/decision.js
//
// The page keeps them in PacState.rules (top = most important) and PacState.fallback.
// A rule looks like: { sensor: "ghostDist", kind: "number", op: "lt", value: 0.25, action: "awayGhost" }
//
// decide() runs once per tile and must return "up" | "down" | "left" | "right"
// (or null = keep going the way he is facing).
import { MAP, isWall } from "../map.js";

const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

// The page's number sensors go from 0 to 1. A distance of MAX_DIST tiles (or more) counts as 1.
// Smaller number = the sensors "see" less far. Tune this to taste.
const MAX_DIST = 20;

// Set to true to see in the browser console (F12) which rule fired
const DEBUG = false;

// ---------- Path finding ----------
// Breadth-first search: walks outward from a tile, one step at a time, around walls.
// Returns a Map  "x,y" -> { dist, first }
//   dist  = how many steps it takes to get there
//   first = which direction to take FIRST to get there (this is what we steer with)
// Ghosts and food behind walls are measured by real walking distance, not by "as the crow flies".

const inside = (x, y) => y >= 0 && y < MAP.length && x >= 0 && x < MAP[y].length;

function bfs(startX, startY, firstDirs) {
  const found = new Map();
  found.set(`${startX},${startY}`, { dist: 0, first: null });
  const queue = [];

  // first step: only the allowed directions
  for (const d of firstDirs) {
    const x = startX + STEP[d][0];
    const y = startY + STEP[d][1];
    if (!inside(x, y) || isWall(x, y) || found.has(`${x},${y}`)) continue;
    found.set(`${x},${y}`, { dist: 1, first: d });
    queue.push([x, y]);
  }

  // then spread out
  while (queue.length > 0) {
    const [x, y] = queue.shift();
    const here = found.get(`${x},${y}`);
    for (const [dx, dy] of Object.values(STEP)) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inside(nx, ny) || isWall(nx, ny) || found.has(`${nx},${ny}`)) continue;
      found.set(`${nx},${ny}`, { dist: here.dist + 1, first: here.first });
      queue.push([nx, ny]);
    }
  }
  return found;
}

// The closest target (a list of sprites) according to a bfs result, or null
function nearest(targets, reach) {
  let best = null;
  for (const t of targets) {
    const r = reach.get(`${t.x},${t.y}`);
    if (r && r.dist > 0 && (best === null || r.dist < best.dist)) best = r;
  }
  return best;
}

// ---------- Sensors ----------
// Everything the page's "If ..." dropdown can ask about.

// Is there an active ghost somewhere on the open line in front of Pac-Man?
function ghostInLine(player, ghosts) {
  const [dx, dy] = STEP[player.dir] ?? [0, 0];
  if (dx === 0 && dy === 0) return false;
  let x = player.x + dx;
  let y = player.y + dy;
  while (inside(x, y) && !isWall(x, y)) {
    if (ghosts.some((g) => g.x === x && g.y === y)) return true;
    x += dx;
    y += dy;
  }
  return false;
}

function readSensors(ctx) {
  const { player, legal, reach, danger, scared, dots, pellets } = ctx;
  // distance 0..1, and 1 if there is nothing of that kind (= "far away")
  const norm = (r) => (r ? Math.min(r.dist / MAX_DIST, 1) : 1);

  return {
    ghostDist: norm(nearest(danger, reach)),
    pelletDist: norm(nearest(dots, reach)),
    powerDist: norm(nearest(pellets, reach)),
    ghostScared: scared.length > 0,
    wallAhead: !legal.includes(player.dir),
    ghostAhead: ghostInLine(player, danger),
  };
}

// Does a single rule's "If ..." part hold?
function holds(rule, sensors) {
  const value = sensors[rule.sensor];
  if (rule.kind === "bool") return String(value) === rule.op;   // op is "true" or "false"
  if (rule.op === "lt") return value < rule.value;
  if (rule.op === "gt") return value > rule.value;
  return false;
}

// ---------- Actions ----------
// Everything the page's "then ..." dropdown can say. Each returns a direction,
// or null if it can't be done right now (e.g. "chase scared ghost" with no scared ghost).
// A null means "this rule doesn't apply after all", so the next rule gets its turn.

function randomDirection(player, legal) {
  const forward = legal.filter((d) => d !== OPPOSITE[player.dir]);   // avoid turning around
  const options = forward.length > 0 ? forward : legal;
  return options[Math.floor(Math.random() * options.length)] ?? null;
}

function directionFor(action, ctx) {
  const { player, legal, reach, danger, scared, dots, pellets } = ctx;

  switch (action) {
    case "toPellet":
      return nearest(dots, reach)?.first ?? null;

    case "toPower":
      return nearest(pellets, reach)?.first ?? null;

    case "toGhost":
      return nearest(scared, reach)?.first ?? null;

    case "awayGhost": {
      if (danger.length === 0) return null;
      // For every ghost: how far is each tile from it? Then pick the legal step
      // that ends up as far as possible from the closest ghost.
      const ghostMaps = danger.map((g) => bfs(g.x, g.y, Object.keys(STEP)));
      let bestDir = null;
      let bestScore = -1;
      for (const d of legal) {
        const x = player.x + STEP[d][0];
        const y = player.y + STEP[d][1];
        let score = Infinity;   // distance to the closest ghost from that tile
        for (const map of ghostMaps) {
          const r = map.get(`${x},${y}`);
          score = Math.min(score, r ? r.dist : Infinity);
        }
        if (score > bestScore) {
          bestScore = score;
          bestDir = d;
        }
      }
      return bestDir;
    }

    case "straight":
      return legal.includes(player.dir) ? player.dir : randomDirection(player, legal);

    case "random":
      return randomDirection(player, legal);

    default:
      return null;
  }
}

// ---------- The decision ----------

export function decide({ game, player, sprites, legal }) {
  if (legal.length === 0) return null;

  const ctx = {
    player,
    legal,
    reach: bfs(player.x, player.y, legal),
    danger: sprites.filter((s) => s.kind === "ghost" && s.state === "active"),
    scared: sprites.filter((s) => s.kind === "ghost" && s.state === "frightened"),
    dots: sprites.filter((s) => s.kind === "dot"),
    pellets: sprites.filter((s) => s.kind === "pellet"),
  };
  const sensors = readSensors(ctx);

  // Rules from top to bottom: the first one that is true AND can be carried out wins
  for (const rule of PacState.rules) {
    if (!holds(rule, sensors)) continue;
    const direction = directionFor(rule.action, ctx);
    if (direction) {
      if (DEBUG) console.log("rule fired:", rule, "->", direction, sensors);
      return direction;
    }
  }

  // No rule matched: "Otherwise ..."
  const direction = directionFor(PacState.fallback, ctx) ?? randomDirection(player, legal);
  if (DEBUG) console.log("fallback ->", direction, sensors);
  return direction;
}