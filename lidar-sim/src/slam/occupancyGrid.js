// SLAM front end: turns the keyframes of the back end (slam.js) into an occupancy grid map.
//
// Every cell holds the log-odds that it's occupied. A lidar ray makes the cells it passes
// through a bit more likely free and the cell it ends in more likely occupied. Log-odds just
// add up, and clamping them means a person who walked away gets erased again eventually.
//
// The grid is split into tiles that are only created where the robot has been, so it can grow
// in any direction (a drifted estimate can leave the world). Each tile caches an image of itself
// and only redraws it when one of its cells changed.
//
// After a loop closure the keyframe poses move, so the whole map is built again from scratch.
// That happens in the background, a few keyframes per frame, and the old map stays on screen
// until the new one is done.

const TILE = 64;           // cells per tile side
const LOG_HIT = 0.9;       // added to the cell a ray ends in
const LOG_MISS = -0.4;     // added to every cell a ray passes through
const LOG_MIN = -2;        // clamped, so the map can still change its mind
const LOG_MAX = 3.5;
const KNOWN = 0.5;         // |log-odds| above this counts as mapped
const KEYFRAMES_PER_FRAME = 12;

const FREE_RGB = [255, 255, 255];
const WALL_RGB = [25, 25, 35];

export class OccupancyGrid {
    constructor(cellSize) {
        this.cell = cellSize;  // m
        this.tiles = new Map();
        this.known = 0;        // cells that are clearly free or occupied
    }

    tileAt(tx, ty, create) {
        const key = `${tx},${ty}`;
        let tile = this.tiles.get(key);
        if (!tile && create) {
            tile = { tx, ty, cells: new Float32Array(TILE * TILE), dirty: true, canvas: null };
            this.tiles.set(key, tile);
        }
        return tile;
    }

    get(cx, cy) {
        const tile = this.tileAt(Math.floor(cx / TILE), Math.floor(cy / TILE), false);
        if (!tile) return 0;
        return tile.cells[(cy - tile.ty * TILE) * TILE + (cx - tile.tx * TILE)];
    }

    add(cx, cy, amount) {
        const tile = this.tileAt(Math.floor(cx / TILE), Math.floor(cy / TILE), true);
        const i = (cy - tile.ty * TILE) * TILE + (cx - tile.tx * TILE);
        const before = tile.cells[i];
        const after = Math.min(Math.max(before + amount, LOG_MIN), LOG_MAX);
        if (after === before) return;
        tile.cells[i] = after;
        tile.dirty = true;
        const wasKnown = Math.abs(before) > KNOWN, isKnown = Math.abs(after) > KNOWN;
        if (wasKnown !== isKnown) this.known += isKnown ? 1 : -1;
    }

    // one lidar ray from (x0, y0) to (x1, y1), in meters. Bresenham's line through the cells.
    ray(x0, y0, x1, y1, hit) {
        let cx = Math.floor(x0 / this.cell), cy = Math.floor(y0 / this.cell);
        const ex = Math.floor(x1 / this.cell), ey = Math.floor(y1 / this.cell);
        const dx = Math.abs(ex - cx), dy = -Math.abs(ey - cy);
        const sx = cx < ex ? 1 : -1, sy = cy < ey ? 1 : -1;
        let err = dx + dy;
        while (cx !== ex || cy !== ey) {
            this.add(cx, cy, LOG_MISS);
            const e2 = 2 * err;
            if (e2 >= dy) { err += dy; cx += sx; }
            if (e2 <= dx) { err += dx; cy += sy; }
        }
        this.add(ex, ey, hit ? LOG_HIT : LOG_MISS);
    }

    addKeyframe(slam, kf) {
        for (const r of kf.rays) {
            const from = slam.toWorld(kf, { x: r.ox, y: r.oy });
            const to = slam.toWorld(kf, r);
            this.ray(from.x, from.y, to.x, to.y, r.hit);
        }
    }

    // m² of floor and walls that are mapped
    area() {
        return this.known * this.cell * this.cell;
    }

