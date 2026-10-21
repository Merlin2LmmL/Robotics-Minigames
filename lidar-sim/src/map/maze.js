import { Obstacle } from "./obstacle.js";

const DIRS = [
    { dc: 0, dr: -1, from: "n", to: "s" },
    { dc: 1, dr: 0, from: "e", to: "w" },
    { dc: 0, dr: 1, from: "s", to: "n" },
    { dc: -1, dr: 0, from: "w", to: "e" },
];

// Recursive-backtracker maze: every cell is reachable and there are no loops.
// Returns solid wall rectangles plus a start point at the centre of the top-left cell.
export function generateMaze({ cols, rows, cellSize, wallThickness, color }) {
    const open = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => ({ n: false, e: false, s: false, w: false })));
    const visited = Array.from({ length: rows }, () => Array(cols).fill(false));

    const stack = [{ c: 0, r: 0 }];
    visited[0][0] = true;
    while (stack.length) {
        const cur = stack[stack.length - 1];
        const options = DIRS.filter(d => {
            const nc = cur.c + d.dc, nr = cur.r + d.dr;
            return nc >= 0 && nc < cols && nr >= 0 && nr < rows && !visited[nr][nc];
        });
        if (options.length === 0) {
            stack.pop();
            continue;
        }
        const d = options[Math.floor(Math.random() * options.length)];
        const nc = cur.c + d.dc, nr = cur.r + d.dr;
        open[cur.r][cur.c][d.from] = true;
        open[nr][nc][d.to] = true;
        visited[nr][nc] = true;
        stack.push({ c: nc, r: nr });
    }

    const t = wallThickness, half = t / 2;
    const obstacles = [];

    // horizontal wall segments along grid line y = r
    for (let r = 0; r <= rows; r++) {
        for (let c = 0; c < cols; c++) {
            const solid = r === 0 || r === rows || !open[r - 1][c].s;
            if (solid) {
                obstacles.push(new Obstacle("rectangle", color,
                    c * cellSize - half, r * cellSize - half, cellSize + t, t));
            }
        }
    }

    // vertical wall segments along grid line x = c
    for (let c = 0; c <= cols; c++) {
        for (let r = 0; r < rows; r++) {
            const solid = c === 0 || c === cols || !open[r][c - 1].e;
            if (solid) {
                obstacles.push(new Obstacle("rectangle", color,
                    c * cellSize - half, r * cellSize - half, t, cellSize + t));
            }
        }
    }

    return { obstacles, start: { x: cellSize / 2, y: cellSize / 2 } };
}
