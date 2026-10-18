// A behavior is (self, dt, world) => void, with world = { obstacles, robot }.
// Movers go through obstacle.tryMove so they stop at walls and the robot.

// Walk back and forth along a list of waypoints [{x, y}, ...] (px).
export function patrol(waypoints, speed, startAt = 0) {
    let target = startAt % waypoints.length, dir = 1;
    return (self, dt, world) => {
        const w = waypoints[target];
        const dx = w.x - self.x, dy = w.y - self.y;
        const dist = Math.hypot(dx, dy), step = speed * dt;
        if (dist <= step) {
            self.translate(dx, dy);
            if (target + dir < 0 || target + dir >= waypoints.length) dir = -dir;
            target += dir;
            return;
        }
        // blocked (e.g. the robot is in the way): just wait
        self.tryMove(dx / dist * step, dy / dist * step, world.obstacles, world.robot);
    };
}
