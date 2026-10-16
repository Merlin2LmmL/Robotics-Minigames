import { robot, updateRobot, drawRobot } from "./robot.js";
import { map } from "./map/map.js";

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const WORLD_W = 960;
const WORLD_H = 1080;

let scrollX = 0;
let scrollY = 0;

const dirState = { dir: "none" };

function initialize() {
  // Initialize the robot's position and orientation
  robot.x = WORLD_W / 2;
  robot.y = WORLD_H / 2;
  robot.angle = 0;

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

  updateRobot(robot, dt, keys, map.obstacles);

  const scale = Math.min(canvas.width / WORLD_W, canvas.height / WORLD_H);
  const offsetX = (canvas.width - WORLD_W * scale) / 2;
  const offsetY = (canvas.height - WORLD_H * scale) / 2;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#f0f0f0";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
  if (document.body.dataset.view === "robot") {
    // robot stays centered and points up; the world rotates around it
    ctx.setTransform(scale, 0, 0, scale, canvas.width / 2, canvas.height / 2);
    ctx.rotate(-Math.PI / 2 - robot.angle);
    ctx.translate(-robot.x, -robot.y);
  }
  drawRobot(ctx, robot, scrollX, scrollY);
  if (document.body.dataset.lidar === "off") {
    map.obstacles.forEach(obstacle => obstacle.draw(ctx, scrollX, scrollY));
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