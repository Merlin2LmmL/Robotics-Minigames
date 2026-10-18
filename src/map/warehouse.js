import { Obstacle } from "./obstacle.js";
import { patrol } from "./movers.js";
import { robot as defaultRobot } from "../robot.js";

export const SCALE = 40;
export const WALL_THICKNESS = 0.3;

const WALL_COLOR = "rgba(90, 90, 90, 0.8)";
const NORTH_CLEARANCE = 3;   // m, outer wall to first shelf row
const DOCK_DEPTH = 4.5;      // m, how far the dock area reaches in from the south wall
const PALLET = { w: 0.8, h: 1.2 };
const MIN_PALLET_SPACING = 2.5; // m along an aisle, so two boxes never pinch it from both sides

// Small seedable PRNG (mulberry32): same seed -> same sequence.
// Janked from https://github.com/cprosche/mulberry32
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const hsla = (h, s, l, a = 0.85) => `hsla(${h.toFixed(0)}, ${s.toFixed(0)}%, ${l.toFixed(1)}%, ${a})`;

// returns as a ready to use map: { obstacles, start, worldSize, warnings }.
export function generateWarehouse({
    rowCount = 4,
    rowLength = 24,
    aisleWidth = 3,
    shelfUnitLength = 2,
    clutterAmount = 0.5, // 0 = none, 1 = lots
    workerCount = 2,     // walking people (0-2); they are self-moving obstacles
    seed = 1,
    spawn = null,        // { x, y, angle } in meters inside the room; default is by the dock
    roomWidth = 40,
    roomHeight = 25,
    robot = defaultRobot,
} = {}) {
    const warnings = [];
    const warn = msg => { warnings.push(msg); console.warn("[warehouse] " + msg); };

    // ---- aisle width check: every aisle must fit 2 robot diameters ----
    const diameter = Math.hypot(robot.width, robot.height) / SCALE; // circumscribed circle, m
    const minAisle = 2 * diameter;
    if (aisleWidth < minAisle) {
        warn(`aisleWidth ${aisleWidth} m is below 2 robot diameters; clamped to ${minAisle.toFixed(2)} m`);
        aisleWidth = minAisle;
    }
    // end (cross) aisles are what is left beside the rows; they need the same width
    const maxRowLength = roomWidth - 2 * aisleWidth;
    if (rowLength > maxRowLength) {
        warn(`rowLength ${rowLength} m leaves cross aisles that are too narrow; clamped to ${maxRowLength} m`);
        rowLength = maxRowLength;
    }
    // rows + north clearance + one aisle below the last row + dock area must fit the room
    const fits = n => NORTH_CLEARANCE + n + (n - 1) * aisleWidth + aisleWidth + DOCK_DEPTH <= roomHeight;
    if (!fits(rowCount)) {
        const wanted = rowCount;
        while (rowCount > 1 && !fits(rowCount)) rowCount--;
        warn(`rowCount ${wanted} does not fit the room with the dock; reduced to ${rowCount}`);
    }

    const T = WALL_THICKNESS;
    const px = m => (m + T) * SCALE; // interior meters -> world px (walls sit outside the interior)
    const obstacles = [];
    const rect = (x, y, w, h, color, movable = false) => {
        const o = new Obstacle("rectangle", color, px(x), px(y), w * SCALE, h * SCALE);
        o.outline = false; // fills only, so the 0.1 m shelf gaps stay visible
        o.movable = movable;
        obstacles.push(o);
        return o;
    };
    // cosmetic only (never collided with, never scanned): floor goes under the robot, overlay on top
    const floor = [], overlay = [];
    const deco = (list, x, y, w, h, color) => {
        const o = new Obstacle("rectangle", color, px(x), px(y), w * SCALE, h * SCALE);
        o.outline = false;
        list.push(o);
    };

    // ---- outer walls (the same rectangles the maze uses) ----
    const worldSize = { width: Math.round((roomWidth + 2 * T) * SCALE), height: Math.round((roomHeight + 2 * T) * SCALE) };
    deco(floor, 0, 0, roomWidth, roomHeight, "rgb(222, 219, 208)");
    const wall = (x, y, w, h) => {
        const o = new Obstacle("rectangle", WALL_COLOR, x, y, w, h);
        o.outline = false;
        obstacles.push(o);
    };
    wall(0, 0, worldSize.width, T * SCALE);
    wall(0, worldSize.height - T * SCALE, worldSize.width, T * SCALE);
    wall(0, 0, T * SCALE, worldSize.height);
    wall(worldSize.width - T * SCALE, 0, T * SCALE, worldSize.height);

    // ---- shelf rows: identical geometry, only the tint varies ----
    const tintRng = rng(seed ^ 0x9E3779B9); // separate stream so tint never shifts the clutter
    const gap = 0.1, depth = 1.0;
    const rowX0 = (roomWidth - rowLength) / 2;
    const unitCount = Math.max(1, Math.floor((rowLength + gap) / (shelfUnitLength + gap)));
    const used = unitCount * shelfUnitLength + (unitCount - 1) * gap;
    const unitX0 = rowX0 + (rowLength - used) / 2; // leftover length is split between both row ends
    const rowY = r => NORTH_CLEARANCE + r * (depth + aisleWidth);
    for (let r = 0; r < rowCount; r++) {
        for (let u = 0; u < unitCount; u++) {
            const color = hsla(208 + (tintRng() - 0.5) * 10, 38 + tintRng() * 10, 46 + (tintRng() - 0.5) * 8);
            const ux = unitX0 + u * (shelfUnitLength + gap), uy = rowY(r);
            rect(ux, uy, shelfUnitLength, depth, color);
            // cartons seen from above: random sizes, colors and a few empty slots
            for (let k = 0; k < 3; k++) {
                if (tintRng() < 0.15) continue;
                const cw = 0.45 + tintRng() * 0.2, ch = 0.4 + tintRng() * 0.3;
                deco(overlay, ux + 0.1 + k * (shelfUnitLength - 0.2) / 3 + tintRng() * 0.05, uy + 0.1 + tintRng() * (depth - 0.2 - ch),
                    cw, ch, hsla(25 + tintRng() * 25, 45 + tintRng() * 20, 55 + tintRng() * 15, 0.95));
            }
        }
    }
    const blockBottom = rowY(rowCount - 1) + depth;

    // dashed yellow guide lines down the middle of every aisle, a solid one down each cross aisle
    const aisleCenters = [NORTH_CLEARANCE / 2];
    for (let r = 1; r < rowCount; r++) aisleCenters.push(rowY(r) - aisleWidth / 2);
    for (const cy of aisleCenters)
        for (let x = rowX0; x < rowX0 + rowLength - 0.5; x += 1.0) deco(floor, x, cy - 0.06, 0.5, 0.12, "rgba(235, 190, 40, 0.8)");
    for (const cx of [rowX0 / 2, roomWidth - rowX0 / 2]) deco(floor, cx - 0.06, 0.5, 0.12, roomHeight - 1, "rgba(235, 190, 40, 0.55)");

    // ---- loading dock: fixed irregular cluster in the south-east corner ----
    // (ex, ey) = gap to the east / south wall, then size. Crates are bigger than pallets.
    const nearCorner = (ex, ey, w, h, color, movable) => rect(roomWidth - ex - w, roomHeight - ey - h, w, h, color, movable);
    const crate = (ex, ey, w, h) => nearCorner(ex, ey, w, h, hsla(32, 55, 52 + ((ex * 7 + ey * 3) % 5)), false); // heavy: stays put, the dock landmark
    const pallet = (ex, ey, w, h) => nearCorner(ex, ey, w, h, hsla(28, 45, 40 + ((ex * 5 + ey * 11) % 6)), true);
    // dock floor, yellow/black hazard band along its edge, and loading doors in the south wall
    const dockX = roomWidth - 8.5, dockY = roomHeight - DOCK_DEPTH - 0.5;
    deco(floor, dockX, dockY, 8.5, DOCK_DEPTH + 0.5, "rgb(186, 198, 210)");
    for (let i = 0; i < 17; i++) deco(floor, dockX + i * 0.5, dockY - 0.3, 0.5, 0.3, i % 2 ? "rgb(40, 40, 40)" : "rgb(240, 190, 30)");
    for (let i = 0; i < 3; i++) deco(overlay, dockX + 0.8 + i * 2.6, roomHeight, 2.0, T, "rgb(60, 90, 130)");
    crate(0.5, 0.5, 2.2, 1.6);
    crate(0.5, 2.6, 1.8, 1.8);
    crate(2.9, 3.0, 1.4, 1.4);
    pallet(3.2, 0.5, PALLET.w, PALLET.h);
    pallet(4.3, 0.7, PALLET.w, PALLET.h);
    pallet(3.4, 1.9, PALLET.h, PALLET.w);
    pallet(5.8, 0.5, PALLET.w, PALLET.h);
    pallet(5.5, 2.3, PALLET.h, PALLET.w);

    // ---- default spawn: east cross aisle, just north of the dock ----
    const defaultSpawn = { x: roomWidth - (roomWidth - rowLength) / 4, y: blockBottom - 1, angle: -Math.PI / 2 };
    const spawnClear = s => {
        const probe = { x: px(s.x), y: px(s.y), angle: s.angle ?? 0, width: robot.width, height: robot.height };
        return s.x > 0 && s.y > 0 && s.x < roomWidth && s.y < roomHeight
            && !obstacles.some(o => o.checkCollision(probe));
    };
    let start = spawn ? { angle: 0, ...spawn } : defaultSpawn;

    // ---- seeded clutter: pallets / boxes hugging shelves, never pinching an aisle ----
    const rand = rng(seed);
    const count = Math.round(Math.max(0, Math.min(1, clutterAmount)) * 12);
    // north strip (wall to row 0) plus the aisle above each further row
    const aisles = [{ y: 0, h: NORTH_CLEARANCE }];
    for (let r = 1; r < rowCount; r++) aisles.push({ y: rowY(r) - aisleWidth, h: aisleWidth });
    const placed = [];
    const zones = [{ x: start.x, y: start.y }, { x: defaultSpawn.x, y: defaultSpawn.y }];
    for (let n = 0, tries = 0; n < count && tries < count * 40; tries++) {
        const west = rand() < 0.2; // a few against the west wall, in the cross aisle
        const isBox = rand() < 0.3;
        const w = isBox ? 0.9 : PALLET.h, h = isBox ? 0.9 : PALLET.w; // w along the aisle
        const color = isBox ? hsla(36, 50, 58 + rand() * 6) : hsla(28, 45, 38 + rand() * 6);
        let x, y, lane;
        if (west) {
            x = 0.2 + rand() * 0.4;
            y = 1 + rand() * (roomHeight - 2 - h);
            lane = -1;
        } else {
            const i = Math.floor(rand() * aisles.length);
            const a = aisles[i];
            x = rowX0 + 1.5 + rand() * (rowLength - 3 - w);
            // hug the shelf above or below, a little off its face
            const hugTop = rand() < 0.5;
            const off = 0.05 + rand() * 0.2;
            y = hugTop ? a.y + off : a.y + a.h - off - h;
            lane = i;
        }
        const ok = placed.every(p => p.lane !== lane || Math.abs(p.x - x) >= MIN_PALLET_SPACING)
            && zones.every(z => Math.hypot(z.x - (x + w / 2), z.y - (y + h / 2)) > 2.5);
        if (!ok) continue;
        placed.push({ x, lane });
        rect(x, y, w, h, color, true);
        n++;
    }

    // ---- walking people: self-moving circles patrolling the west and the east-upper cross aisle ----
    const lanes = [
        [{ x: rowX0 / 2 + 1.2, y: 2 }, { x: rowX0 / 2 + 1.2, y: roomHeight - 2 }],
        [{ x: roomWidth - rowX0 / 2 - 1.2, y: 1.5 }, { x: roomWidth - rowX0 / 2 - 1.2, y: blockBottom - 4 }],
    ];
    for (let i = 0; i < Math.min(Math.max(0, workerCount), lanes.length); i++) {
        const pts = lanes[i].map(p => ({ x: px(p.x), y: px(p.y) }));
        const a = rand() * 0.8 + 0.1; // start somewhere along the lane
        const w = new Obstacle("circle", "rgba(230, 120, 60, 0.9)",
            pts[0].x + (pts[1].x - pts[0].x) * a, pts[0].y + (pts[1].y - pts[0].y) * a, 0.3 * SCALE);
        w.outline = false;
        w.behavior = patrol(pts, 0.9 * SCALE, 1);
        obstacles.push(w);
    }

    if (!spawnClear(start)) {
        if (spawn) warn(`spawn (${start.x}, ${start.y}) is blocked or outside the room; using the default spawn`);
        start = defaultSpawn;
    }
    return {
        obstacles,
        start: { x: px(start.x), y: px(start.y), angle: start.angle },
        worldSize,
        floor,
        outline: overlay,
        warnings,
        params: { rowCount, rowLength, aisleWidth, shelfUnitLength, clutterAmount, seed, roomWidth, roomHeight },
    };
}
