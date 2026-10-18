import { Obstacle } from "./obstacle.js";
import { patrol } from "./movers.js";

// Map file format: plain JSON, shared by import, export and the localStorage autosave.
// { format, version, name, worldSize: {width, height}, start: {x, y, angle},
//   obstacles: [...], floor?: [...], overlay?: [...] }
// Each obstacle: { shape, color, <geometry>, movable?, pushResistance?, outline?,
//   patrol?: { waypoints: [{x, y}], speed, startAt } }. Units are world px.
export const FORMAT = "lidar-sim-map";
export const VERSION = 1;
export const WALL_COLOR = "rgba(90, 90, 90, 0.8)";
const STORAGE_KEY = "lidar-sim.sandbox";

const r2 = v => Math.round(v * 100) / 100;

function obstacleToJSON(o) {
    const out = { shape: o.shape, color: o.color };
    switch (o.shape) {
        case "rectangle": Object.assign(out, { x: r2(o.x), y: r2(o.y), width: r2(o.width), height: r2(o.height) }); break;
        case "circle": Object.assign(out, { x: r2(o.x), y: r2(o.y), radius: r2(o.radius) }); break;
        case "polygon": out.points = o.points.map(p => ({ x: r2(p.x), y: r2(p.y) })); break;
        case "line": Object.assign(out, { x1: r2(o.x1), y1: r2(o.y1), x2: r2(o.x2), y2: r2(o.y2) }); break;
    }
    if (o.movable) out.movable = true;
    if (o.pushResistance !== 0.5) out.pushResistance = o.pushResistance;
    if (o.outline === false) out.outline = false;
    if (o.patrolRoute) {
        const { waypoints, speed, startAt = 0 } = o.patrolRoute;
        out.patrol = { waypoints: waypoints.map(p => ({ x: r2(p.x), y: r2(p.y) })), speed: r2(speed), startAt };
    }
    return out;
}

function num(v, what) {
    if (!Number.isFinite(v)) throw new Error(`${what} must be a number`);
    return v;
}

function point(p, what) {
    if (!p || typeof p !== "object") throw new Error(`${what} must be a point {x, y}`);
    return { x: num(p.x, `${what}.x`), y: num(p.y, `${what}.y`) };
}

// Gives an obstacle the patrol behavior; patrolRoute is kept so the route can be edited and saved.
export function setPatrol(o, waypoints, speed, startAt = 0) {
    o.patrolRoute = { waypoints, speed, startAt };
    o.behavior = patrol(waypoints.map(p => ({ ...p })), speed, startAt);
}

function obstacleFromJSON(d, where) {
    if (!d || typeof d !== "object") throw new Error(`${where} must be an object`);
    const color = typeof d.color === "string" ? d.color : WALL_COLOR;
    let o;
    switch (d.shape) {
        case "rectangle":
            o = new Obstacle("rectangle", color, num(d.x, `${where}.x`), num(d.y, `${where}.y`),
                Math.abs(num(d.width, `${where}.width`)), Math.abs(num(d.height, `${where}.height`)));
            break;
        case "circle":
            o = new Obstacle("circle", color, num(d.x, `${where}.x`), num(d.y, `${where}.y`),
                Math.abs(num(d.radius, `${where}.radius`)));
            break;
        case "polygon":
            if (!Array.isArray(d.points) || d.points.length < 3) throw new Error(`${where}.points needs at least 3 points`);
            o = new Obstacle("polygon", color, d.points.map((p, i) => point(p, `${where}.points[${i}]`)));
            break;
        case "line":
            o = new Obstacle("line", color, num(d.x1, `${where}.x1`), num(d.y1, `${where}.y1`),
                num(d.x2, `${where}.x2`), num(d.y2, `${where}.y2`));
            break;
        default:
            throw new Error(`${where} has unknown shape "${d.shape}"`);
    }
    if (d.outline === false) o.outline = false;
    if (d.movable && o.probe()) o.movable = true;
    if (Number.isFinite(d.pushResistance)) o.pushResistance = Math.min(Math.max(d.pushResistance, 0), 1);
    if (d.patrol) {
        const wp = d.patrol.waypoints;
        if (!Array.isArray(wp) || wp.length < 2) throw new Error(`${where}.patrol.waypoints needs at least 2 points`);
        const startAt = Number.isInteger(d.patrol.startAt) ? Math.max(0, d.patrol.startAt) : 0;
        setPatrol(o, wp.map((p, i) => point(p, `${where}.patrol.waypoints[${i}]`)),
            Math.abs(num(d.patrol.speed, `${where}.patrol.speed`)), startAt);
    }
    return o;
}

