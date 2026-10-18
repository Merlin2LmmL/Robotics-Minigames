import { generateMaze } from "./maze.js";
import { generateWarehouse } from "./warehouse.js";
import { sandbox } from "./sandbox.js";
import { map as floorplanMap, worldSize as floorplanSize, outline as floorplanOutline } from "./floorplan.js";

for (const o of floorplanOutline) o.outline = false;

// 8 × 9 cells of 120px fills the 960 × 1080 world exactly.
const maze = generateMaze({
    cols: 8,
    rows: 9,
    cellSize: 120,
    wallThickness: 12,
    color: "rgba(90, 90, 90, 0.8)",
});

const maps = {
    maze: {
        obstacles: maze.obstacles,
        start: maze.start,
        worldSize: { width: 960, height: 1080 },
    },
    floorplan: {
        obstacles: floorplanMap.obstacles,
        start: floorplanMap.start,
        worldSize: floorplanSize,
        outline: floorplanOutline,
    },
};

// Selectable environments, keyed by the value of document.body.dataset.map.
// build(params) returns { obstacles, start, worldSize, outline? }.
export const environments = [
    { id: "maze", name: "Maze", description: "A random perfect maze with no loops.", build: () => maps.maze },
    { id: "floorplan", name: "Floorplan", description: "A fixed map of rooms and walls.", build: () => maps.floorplan },
    {
        id: "warehouse",
        name: "Warehouse",
        description: "Identical shelf rows. Hard for SLAM because every aisle looks the same.",
        build: params => generateWarehouse(params),
    },
    {
        id: "sandbox",
        name: "Sandbox",
        description: "A map of your own. Build it with the editor, or import a map file.",
        build: () => sandbox.play(),
    },
];

export function buildMap(id, params = {}) {
    const env = environments.find(e => e.id === id) ?? environments[0];
    return env.build(params);
}

// URL query -> build params (unknown keys ignored)
export function paramsFromQuery(search) {
    const q = new URLSearchParams(search), params = {};
    for (const k of ["rowCount", "rowLength", "aisleWidth", "shelfUnitLength", "clutterAmount", "workerCount"]) {
        const v = parseFloat(q.get(k));
        if (Number.isFinite(v)) params[k] = v;
    }
    const sp = (q.get("spawn") ?? "").split(",").map(parseFloat);
    if (sp.length >= 2 && sp.slice(0, 2).every(Number.isFinite)) {
        params.spawn = { x: sp[0], y: sp[1], angle: Number.isFinite(sp[2]) ? sp[2] : 0 };
    }
    return params;
}
