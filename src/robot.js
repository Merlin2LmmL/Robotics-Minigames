import { lidarSensor } from "./sensors/lidar.js";
import { imuSensor, odometrySensor } from "./sensors/imu.js";

// Physical size and limits in meters and seconds. setRobotScale turns them into the
// world px values the simulation uses, so the robot is the same real size on every map.
export const ROBOT_SPEC = {
  length: 1.0,     // m, along the heading
  width: 0.5,      // m
  maxSpeed: 5,     // m/s forward
  maxReverse: 2,   // m/s backward
  accel: 6.25,     // m/s^2 when speeding up
  brake: 12.5,     // m/s^2 when released or opposed
};

export const robot = {
  x: 480, y: 540, angle: 0,
  speed: 0, turnSpeed: 0,
  scale: 0,          // world px per meter, set by setRobotScale
  maxTurnSpeed: 2.5, // rad/s
  turnAccel: 8,      // rad/s^2
  turnBrake: 16,     // rad/s^2
  sensors: [
    lidarSensor({ rayCount: 36, fov: Math.PI * 2, range: 6.25 }),
    imuSensor(),
    odometrySensor(),
  ],
  // googly pupils: offset from the eye centre (robot frame) and their velocity,
  // each with its own spring so the two eyes don't move in lockstep
  eyes: [
    { x: 0, y: 0, vx: 0, vy: 0, k: 110 },
    { x: 0, y: 0, vx: 0, vy: 0, k: 135 },
  ],
  vx: 0, vy: 0, // measured world velocity, px/s
  bodyAccel: { x: 0, y: 0 }, // true acceleration in the robot frame (x forward, y right), m/s^2
};

export function setRobotScale(robot, scale) {
  if (robot.scale === scale) return;
  robot.scale = scale;
  robot.width = ROBOT_SPEC.length * scale;
  robot.height = ROBOT_SPEC.width * scale;
  robot.maxSpeed = ROBOT_SPEC.maxSpeed * scale;
  robot.maxReverse = ROBOT_SPEC.maxReverse * scale;
  robot.accel = ROBOT_SPEC.accel * scale;
  robot.brake = ROBOT_SPEC.brake * scale;
  for (const s of robot.sensors) s.setScale?.(scale);
}

// The face is drawn in its own units, FACE_SCALE per meter, then scaled to the map.
const FACE_SCALE = 40;
const BODY_W = ROBOT_SPEC.length * FACE_SCALE, BODY_H = ROBOT_SPEC.width * FACE_SCALE;
const EYE_R = 6.5, PUPIL_R = 3.6;
const PUPIL_FREE = EYE_R - PUPIL_R; // how far a pupil can travel from the eye centre
const PUPIL_DAMPING = 3;            // 1/s
const PUPIL_KICK = 0.7;             // pupil acceleration per unit of robot acceleration
const PUPIL_BOUNCE = 0.5;           // restitution when a pupil hits the eye rim
const MAX_ACCEL = 3000;             // face units/s^2, caps impact spikes

// Pupils are loose in the eye: they lag behind when the robot accelerates, swing
// outward in turns, and slosh around after a hit. (ax, ay) is the robot's
// acceleration in its own frame.
function updateEyes(robot, dt, ax, ay) {
  for (const e of robot.eyes) {
    e.vx += (-e.k * e.x - PUPIL_DAMPING * e.vx - PUPIL_KICK * ax) * dt;
    e.vy += (-e.k * e.y - PUPIL_DAMPING * e.vy - PUPIL_KICK * ay) * dt;
    e.x += e.vx * dt;
    e.y += e.vy * dt;

    const r = Math.hypot(e.x, e.y);
    if (r > PUPIL_FREE) {
      const nx = e.x / r, ny = e.y / r;
      e.x = nx * PUPIL_FREE;
      e.y = ny * PUPIL_FREE;
      const vn = e.vx * nx + e.vy * ny;
      if (vn > 0) {
        e.vx -= (1 + PUPIL_BOUNCE) * vn * nx;
        e.vy -= (1 + PUPIL_BOUNCE) * vn * ny;
      }
    }
  }
}

