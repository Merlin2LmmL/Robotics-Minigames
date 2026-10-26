// Graph SLAM back end: works out the robot's path from its own sensors, without the map.
// It never looks at map.obstacles or the robot's true pose (`truth` is only kept for grading).
//
// How it works:
// 1. Odometry (gyro + wheels, same as dead reckoning) says roughly how the robot moved.
// 2. Every KEY_DIST of driving, the lidar scans since the last keyframe become a new one:
//    a node in the pose graph plus the rays it saw.
// 3. Scan matching lines the new keyframe up with the last few. That fixes most of the
//    odometry error and becomes the edge to the previous node.
// 4. Loop closure: back near an old keyframe, the scan gets matched against that one too.
//    If it fits well the edge goes into the graph, the graph is optimized and the drifted
//    path snaps back into shape.
//
// Everything in here is in meters, in the frame the robot started in (= the world frame,
// since it starts at the map's start pose). The map itself is drawn by occupancyGrid.js from:
//   keyframes[k].pose  best guess of the keyframe's pose { x, y, th }; changes when the graph
//                      is optimized, so read it when needed instead of copying it
//   keyframes[k].rays  the rays it saw, in its own frame: { ox, oy, x, y, hit }
//   toWorld(kf, p)     a point from those rays into the world frame
//   revision           goes up whenever old poses moved (a loop closed): rebuild the map

import { createDeadReckoning } from "../deadReckoning.js";
import { PoseGraph, compose, between, transformPoint, diagInfo, addMat } from "./poseGraph.js";
import { buildReference, matchScan, conditioning } from "./scanMatch.js";

const KEY_DIST = 0.5;        // m driven before a new keyframe
const KEY_TURN = 0.4;        // rad turned before a new keyframe
const SCAN_DT = 0.1;         // s between lidar scans kept for a keyframe
const MAX_SCANS = 20;        // per keyframe; standing still doesn't pile up rays forever
const VOXEL = 0.05;          // m, matching points are thinned to one per cell this size

const LOCAL_KEYFRAMES = 6;   // the new keyframe is matched against this many before it
const MIN_FRACTION = 0.3;    // share of points that must land on a line for a match to count
const MAX_CORRECTION = 0.5;  // m, a sequential match further than this from odometry is rejected
const MAX_TURN_CORRECTION = 0.35; // rad

const LOOP_GAP = 15;         // keyframes; younger ones are the local neighborhood, not a loop
const LOOP_RADIUS = 2;       // m, search radius around the current estimate...
const LOOP_GROWTH = 0.05;    // ...plus this much per m driven since the last closure
const LOOP_MAX_RADIUS = 6;   // m
const LOOP_TRIES = 3;        // candidates tried per keyframe
const LOOP_SPAN = 2;         // the candidate's submap: it and this many keyframes either side
const LOOP_FRACTION = 0.7;   // stricter than sequential matches: a wrong loop bends the map
const LOOP_RMS = 0.05;       // m
const LOOP_CONDITIONING = 0.1; // a corridor fits anywhere along itself: reject those
const LOOP_MIN_POINTS = 40;  // points paired in the final match
const LOOP_SHIFTS = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // m, restarts for the ambiguity check
const LOOP_AMBIGUITY = 0.1;  // a restart fitting within this share of the best one is a rival...
const LOOP_SAME = 0.3;       // ...unless it ended up within this many m of it
const LOOP_TURNS = [0, -0.15, 0.15, -0.3, 0.3]; // rad, starting guesses, odometry heading can be well off
const LOOP_COOLDOWN = 3;     // keyframes between closures
const LOOP_CONSISTENT = 1;   // squared error (in sigmas) below which a closure needs no optimizing
const OPTIMIZE_ITERATIONS = 5;

