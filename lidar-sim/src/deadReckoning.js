// Pose estimate from the gyro and the wheel odometry alone, without the lidar.
// It starts at the true pose and drifts away from it: the problem SLAM has to solve.
// Positions are in world px, like the robot.

const MAX_TRACK = 5000;    // stored points
const TRACK_STEP = 2;      // px between stored points
const COLOR = "rgba(140, 60, 200, 0.9)";

export const deadReckoning = {
    x: 0, y: 0, angle: 0,
    track: [],

    reset(pose) {
        this.x = pose.x;
        this.y = pose.y;
        this.angle = pose.angle ?? 0;
        this.track = [{ x: this.x, y: this.y }];
    },

    step(robot, dt) {
        const imu = robot.sensors.find(s => s.type === "imu");
        const odo = robot.sensors.find(s => s.type === "odometry");
        if (!imu || !odo || !(dt > 0)) return;
        this.angle += imu.reading.wz * dt;
        const d = odo.reading.v * robot.scale * dt;
        this.x += Math.cos(this.angle) * d;
        this.y += Math.sin(this.angle) * d;
        const last = this.track[this.track.length - 1];
        if (Math.hypot(this.x - last.x, this.y - last.y) >= TRACK_STEP) {
            this.track.push({ x: this.x, y: this.y });
            if (this.track.length > MAX_TRACK) this.track.shift();
        }
    },

    // distance between estimate and truth, m
    error(robot) {
        return Math.hypot(this.x - robot.x, this.y - robot.y) / robot.scale;
    },

    // dashed path plus an outline of the robot where it thinks it is
    draw(ctx, robot) {
        const lw = robot.scale / 40;
        ctx.save();
        ctx.strokeStyle = COLOR;
        ctx.lineWidth = 1.5 * lw;
        ctx.setLineDash([4 * lw, 3 * lw]);
        ctx.beginPath();
        this.track.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.lineTo(this.x, this.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        ctx.strokeRect(-robot.width / 2, -robot.height / 2, robot.width, robot.height);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(robot.width / 2, 0);
        ctx.stroke();
        ctx.restore();
    },
};
