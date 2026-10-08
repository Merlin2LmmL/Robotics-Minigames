import { GRIDSIZE, isWall } from "./map.js";
import { generateSprites } from "./sprites.js";
import { setupKeyListener } from "./control.js";

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const TICK_MS = 500;
let sinceTick = 0;

const sprites = generateSprites(ctx);
const player = sprites.find(s => s.kind === "pacman");
const dir = { val: "right" };
setupKeyListener(dir);

export const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function tick() {
    player.dir = dir.val;
    for (const s of sprites) {
        if (s.isStatic) continue;
        const [newX, newY] = [s.x, s.y].map((val, i) => val + STEP[s.dir][i] || 0);
        if (!isWall(newX, newY)) {
            s.prevX = s.x;
            s.prevY = s.y;
            s.x = newX;
            s.y = newY;
        }
    }
}

function drawSprite(s, t) {
    const px = (s.prevX + (s.x - s.prevX) * t) * GRIDSIZE + GRIDSIZE / 2;
    const py = (s.prevY + (s.y - s.prevY) * t) * GRIDSIZE + GRIDSIZE / 2;
    const r = (GRIDSIZE / 2 - 2) * (s.scale || 1);
    ctx.fillStyle = s.color;
    s.shape(ctx, px, py, r, s, t);
}

function update(delta) {
    sinceTick += delta;
    while (sinceTick >= TICK_MS) {
        sinceTick -= TICK_MS;
        tick();
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const t = sinceTick / TICK_MS;
    for (const s of sprites) {
        drawSprite(s, t);
    }
}

let last = 0;
function frame(now) {
    const delta = now - last;
    last = now;
    update(delta);
    draw();
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);