// What odometry gets wrong between keyframes (std dev): a base plus a share of the motion
const ODO_POS = 0.02, ODO_POS_PER_M = 0.05;  // m, m/m
const ODO_TURN = 0.01, ODO_TURN_PER_RAD = 0.05, ODO_TURN_PER_M = 0.02; // rad, rad/rad, rad/m
const ICP_TRUST = 0.02;      // ICP info is scaled down by this: the points of one keyframe aren't independent

const COLOR_NODE = "rgba(220, 120, 0, 0.95)";
const COLOR_EDGE = "rgba(220, 120, 0, 0.5)";
const COLOR_LOOP = "rgba(230, 30, 120, 0.9)";
const COLOR_POINT = "rgba(60, 60, 60, 0.6)";

function thin(points) {
    const cells = new Map();
    for (const p of points) {
        const k = `${Math.floor(p.x / VOXEL)},${Math.floor(p.y / VOXEL)}`;
        if (!cells.has(k)) cells.set(k, p);
    }
    return [...cells.values()];
}

function odometryInfo(d) {
    const dist = Math.hypot(d.x, d.y);
    const sp = ODO_POS + ODO_POS_PER_M * dist;
    return diagInfo(sp, sp, ODO_TURN + ODO_TURN_PER_RAD * Math.abs(d.th) + ODO_TURN_PER_M * dist);
}

