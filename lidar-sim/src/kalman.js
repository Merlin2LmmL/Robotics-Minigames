import { rayObstacle } from "./sensors/lidar.js";

// Extended Kalman filter that fuses whichever sensors are switched on (kalman.use) into one
// pose estimate. Unlike dead reckoning it also knows how unsure it is: the covariance P.
// The state is kept in meters; pose() and draw() work in world px like the robot.
//
// State: x, y (m), heading (rad), forward speed v (m/s), turn rate w (rad/s),
// gyro bias bg (rad/s) and accelerometer bias ba (m/s^2). The biases are learned once an
// absolute sensor (lidar or GPS) makes them distinguishable from real motion.
//
// Every frame: predict with the motion model, using the accelerometer as the control input,
// then correct with each measurement that came in. All corrections are scalar updates,
// one number at a time, so no matrix ever has to be inverted.

const X = 0, Y = 1, TH = 2, V = 3, W = 4, BG = 5, BA = 6, N = 7;

// Process noise: what the motion model gets wrong, as std dev per sqrt(s)
const Q_POS = 0.05;         // m, wall sliding and wheel slip
const Q_HEADING = 0.005;    // rad
const Q_ACCEL = 8;          // m/s^2, unknown acceleration without the accelerometer
const Q_ACCEL_IMU = 0.3;    // m/s^2, what the accelerometer misses (it clips in crashes)
const Q_TURN = 10;          // rad/s^2, unknown turn acceleration
const Q_GYRO_BIAS = 1e-4;   // rad/s, bias wander
const Q_ACCEL_BIAS = 1e-3;  // m/s^2

// forward acceleration beyond what the motors can do (12.5 m/s^2 braking) is a crash:
// the wheels stop, the robot doesn't fly backwards, so the sample isn't integrated
const CRASH_ACCEL = 15;     // m/s^2

// Starting uncertainty (std dev) after a reset at the true pose
const P0 = { pos: 0.01, heading: 0.01, v: 0.01, w: 0.01, bg: 0.005, ba: 0.05 };

const LIDAR_RATE = 20;    // scans fused per second
const LIDAR_STRIDE = 2;   // fuse every 2nd ray
const LIDAR_SIGMA = 0.15; // m, range error the filter assumes: sensor noise plus beam jitter and model error
const LIDAR_GATE = 9;    // squared innovation / variance; beyond 3 sigma a ray is an outlier (people, pallets)
const MAX_SLOPE = 10;    // skip grazing rays and edges, where a tiny move changes the range a lot

const MAX_TRACK = 5000;  // stored points
const TRACK_STEP = 2;    // px between stored points
const MAX_FIXES = 12;    // GPS fixes drawn
const CHI2_95 = 5.991;   // 95% of a 2D Gaussian lies inside this squared Mahalanobis distance
const COLOR = "rgba(0, 150, 90, 0.95)";
const ELLIPSE_FILL = "rgba(0, 150, 90, 0.15)";
const GPS_COLOR = "rgba(30, 110, 230, 0.9)";

const identity = () => Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => +(i === j)));

function mul(A, B) {
    const C = Array.from({ length: N }, () => new Array(N).fill(0));
    for (let i = 0; i < N; i++)
        for (let k = 0; k < N; k++) {
            const a = A[i][k];
            if (a === 0) continue;
            for (let j = 0; j < N; j++) C[i][j] += a * B[k][j];
        }
    return C;
}

const transpose = A => A[0].map((_, j) => A.map(row => row[j]));

// measurement row with the given (index, value) pairs set
function row(...pairs) {
    const h = new Array(N).fill(0);
    for (let i = 0; i < pairs.length; i += 2) h[pairs[i]] = pairs[i + 1];
    return h;
}

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// walls the robot has on its map: everything that neither walks nor can be pushed
const isStatic = o => !o.movable && !o.behavior;

