import { robot, updateRobot, drawRobot } from "./robot.js";
import { maps } from "./map/map.js";

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

let scrollX = 0;
let scrollY = 0;

const dirState = { dir: "none" };

// the map is picked from the UI through document.body.dataset.map
let map = null;
let mapKey = null;

function loadMap(key) {
  mapKey = key;
  map = maps[key];

  // put the robot at the map's start and stop it
  robot.x = map.start.x;
  robot.y = map.start.y;
  robot.angle = map.start.angle ?? 0;
  robot.speed = 0;
  robot.turnSpeed = 0;
  robot.vx = 0;
  robot.vy = 0;
}

function initialize() {
  loadMap(document.body.dataset.map || "maze");

  // Start the update loop
  requestAnimationFrame(update);
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

// Fires on window resize, fullscreen enter/exit, and layout changes
new ResizeObserver(resizeCanvas).observe(canvas);
resizeCanvas();

let last = performance.now();

function update(timestamp) {
  const dt = Math.min((timestamp - last) / 1000, 0.05);
  last = timestamp;

  const key = document.body.dataset.map || "maze";
  if (key !== mapKey) loadMap(key);

  updateRobot(robot, dt, keys, map.obstacles);

  const { width: WORLD_W, height: WORLD_H } = map.worldSize;
  const zoom = parseFloat(document.body.dataset.zoom) || 1;
  const s = Math.min(canvas.width / WORLD_W, canvas.height / WORLD_H) * zoom;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#f0f0f0";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (document.body.dataset.view === "robot") {
    // robot stays centered and points up; the world rotates around it
    ctx.setTransform(s, 0, 0, s, canvas.width / 2, canvas.height / 2);
    ctx.rotate(-Math.PI / 2 - robot.angle);
    ctx.translate(-robot.x, -robot.y);
  } else {
    // camera follows the robot but stays inside the world; when the whole
    // world fits on screen (zoom <= 1) it is simply centered
    const hx = canvas.width / (2 * s), hy = canvas.height / (2 * s);
    const cx = hx * 2 >= WORLD_W ? WORLD_W / 2 : Math.min(Math.max(robot.x, hx), WORLD_W - hx);
    const cy = hy * 2 >= WORLD_H ? WORLD_H / 2 : Math.min(Math.max(robot.y, hy), WORLD_H - hy);
    ctx.setTransform(s, 0, 0, s, canvas.width / 2 - cx * s, canvas.height / 2 - cy * s);
  }
  drawRobot(ctx, robot, scrollX, scrollY);
  if (document.body.dataset.lidar === "off") {
    map.obstacles.forEach(obstacle => obstacle.draw(ctx, scrollX, scrollY));
    // cosmetic outline: drawn but not in map.obstacles, so it never collides
    (map.outline ?? []).forEach(o => o.draw(ctx, scrollX, scrollY));
  }

  requestAnimationFrame(update);
}

const keys = { up: false, down: false, left: false, right: false };
const keyBindings = {
  KeyW: "up", KeyS: "down", KeyA: "left", KeyD: "right",
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
};
addEventListener("keydown", e => {
  if (keyBindings[e.code]) {
    keys[keyBindings[e.code]] = true;
    e.preventDefault();
  }
});
addEventListener("keyup", e => {
  if (keyBindings[e.code]) keys[keyBindings[e.code]] = false;
});

initialize();