import { gaussian } from "./lidar.js";

// Satellite positioning: an absolute position fix a few times a second. It never drifts,
// but every fix is off by a meter or so, so on its own it jumps around the truth.
// seq counts the fixes, so a reader can tell a new fix from the one it already used.
export function gpsSensor({
    noise = 1.0, // std dev per axis, m
    rate = 2,    // fixes per second
} = {}) {
    return {
        type: "gps",
        noise, rate,
        scale: 1,
        timer: 0,
        seq: 0,
        reading: null, // { x, y } in m, null before the first fix

        setScale(scale) { this.scale = scale; },

        reset() {
            this.timer = 0;
            this.reading = null;
        },

        scan(robot, obstacles, dt = 0) {
            this.timer += dt;
            if (this.timer < 1 / this.rate) return;
            this.timer -= 1 / this.rate;
            this.reading = {
                x: robot.x / this.scale + gaussian() * this.noise,
                y: robot.y / this.scale + gaussian() * this.noise,
            };
            this.seq++;
        },
    };
}