export const slam = {
    graph: new PoseGraph(),
    keyframes: [],
    loops: [],
    revision: 0,
    scale: 40,
    stats: {},

    reset(pose, scale) {
        this.scale = scale;
        this.graph = new PoseGraph();
        this.keyframes = [];
        this.loops = [];
        this.revision++;
        this.stats = { keyframes: 0, loops: 0, rejected: 0, matchFails: 0, optimizations: 0, lastOptimizeMs: 0, lastOptimize: null };
        this.odom = createDeadReckoning();
        this.odom.reset(pose);
        this.start = { x: pose.x / scale, y: pose.y / scale, th: pose.angle ?? 0 };
        this.window = null;    // keyframe being collected
        this.lastKey = null;   // { odom, node } of the last finished keyframe
        this.driven = 0;       // m since the last loop closure
        this.cooldown = 0;
    },

    odomPose() {
        return { x: this.odom.x / this.scale, y: this.odom.y / this.scale, th: this.odom.angle };
    },

    toWorld(kf, p) { return transformPoint(kf.pose, p); },

    // where the robot is now: the last keyframe plus odometry since
    pose() {
        let p = this.start;
        if (this.window && this.lastKey) {
            const kf = this.keyframes[this.lastKey.node];
            p = compose(kf.pose, between(this.lastKey.odom, this.odomPose()));
        } else if (this.window) {
            p = compose(this.start, between(this.window.odom, this.odomPose()));
        }
        return { x: p.x * this.scale, y: p.y * this.scale, angle: p.th };
    },

    step(robot, dt) {
        if (!(dt > 0) || !this.odom) return;
        this.odom.step(robot, dt);
        const lidar = robot.sensors.find(s => s.type === "lidar");
        if (!lidar || this.odom.calibrating()) return;
        const o = this.odomPose();

        if (!this.window) this.window = this.newWindow(o, robot);
        const w = this.window, rel = between(w.odom, o);

        w.timer += dt;
        if (w.timer >= SCAN_DT && w.scans < MAX_SCANS) {
            w.timer = 0;
            w.scans++;
            const sc = lidar.scale, { offsetX, offsetY } = lidar.spec;
            const org = transformPoint(rel, { x: offsetX, y: offsetY });
            for (const r of lidar.readings) {
                const d = (r.distance ?? lidar.range) / sc, a = rel.th + r.relAngle;
                w.rays.push({ ox: org.x, oy: org.y, x: org.x + Math.cos(a) * d, y: org.y + Math.sin(a) * d, hit: r.distance !== null });
            }
        }

        if (Math.hypot(rel.x, rel.y) >= KEY_DIST || Math.abs(rel.th) >= KEY_TURN) {
            this.driven += Math.hypot(rel.x, rel.y);
            this.addKeyframe(w);
            this.window = this.newWindow(o, robot);
        }
    },

    // the scans of the next keyframe get collected in here, starting at odometry pose o
    newWindow(o, robot) {
        const truth = { x: robot.x / this.scale, y: robot.y / this.scale, th: robot.angle };
        return { odom: o, truth, rays: [], scans: 0, timer: SCAN_DT };
    },

    addKeyframe(w) {
        const points = thin(w.rays.filter(r => r.hit).map(r => ({ x: r.x, y: r.y })));
        let pose = this.start;
        const prev = this.lastKey;
        if (prev) pose = compose(this.keyframes[prev.node].pose, between(prev.odom, w.odom));

        const kf = { pose, rays: w.rays, points, truth: w.truth };
        const node = this.graph.addNode(pose);
        kf.pose = this.graph.nodes[node]; // the same object, so optimizing updates it
        this.keyframes.push(kf);
        this.stats.keyframes = this.keyframes.length;

        if (prev) {
            const odo = between(this.keyframes[prev.node].pose, pose);
            let z = odo, info = odometryInfo(odo);
            const m = this.matchLocal(kf, node);
            if (m) {
                const corr = between(pose, m.pose);
                if (Math.hypot(corr.x, corr.y) < MAX_CORRECTION && Math.abs(corr.th) < MAX_TURN_CORRECTION) {
                    Object.assign(kf.pose, m.pose);
                    z = between(this.keyframes[prev.node].pose, m.pose);
                    // the match is weak where the scan has no walls, odometry fills those directions in
                    info = addMat(info, m.info.map(v => v * ICP_TRUST));
                } else this.stats.matchFails++;
            } else this.stats.matchFails++;
            this.graph.addEdge(prev.node, node, z, info);
        }
        this.lastKey = { odom: w.odom, node };

        if (this.cooldown > 0) this.cooldown--;
        else this.closeLoop(kf, node);
    },

    // points of keyframes [from, to) in the world frame
    submap(from, to) {
        const pts = [];
        for (let k = Math.max(from, 0); k < Math.min(to, this.keyframes.length); k++) {
            const kf = this.keyframes[k];
            for (const p of kf.points) pts.push(transformPoint(kf.pose, p));
        }
        return pts;
    },

    matchLocal(kf, node) {
        if (kf.points.length < 10) return null;
        const ref = buildReference(this.submap(node - LOCAL_KEYFRAMES, node));
        if (ref.size < 10) return null;
        const m = matchScan(kf.points, ref, kf.pose);
        return m && m.fraction >= MIN_FRACTION ? m : null;
    },

    closeLoop(kf, node) {
        if (kf.points.length < 20) return;
        const radius = Math.min(LOOP_RADIUS + LOOP_GROWTH * this.driven, LOOP_MAX_RADIUS);
        const candidates = [];
        for (let j = 0; j < node - LOOP_GAP; j++) {
            const d = Math.hypot(this.keyframes[j].pose.x - kf.pose.x, this.keyframes[j].pose.y - kf.pose.y);
            if (d < radius) candidates.push({ j, d });
        }
        candidates.sort((a, b) => a.d - b.d);

        // don't try neighbors of a candidate already tried, they share most of their submap
        const tried = [];
        for (const { j } of candidates) {
            if (tried.length >= LOOP_TRIES) break;
            if (tried.some(t => Math.abs(t - j) <= LOOP_SPAN)) continue;
            tried.push(j);

            const ref = buildReference(this.submap(j - LOOP_SPAN, Math.min(j + LOOP_SPAN + 1, node - LOOP_GAP)));
            if (ref.size < 20) continue;
            const opts = { maxDist: 0.5 + radius / 4 };
            let best = null;
            for (const turn of LOOP_TURNS) {
                const m = matchScan(kf.points, ref, { ...kf.pose, th: kf.pose.th + turn }, opts);
                if (m && (!best || m.fraction > best.fraction)) best = m;
            }
            if (!best || best.fraction < LOOP_FRACTION || best.rms > LOOP_RMS || conditioning(best.info) < LOOP_CONDITIONING
                || best.matched < LOOP_MIN_POINTS || this.ambiguous(kf, ref, best, opts)) {
                this.stats.rejected++;
                continue;
            }

            // edge from the old keyframe to the new one, as the match sees it
            const edge = this.graph.addEdge(j, node, between(this.keyframes[j].pose, best.pose), best.info.map(v => v * ICP_TRUST), true);
            this.loops.push({ from: j, to: node });
            this.stats.loops = this.loops.length;
            // a loop the graph already agrees with changes nothing: only optimize when it pulls
            if (this.graph.edgeChi2(edge) > LOOP_CONSISTENT) {
                const t0 = performance.now();
                this.stats.lastOptimize = this.graph.optimize(OPTIMIZE_ITERATIONS);
                this.stats.lastOptimizeMs = performance.now() - t0;
                this.stats.optimizations++;
                this.revision++;
            }
            this.driven = 0;
            this.cooldown = LOOP_COOLDOWN;
            return;
        }
    },

    // Start the match again from a bit to each side of the best result. If one of those
    // settles somewhere else and fits about as well, the place looks the same in more than
    // one spot (a row of identical rooms, shelves, a long wall): too risky to close a loop on.
    ambiguous(kf, ref, best, opts) {
        for (const [dx, dy] of LOOP_SHIFTS) {
            const m = matchScan(kf.points, ref, compose(best.pose, { x: dx, y: dy, th: 0 }), opts);
            if (m && m.fraction > best.fraction - LOOP_AMBIGUITY
                && Math.hypot(m.pose.x - best.pose.x, m.pose.y - best.pose.y) > LOOP_SAME) return true;
        }
        return false;
    },

    // mean distance between keyframe estimates and where the robot really was (m)
    error() {
        if (!this.keyframes.length) return 0;
        return this.keyframes.reduce((t, kf) => t + Math.hypot(kf.pose.x - kf.truth.x, kf.pose.y - kf.truth.y), 0) / this.keyframes.length;
    },

    // how far the current estimate is from the truth (m)
    poseError(robot) {
        const p = this.pose();
        return Math.hypot(p.x - robot.x, p.y - robot.y) / this.scale;
    },

    // layers: which parts to draw, { estimate, graph, points } (see mapping.layers)
    draw(ctx, robot, layers) {
        const sc = this.scale, lw = robot.scale / 40;
        ctx.save();

        if (layers.points) {
            ctx.fillStyle = COLOR_POINT;
            for (const kf of this.keyframes)
                for (const p of kf.points) {
                    const q = transformPoint(kf.pose, p);
                    ctx.fillRect(q.x * sc - lw, q.y * sc - lw, 2 * lw, 2 * lw);
                }
        }

        if (layers.graph) {
            ctx.lineWidth = lw;
            for (const edge of this.graph.edges) {
                const a = this.graph.nodes[edge.i], b = this.graph.nodes[edge.j];
                // loop closures fade out when the robust kernel stops trusting them
                ctx.strokeStyle = edge.robust ? COLOR_LOOP : COLOR_EDGE;
                ctx.globalAlpha = edge.robust ? 0.2 + 0.8 * edge.weight : 1;
                ctx.beginPath();
                ctx.moveTo(a.x * sc, a.y * sc);
                ctx.lineTo(b.x * sc, b.y * sc);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
            ctx.fillStyle = COLOR_NODE;
            for (const n of this.graph.nodes) {
                ctx.beginPath();
                ctx.arc(n.x * sc, n.y * sc, 2.5 * lw, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        if (layers.estimate) {
            const p = this.pose();
            ctx.strokeStyle = COLOR_NODE;
            ctx.lineWidth = 1.5 * lw;
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle);
            ctx.strokeRect(-robot.width / 2, -robot.height / 2, robot.width, robot.height);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(robot.width / 2, 0);
            ctx.stroke();
        }
        ctx.restore();
    },
};
