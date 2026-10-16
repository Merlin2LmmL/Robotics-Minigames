import { lidarSensor } from "./sensors/lidar.js";

export const robot = {
  x: 480, y: 540, width: 40, height: 20, angle: 0,
  speed: 0, turnSpeed: 0,
  maxSpeed: 200,     // px/s forward
  maxReverse: 80,    // px/s backward
  accel: 250,        // px/s^2 when speeding up
  brake: 500,        // px/s^2 when released or opposed
  maxTurnSpeed: 2.5, // rad/s
  turnAccel: 8,      // rad/s^2
  turnBrake: 16,     // rad/s^2
  sensors: [
    lidarSensor({ rayCount: 36, fov: Math.PI * 2, range: 250 })
  ]
};

export function drawRobot(ctx, robot, scrollX, scrollY) {
  ctx.save();
  ctx.translate(robot.x + scrollX, robot.y + scrollY);
  ctx.rotate(robot.angle);
  ctx.fillStyle = "blue";
  ctx.fillRect(-robot.width / 2, -robot.height / 2, robot.width, robot.height);
  ctx.restore();
  for (const s of robot.sensors) s.draw?.(ctx, scrollX, scrollY);
}

function approach(v, target, step) {
  return v < target ? Math.min(v + step, target) : Math.max(v - step, target);
}

export function updateRobot(robot, dt, keys, obstacles = []) {
  dt = Math.min(dt, 0.05);

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

      robot.x += c.nx * c.depth;
      robot.y += c.ny * c.depth;

      // hn < 0 means heading into the surface (forward or reversing)
      const hn = Math.cos(robot.angle) * c.nx + Math.sin(robot.angle) * c.ny;
      // if the robot is moving into the surface, slow it down
      if (robot.speed * hn < 0) robot.speed *= 1 - hn * hn;
    }
    if (!hit) break;
  }

  for (const s of robot.sensors) s.scan?.(robot, obstacles);
}