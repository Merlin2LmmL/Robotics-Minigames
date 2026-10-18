import { generateMaze } from "./maze.js";
import { map as floorplanMap, worldSize as floorplanSize, outline as floorplanOutline } from "./floorplan.js";

// outline is cosmetic: grey with no red stroke, drawn but never collided with
for (const o of floorplanOutline) o.outline = false;

// 8 × 9 cells of 120px fills the 960 × 1080 world exactly.
const maze = generateMaze({
    cols: 8,
    rows: 9,
    cellSize: 120,
    wallThickness: 12,
    color: "rgba(90, 90, 90, 0.8)",
});

// Selectable maps, keyed by the value of document.body.dataset.map
export const maps = {
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