export const kalman = {
    // sensors the filter listens to, toggled from the UI
    use: { gyro: true, accel: true, odometry: true, lidar: true, gps: false },
    x: new Array(N).fill(0),
    P: identity(),
    scale: 40, // px per m
    track: [],
    fixes: [],     // GPS fixes fused, in px, for drawing
    gpsSeq: 0,
    lidarTimer: 0,
    lidarStats: { used: 0, rejected: 0 },

    reset(pose, scale) {
        this.scale = scale;
        this.x = [pose.x / scale, pose.y / scale, pose.angle ?? 0, 0, 0, 0, 0];
        const sd = [P0.pos, P0.pos, P0.heading, P0.v, P0.w, P0.bg, P0.ba];
        this.P = identity().map((r, i) => r.map(v => v * sd[i] * sd[i]));
        this.track = [{ x: pose.x, y: pose.y }];
        this.fixes = [];
        this.lidarTimer = 0;
        this.lidarStats = { used: 0, rejected: 0 };
    },

    // throw the estimate ~1 m and ~15° off, and admit it: watch the filter find its way back
    scramble() {
        const a = Math.random() * Math.PI * 2, turn = (Math.random() < 0.5 ? -1 : 1) * 0.25;
        this.x[X] += Math.cos(a);
        this.x[Y] += Math.sin(a);
        this.x[TH] += turn;
        this.P[X][X] += 1;
        this.P[Y][Y] += 1;
        this.P[TH][TH] += turn * turn;
    },

    pose() {
        return { x: this.x[X] * this.scale, y: this.x[Y] * this.scale, angle: this.x[TH] };
    },

    // Motion model, mirroring updateRobot: speed changes first, then heading, then position.
    // accel is the accelerometer's forward reading, or null when it isn't used.
    predict(dt, accel) {
        const s = this.x;
        const v = s[V] + (accel === null ? 0 : accel - s[BA]) * dt;
        const th = s[TH] + s[W] * dt;
        const c = Math.cos(th), sn = Math.sin(th);
        s[X] += v * c * dt;
        s[Y] += v * sn * dt;
        s[TH] = th;
        s[V] = v;

        // Jacobian of the step above
        const F = identity();
        F[TH][W] = dt;
        F[X][TH] = -v * sn * dt; F[X][W] = -v * sn * dt * dt; F[X][V] = c * dt;
        F[Y][TH] = v * c * dt;   F[Y][W] = v * c * dt * dt;   F[Y][V] = sn * dt;
        if (accel !== null) {
            F[V][BA] = -dt;
            F[X][BA] = -c * dt * dt;
            F[Y][BA] = -sn * dt * dt;
        }

        const qv = accel === null ? Q_ACCEL : Q_ACCEL_IMU;
        const q = [Q_POS, Q_POS, Q_HEADING, qv, Q_TURN, Q_GYRO_BIAS, Q_ACCEL_BIAS];
        this.P = mul(mul(F, this.P), transpose(F));
        for (let i = 0; i < N; i++) this.P[i][i] += q[i] * q[i] * dt;
    },

    // Scalar Kalman update: measurement z = H x + noise with variance R, innovation y = z - H x.
    // Returns false if the innovation fails the gate and the measurement was ignored.
    update(H, y, R, gate = Infinity) {
        const P = this.P;
        const PHt = P.map(r => r.reduce((t, v, j) => t + v * H[j], 0));
        const S = H.reduce((t, h, i) => t + h * PHt[i], 0) + R;
        if (y * y / S > gate) return false;
        const K = PHt.map(v => v / S);
        for (let i = 0; i < N; i++) this.x[i] += K[i] * y;
        // Joseph form, (I - KH) P (I - KH)^T + K R K^T, stays symmetric and positive
        const A = identity();
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) A[i][j] -= K[i] * H[j];
        this.P = mul(mul(A, P), transpose(A));
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) this.P[i][j] += K[i] * K[j] * R;
        return true;
    },

    // Expected range of one lidar beam (m) if the robot were at state s: cast it into the
    // known map. Returns the sensor range when it hits nothing.
    expectedRange(s, rel, lidar, walls) {
        const sc = lidar.scale, c = Math.cos(s[TH]), sn = Math.sin(s[TH]);
        const { offsetX, offsetY, range } = lidar.spec;
        const ox = (s[X] + offsetX * c - offsetY * sn) * sc;
        const oy = (s[Y] + offsetX * sn + offsetY * c) * sc;
        const dx = Math.cos(s[TH] + rel), dy = Math.sin(s[TH] + rel);
        let d = range * sc;
        for (const o of walls) d = Math.min(d, rayObstacle(ox, oy, dx, dy, o));
        return d / sc;
    },

    // Map matching: each beam's measured range against the range the map predicts from the
    // estimated pose. The Jacobian comes from nudging the pose and casting again.
    fuseLidar(lidar, obstacles) {
        const walls = obstacles.filter(isStatic);
        const range = lidar.spec.range;
        let used = 0, rejected = 0;
        for (let i = 0; i < lidar.readings.length; i += LIDAR_STRIDE) {
            const r = lidar.readings[i];
            if (r.distance === null) continue;
            const h0 = this.expectedRange(this.x, r.relAngle, lidar, walls);
            if (h0 >= range) continue;

            const H = new Array(N).fill(0);
            let usable = true;
            for (const [k, eps, limit] of [[X, 0.01, MAX_SLOPE], [Y, 0.01, MAX_SLOPE], [TH, 0.002, MAX_SLOPE * h0]]) {
                const s = this.x.slice();
                s[k] += eps;
                H[k] = (this.expectedRange(s, r.relAngle, lidar, walls) - h0) / eps;
                if (Math.abs(H[k]) > limit) usable = false;
            }
            if (!usable) continue;

            if (this.update(H, r.distance / lidar.scale - h0, LIDAR_SIGMA ** 2, LIDAR_GATE)) used++;
            else rejected++;
        }
        this.lidarStats = { used, rejected };
    },

    step(robot, dt, obstacles) {
        if (!(dt > 0)) return;
        const imu = robot.sensors.find(s => s.type === "imu");
        const odo = robot.sensors.find(s => s.type === "odometry");
        const gps = robot.sensors.find(s => s.type === "gps");
        const lidar = robot.sensors.find(s => s.type === "lidar");

        const ax = this.use.accel && imu ? imu.reading.ax : null;
        this.predict(dt, ax !== null && Math.abs(ax) < CRASH_ACCEL ? ax : null);

        // gyro: measures turn rate plus its bias
        if (this.use.gyro && imu) {
            this.update(row(W, 1, BG, 1), imu.reading.wz - (this.x[W] + this.x[BG]), imu.gyroNoise ** 2);
        }

        // wheels: forward speed, a little off by the unknown wheel size
        if (this.use.odometry && odo) {
            const v = odo.reading.v;
            this.update(row(V, 1), v - this.x[V], odo.speedNoise ** 2 + (odo.scaleError * v) ** 2);
        }

        // GPS: absolute position, once per new fix
        if (gps && gps.seq !== this.gpsSeq) {
            this.gpsSeq = gps.seq;
            if (this.use.gps && gps.reading) {
                const R = gps.noise ** 2;
                this.update(row(X, 1), gps.reading.x - this.x[X], R);
                this.update(row(Y, 1), gps.reading.y - this.x[Y], R);
                this.fixes.push({ x: gps.reading.x * this.scale, y: gps.reading.y * this.scale });
                if (this.fixes.length > MAX_FIXES) this.fixes.shift();
            }
        }
        if (!this.use.gps) this.fixes = [];

        this.lidarTimer += dt;
        if (this.lidarTimer >= 1 / LIDAR_RATE) {
            this.lidarTimer = 0;
            if (this.use.lidar && lidar) this.fuseLidar(lidar, obstacles);
            else this.lidarStats = { used: 0, rejected: 0 };
        }

        const p = this.pose(), last = this.track[this.track.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) >= TRACK_STEP) {
            this.track.push({ x: p.x, y: p.y });
            if (this.track.length > MAX_TRACK) this.track.shift();
        }
    },

    // distance between estimate and truth, m
    error(robot) {
        return Math.hypot(this.x[X] - robot.x / this.scale, this.x[Y] - robot.y / this.scale);
    },

    // heading error, rad
    headingError(robot) {
        return Math.abs(wrap(this.x[TH] - robot.angle));
    },

    // the filter's own idea of its position error (1 sigma, both axes together), m
    sigma() {
        return Math.sqrt(this.P[X][X] + this.P[Y][Y]);
    },

    gyroBias() { return this.x[BG]; },

    // path, GPS fixes, the 95% uncertainty ellipse and an outline of the robot where it thinks it is
    draw(ctx, robot) {
        const lw = robot.scale / 40, sc = this.scale, p = this.pose();
        ctx.save();

        ctx.fillStyle = GPS_COLOR;
        this.fixes.forEach((f, i) => {
            ctx.globalAlpha = (i + 1) / this.fixes.length;
            ctx.beginPath();
            ctx.arc(f.x, f.y, 2.5 * lw, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.globalAlpha = 1;

        ctx.strokeStyle = COLOR;
        ctx.lineWidth = 1.5 * lw;
        ctx.beginPath();
        this.track.forEach((t, i) => i ? ctx.lineTo(t.x, t.y) : ctx.moveTo(t.x, t.y));
        ctx.lineTo(p.x, p.y);
        ctx.stroke();

        // eigen decomposition of the 2x2 position covariance
        const a = this.P[X][X], b = this.P[X][Y], c = this.P[Y][Y];
        const mid = (a + c) / 2, half = Math.hypot((a - c) / 2, b);
        const r1 = Math.sqrt(Math.max(mid + half, 0) * CHI2_95) * sc;
        const r2 = Math.sqrt(Math.max(mid - half, 0) * CHI2_95) * sc;
        ctx.fillStyle = ELLIPSE_FILL;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, Math.max(r1, lw), Math.max(r2, lw), Math.atan2(2 * b, a - c) / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.strokeRect(-robot.width / 2, -robot.height / 2, robot.width, robot.height);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(robot.width / 2, 0);
        ctx.stroke();
        ctx.restore();
    },
};
