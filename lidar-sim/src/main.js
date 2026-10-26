import { robot, updateRobot, drawRobot, setRobotScale } from "./robot.js";
import { deadReckoning } from "./deadReckoning.js";
import { kalman } from "./kalman.js";
import { slam } from "./slam/slam.js";
import { mapping } from "./slam/occupancyGrid.js";
import { buildMap, paramsFromQuery } from "./map/map.js";
import { sandbox, DEFAULT_SCALE } from "./map/sandbox.js";
import { editor } from "./editor.js";

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

let scrollX = 0;
let scrollY = 0;

// the map is picked from the UI through document.body.dataset.map
let map = null;
let mapKey = null;
let mapSeed = null;
let mapEditing = false;

// put the robot at the map's start and stop it
function placeRobot(start) {
  robot.x = start.x;
  robot.y = start.y;
  robot.angle = start.angle ?? 0;
  robot.speed = 0;
  robot.turnSpeed = 0;
  robot.vx = 0;
  robot.vy = 0;
  robot.bodyAccel = { x: 0, y: 0 };
}

function loadMap(key) {
  mapKey = key;
  mapSeed = document.body.dataset.seed;
  map = buildMap(key, { ...paramsFromQuery(location.search), seed: parseInt(mapSeed, 10) || 1 });
  editor.currentMap = map;
  editor.currentMapId = key;
  setRobotScale(robot, map.scale ?? DEFAULT_SCALE);
  placeRobot(map.start);
  // a fresh start powers the sensors up again with new biases
  for (const s of robot.sensors) s.reset?.();
  deadReckoning.reset(map.start);
  kalman.reset(map.start, robot.scale);
  slam.reset(map.start, robot.scale);
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
  const editing = editor.active;
  if (editing) {
    // the design is shown frozen, with the robot parked at its start and the lidar still scanning
    map = sandbox.design;
    setRobotScale(robot, map.scale ?? DEFAULT_SCALE);
    placeRobot(map.start);
    deadReckoning.reset(map.start);
    kalman.reset(map.start, robot.scale);
    for (const s of robot.sensors) s.scan?.(robot, map.obstacles);
  } else {
    if (mapEditing || key !== mapKey || (key === "warehouse" && document.body.dataset.seed !== mapSeed)) loadMap(key);

    // self-moving obstacles first, then the robot
    const world = { obstacles: map.obstacles, robot };
    for (const o of map.obstacles) o.update(dt, world);
    updateRobot(robot, dt, keys, map.obstacles);
    deadReckoning.step(robot, dt);
    kalman.step(robot, dt, map.obstacles);
    slam.step(robot, dt);
    mapping.update(slam);
  }
  mapEditing = editing;

  const { width: WORLD_W, height: WORLD_H } = map.worldSize;
  const zoom = parseFloat(document.body.dataset.zoom) || 1;
  const s = Math.min(canvas.width / WORLD_W, canvas.height / WORLD_H) * zoom;

  const showEnvironment = editing || document.body.dataset.environment === "on";
  const showSlam = !editing && document.body.dataset.slam === "on";

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // with only the SLAM map to look at, a darker background makes the mapped floor stand out
  ctx.fillStyle = showSlam && mapping.layers.map && !showEnvironment ? "#c8c8c8" : "#f0f0f0";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (editing) {
    // editing always uses the world view, panned freely by the editor
    const cx = WORLD_W / 2 + editor.pan.x, cy = WORLD_H / 2 + editor.pan.y;
    ctx.setTransform(s, 0, 0, s, canvas.width / 2 - cx * s, canvas.height / 2 - cy * s);
  } else if (document.body.dataset.view === "robot") {
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
  editor.view = ctx.getTransform();
  // the SLAM map goes underneath everything, so the real walls cover it where it got them right
  if (showSlam) mapping.draw(ctx, slam.scale);
  if (showEnvironment) {
    // cosmetic floor markings: under the robot, never collided with
    (map.floor ?? []).forEach(o => o.draw(ctx, scrollX, scrollY));
  }
  drawRobot(ctx, robot, scrollX, scrollY);
  if (showEnvironment) {
    map.obstacles.forEach(obstacle => obstacle.draw(ctx, scrollX, scrollY));
    // cosmetic outline: drawn but not in map.obstacles, so it never collides
    (map.outline ?? []).forEach(o => o.draw(ctx, scrollX, scrollY));
  }
  if (!editing && document.body.dataset.deadReckoning === "on") deadReckoning.draw(ctx, robot);
  if (!editing && document.body.dataset.kalman === "on") kalman.draw(ctx, robot);
  if (showSlam) slam.draw(ctx, robot, mapping.layers);
  if (editing) editor.draw(ctx);

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