import { gaussian } from "./lidar.js";

const G = 9.81; // m/s^2

// Accelerometer + gyroscope, like a cheap 6-axis IMU lying flat on the robot.
// It measures acceleration in the robot frame (x forward, y right) and the turn rate,
// never velocity: velocity has to be integrated from it, and that is where drift comes from.
// Each power-on (reset) draws a new constant bias on top of the per-sample noise.
export function imuSensor({
    accelNoise = 0.05,   // std dev per sample, m/s^2
    accelBias = 0.05,    // std dev of the constant bias, m/s^2
    gyroNoise = 0.01,    // std dev per sample, rad/s
    gyroBias = 0.005,    // std dev of the constant bias, rad/s
    accelRange = 16 * G, // readings clip here, like a real accelerometer at its limit
} = {}) {
    const drawBias = () => ({ ax: gaussian() * accelBias, ay: gaussian() * accelBias, wz: gaussian() * gyroBias });
    return {
        type: "imu",
        accelNoise, gyroNoise, accelRange,
        bias: drawBias(),
        // ax, ay in m/s^2; wz in rad/s, positive turning the same way as robot.angle (clockwise on screen)
        reading: { ax: 0, ay: 0, wz: 0 },

        reset() { this.bias = drawBias(); },

        scan(robot) {
            const clip = v => Math.min(Math.max(v, -this.accelRange), this.accelRange);
            this.reading = {
                ax: clip(robot.bodyAccel.x + this.bias.ax + gaussian() * this.accelNoise),
                ay: clip(robot.bodyAccel.y + this.bias.ay + gaussian() * this.accelNoise),
                wz: robot.turnSpeed + this.bias.wz + gaussian() * this.gyroNoise,
            };
        },
    };
}

// Wheel encoders: the forward speed the wheels report. They only know how fast the wheels
// turn, so sliding along a wall or being shoved sideways goes unnoticed, and a slightly
// wrong wheel size (scaleError) makes every distance a little off.
export function odometrySensor({
    speedNoise = 0.03, // std dev per sample while moving, m/s
    scaleError = 0.02, // std dev of the wheel size error, as a fraction
} = {}) {
    const drawFactor = () => 1 + gaussian() * scaleError;
    return {
        type: "odometry",
        speedNoise, scaleError,
        factor: drawFactor(),
        reading: { v: 0 }, // m/s, negative when reversing

        reset() { this.factor = drawFactor(); },

        scan(robot) {
            const v = robot.speed / robot.scale;
            this.reading = { v: v === 0 ? 0 : v * this.factor + gaussian() * this.speedNoise };
        },
    };
}
