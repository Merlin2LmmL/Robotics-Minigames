import { generateMaze } from "./maze.js";

// 8 × 9 cells of 120px fills the 960 × 1080 world exactly.
const maze = generateMaze({
    cols: 8,
    rows: 9,
    cellSize: 120,
    wallThickness: 12,
    color: "rgba(90, 90, 90, 0.8)",
});

export const map = {
    obstacles: maze.obstacles,
    start: maze.start,
};