// Cute face on the front of the robot (+x is forward): big googly eyes with sparkles,
// blush cheeks and a little smile. Pupil positions come from updateEyes.
function drawFace(ctx, robot) {
  const ex = BODY_W / 2 - 11;

  // blush cheeks
  ctx.fillStyle = "rgba(255, 120, 150, 0.55)";
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(-3, sign * 7, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // smile
  ctx.strokeStyle = "#1c3550";
  ctx.lineWidth = 1.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-1, -3.5);
  ctx.quadraticCurveTo(-5, 0, -1, 3.5);
  ctx.stroke();

  [-1, 1].forEach((sign, i) => {
    const ey = sign * 5.2;
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(ex, ey, EYE_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#1c3550";
    ctx.lineWidth = 1;
    ctx.stroke();

    const px = ex + robot.eyes[i].x;
    const py = ey + robot.eyes[i].y;
    ctx.fillStyle = "#14202e";
    ctx.beginPath();
    ctx.arc(px, py, PUPIL_R, 0, Math.PI * 2);
    ctx.fill();

    // sparkle
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(px - 1.1, py - 1.1, 1.2, 0, Math.PI * 2);
    ctx.fill();
  });
}

export function drawRobot(ctx, robot, scrollX, scrollY) {
  ctx.save();
  ctx.translate(robot.x + scrollX, robot.y + scrollY);
  ctx.rotate(robot.angle);
  ctx.scale(robot.scale / FACE_SCALE, robot.scale / FACE_SCALE);
  ctx.fillStyle = "#7fd0ff";
  ctx.strokeStyle = "#2a6a9a";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-BODY_W / 2, -BODY_H / 2, BODY_W, BODY_H, 7);
  ctx.fill();
  ctx.stroke();
  drawFace(ctx, robot);
  ctx.restore();
  for (const s of robot.sensors) s.draw?.(ctx, scrollX, scrollY);
}

function approach(v, target, step) {
  return v < target ? Math.min(v + step, target) : Math.max(v - step, target);
}

export function updateRobot(robot, dt, keys, obstacles = []) {
  dt = Math.min(dt, 0.05);
  const x0 = robot.x, y0 = robot.y;

  const throttle = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
  const steer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);

  const targetSpeed = throttle > 0 ? robot.maxSpeed
    : throttle < 0 ? -robot.maxReverse : 0;
  const targetTurn = steer * robot.maxTurnSpeed;

  const speedRate =
    throttle !== 0 && (robot.speed === 0 || Math.sign(throttle) === Math.sign(robot.speed))
      ? robot.accel : robot.brake;
  const turnRate =
    steer !== 0 && (robot.turnSpeed === 0 || Math.sign(steer) === Math.sign(robot.turnSpeed))
      ? robot.turnAccel : robot.turnBrake;

  robot.speed = approach(robot.speed, targetSpeed, speedRate * dt);
  robot.turnSpeed = approach(robot.turnSpeed, targetTurn, turnRate * dt);

  // integrate first, then resolve
  robot.angle += robot.turnSpeed * dt;
  robot.x += Math.cos(robot.angle) * robot.speed * dt;
  robot.y += Math.sin(robot.angle) * robot.speed * dt;

  // a few passes so pushing out of one obstacle doesn't leave you inside another
  for (let iter = 0; iter < 4; iter++) {
    let hit = false;
    for (const o of obstacles) {
      const c = o.contact(robot);
      if (!c) continue;
      hit = true;

      // a movable obstacle gets pushed away instead, unless something static blocks it
      if (o.movable && o.tryMove(-c.nx * c.depth, -c.ny * c.depth, obstacles)) {
        const hn = Math.cos(robot.angle) * c.nx + Math.sin(robot.angle) * c.ny;
        // pushing caps the robot's speed instead of stalling it
        if (robot.speed * hn < 0) {
          const cap = (robot.speed > 0 ? robot.maxSpeed : robot.maxReverse) * (1 - o.pushResistance);
          robot.speed = Math.sign(robot.speed) * Math.min(Math.abs(robot.speed), cap);
        }
        continue;
      }

      robot.x += c.nx * c.depth;
      robot.y += c.ny * c.depth;

      // hn < 0 means heading into the surface (forward or reversing)
      const hn = Math.cos(robot.angle) * c.nx + Math.sin(robot.angle) * c.ny;
      // if the robot is moving into the surface, slow it down
      if (robot.speed * hn < 0) robot.speed *= 1 - hn * hn;
    }
    if (!hit) break;
  }

  // acceleration from the motion that actually happened (so wall hits count), in the robot frame
  if (dt > 0) {
    const vx = (robot.x - x0) / dt, vy = (robot.y - y0) / dt;
    const wx = (vx - robot.vx) / dt / robot.scale, wy = (vy - robot.vy) / dt / robot.scale; // m/s^2
    robot.vx = vx; robot.vy = vy;
    const c = Math.cos(robot.angle), sn = Math.sin(robot.angle);
    robot.bodyAccel = { x: wx * c + wy * sn, y: -wx * sn + wy * c };

    let ax = robot.bodyAccel.x * FACE_SCALE, ay = robot.bodyAccel.y * FACE_SCALE;
    const mag = Math.hypot(ax, ay);
    if (mag > MAX_ACCEL) { ax *= MAX_ACCEL / mag; ay *= MAX_ACCEL / mag; }
    updateEyes(robot, dt, ax, ay);
  }

  for (const s of robot.sensors) s.scan?.(robot, obstacles, dt);
  }