// Pose estimate from the gyro and the wheel odometry alone, without the lidar.
// It starts at the true pose and drifts away from it: the problem SLAM has to solve.
// Positions are in world px, like the robot.
//
// Like a real robot it calibrates the gyro first: while it stands still, whatever the gyro
// reads is its bias, so the readings are averaged and subtracted from then on. That removes
// most of the heading drift; the wheel size error and wall scrapes still get through.

const MAX_TRACK = 5000;    // stored points
const TRACK_STEP = 2;      // px between stored points
const COLOR = "rgba(140, 60, 200, 0.9)";
const CALIB_TIME = 2;      // s of standing still averaged into the gyro bias
const STILL_TURN = 0.05;   // rad/s, gyro readings above this mean the robot is turning in place

export const deadReckoning = {
    x: 0, y: 0, angle: 0,
    track: [],
    gyroBias: 0,   // rad/s, average gyro reading while standing still
    calibTime: 0,  // s of standstill averaged so far

    reset(pose) {
        this.x = pose.x;
        this.y = pose.y;
        this.angle = pose.angle ?? 0;
        this.track = [{ x: this.x, y: this.y }];
        this.gyroBias = 0;
        this.calibTime = 0;
    },

    calibrating() {
        return this.calibTime < CALIB_TIME;
    },

    step(robot, dt) {
        const imu = robot.sensors.find(s => s.type === "imu");
        const odo = robot.sensors.find(s => s.type === "odometry");
        if (!imu || !odo || !(dt > 0)) return;
        const wz = imu.reading.wz, v = odo.reading.v;

        // standing still: the wheels don't turn and neither does the robot, so the gyro reads only its bias
        if (this.calibrating() && v === 0 && Math.abs(wz) < STILL_TURN) {
            this.calibTime += dt;
            this.gyroBias += (wz - this.gyroBias) * dt / this.calibTime;
            return;
        }

        this.angle += (wz - this.gyroBias) * dt;
        const d = v * robot.scale * dt;
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