    renderTile(tile) {
        if (!tile.canvas) {
            tile.canvas = document.createElement("canvas");
            tile.canvas.width = tile.canvas.height = TILE;
        }
        const ctx = tile.canvas.getContext("2d");
        const img = ctx.createImageData(TILE, TILE);
        for (let i = 0; i < tile.cells.length; i++) {
            const l = tile.cells[i];
            if (Math.abs(l) <= KNOWN) continue; // unknown stays transparent
            const rgb = l > 0 ? WALL_RGB : FREE_RGB;
            const limit = l > 0 ? LOG_MAX : -LOG_MIN;
            img.data[i * 4] = rgb[0];
            img.data[i * 4 + 1] = rgb[1];
            img.data[i * 4 + 2] = rgb[2];
            img.data[i * 4 + 3] = 255 * Math.min(Math.abs(l) / limit + 0.3, 1);
        }
        ctx.putImageData(img, 0, 0);
        tile.dirty = false;
    }

    // draws the map in world px; scale is px per meter
    draw(ctx, scale, opacity = 1) {
        const size = TILE * this.cell * scale;
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.imageSmoothingEnabled = false;
        for (const tile of this.tiles.values()) {
            if (tile.dirty) this.renderTile(tile);
            // a hair of overlap hides the seams between tiles at odd zoom levels
            ctx.drawImage(tile.canvas, tile.tx * size, tile.ty * size, size + 0.5, size + 0.5);
        }
        ctx.restore();
    }

    // The whole map as an image, one pixel per cell, gray where nothing is known
    // (the usual look of a robot map), or null while it's still empty.
    toCanvas() {
        if (!this.tiles.size) return null;
        const tiles = [...this.tiles.values()];
        const minX = Math.min(...tiles.map(t => t.tx)), maxX = Math.max(...tiles.map(t => t.tx));
        const minY = Math.min(...tiles.map(t => t.ty)), maxY = Math.max(...tiles.map(t => t.ty));
        const canvas = document.createElement("canvas");
        canvas.width = (maxX - minX + 1) * TILE;
        canvas.height = (maxY - minY + 1) * TILE;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#b4b4b4";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        for (const tile of tiles) {
            if (tile.dirty) this.renderTile(tile);
            ctx.drawImage(tile.canvas, (tile.tx - minX) * TILE, (tile.ty - minY) * TILE);
        }
        return canvas;
    }
}

// Keeps a grid in step with the SLAM back end. The UI changes cellSize, opacity and layers.
export const mapping = {
    cellSize: 0.05,  // m
    opacity: 1,
    layers: { map: true, estimate: true, graph: false, points: false },

    grid: new OccupancyGrid(0.05),
    done: 0,         // keyframes already in the grid
    rebuild: null,   // { grid, done } being built in the background
    revision: null,  // slam.revision the grid was built for

    setCellSize(m) {
        this.cellSize = m;
        this.revision = null; // forces a rebuild
    },

    rebuilding() {
        return this.rebuild !== null;
    },

    update(slam) {
        const keyframes = slam.keyframes;
        if (slam.revision !== this.revision) {
            this.revision = slam.revision;
            this.rebuild = { grid: new OccupancyGrid(this.cellSize), done: 0 };
        }
        let budget = KEYFRAMES_PER_FRAME;
        if (this.rebuild) {
            const next = this.rebuild;
            while (budget > 0 && next.done < keyframes.length) {
                next.grid.addKeyframe(slam, keyframes[next.done++]);
                budget--;
            }
            if (next.done < keyframes.length) return;
            this.grid = next.grid;
            this.done = next.done;
            this.rebuild = null;
        }
        // new keyframes on top of an up to date map just get added
        while (budget > 0 && this.done < keyframes.length) {
            this.grid.addKeyframe(slam, keyframes[this.done++]);
            budget--;
        }
    },

    draw(ctx, scale) {
        if (this.layers.map) this.grid.draw(ctx, scale, this.opacity);
    },
};