export function serializeMap(map, name = map.name ?? "") {
    const out = {
        format: FORMAT,
        version: VERSION,
        name,
        worldSize: { width: r2(map.worldSize.width), height: r2(map.worldSize.height) },
        start: { x: r2(map.start.x), y: r2(map.start.y), angle: Math.round((map.start.angle ?? 0) * 1e4) / 1e4 },
        obstacles: map.obstacles.map(obstacleToJSON),
    };
    if (map.floor?.length) out.floor = map.floor.map(obstacleToJSON);
    if (map.outline?.length) out.overlay = map.outline.map(obstacleToJSON);
    return out;
}

// Validates a parsed map file and returns a ready to use map. Throws an Error with a readable message.
export function deserializeMap(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not a map file");
    if (data.format !== undefined && data.format !== FORMAT) throw new Error(`unknown format "${data.format}"`);
    if (Number.isFinite(data.version) && data.version > VERSION) throw new Error(`file version ${data.version} is newer than this simulator`);
    const width = num(data.worldSize?.width, "worldSize.width");
    const height = num(data.worldSize?.height, "worldSize.height");
    if (width <= 0 || height <= 0) throw new Error("worldSize must be positive");
    if (!Array.isArray(data.obstacles)) throw new Error("obstacles must be a list");
    const list = (arr, key) => {
        if (arr === undefined) return [];
        if (!Array.isArray(arr)) throw new Error(`${key} must be a list`);
        return arr.map((d, i) => obstacleFromJSON(d, `${key}[${i}]`));
    };
    const start = data.start
        ? { ...point(data.start, "start"), angle: Number.isFinite(data.start.angle) ? data.start.angle : 0 }
        : { x: width / 2, y: height / 2, angle: 0 };
    return {
        name: typeof data.name === "string" ? data.name : "",
        worldSize: { width, height },
        start,
        obstacles: list(data.obstacles, "obstacles"),
        floor: list(data.floor, "floor"),
        outline: list(data.overlay, "overlay"),
    };
}

// Four rectangles lining the inside of the world edge.
export function borderWalls({ width, height }, t = 12, color = WALL_COLOR) {
    return [
        new Obstacle("rectangle", color, 0, 0, width, t),
        new Obstacle("rectangle", color, 0, height - t, width, t),
        new Obstacle("rectangle", color, 0, 0, t, height),
        new Obstacle("rectangle", color, width - t, 0, t, height),
    ];
}

export function emptyMap(width = 960, height = 1080) {
    const worldSize = { width, height };
    return {
        name: "sandbox",
        worldSize,
        start: { x: width / 2, y: height / 2, angle: -Math.PI / 2 },
        obstacles: borderWalls(worldSize),
        floor: [],
        outline: [],
    };
}

function loadSaved() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved ? deserializeMap(JSON.parse(saved)) : null;
    } catch (err) {
        console.warn("[sandbox] saved map ignored:", err);
        return null;
    }
}

// design: the map being edited (live objects, never simulated).
// play() hands out a fresh copy, so pushing and walking never change the design.
export const sandbox = {
    design: loadSaved() ?? emptyMap(),
    save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeMap(this.design)));
        } catch (err) {
            console.warn("[sandbox] could not save:", err);
        }
    },
    play() {
        return deserializeMap(serializeMap(this.design));
    },
};
