import { GRIDSIZE, MAP } from "./map.js";
import { shapes } from "./shapes.js";

export function createSprite(x, y, kind, color, isStatic = false, shape = shapes[kind]) {
    if (!shape) throw new Error(`unknown sprite kind: ${kind}`);
    return {
        x,
        y,
        prevX: x,
        prevY: y,
        dir: "right",
        kind,
        color,
        shape,
        scale: 1,
        isStatic
    };
}

export function generateSprites(ctx) {
    return [
        createSprite(13, 23, "pacman", "yellow"),
        createSprite(13, 11, "ghost", "red"),
        createSprite(13, 14, "ghost", "pink"),
        createSprite(11, 14, "ghost", "cyan"),
        createSprite(15, 14, "ghost", "orange"),

        ...generateLevelSprites()
    ];
}

function generateLevelSprites() {
    const level = [];
    for (let y = 0; y < MAP.length; y++) {
        for (let x = 0; x < MAP[y].length; x++) {
            const ch = MAP[y][x];
            if (ch === "#") level.push(createSprite(x, y, "wall", "#1a2a8a", true));
            else if (ch === ".") level.push(createSprite(x, y, "dot", "#ffd9a0", true));
            else if (ch === "o") level.push(createSprite(x, y, "pellet", "#ffd9a0", true));
        }
    }
    return level;
}