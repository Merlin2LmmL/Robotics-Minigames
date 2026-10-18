import { Obstacle } from "./map/obstacle.js";
import { environments } from "./map/map.js";
import { sandbox, serializeMap, deserializeMap, borderWalls, setPatrol, WALL_COLOR } from "./map/sandbox.js";

// Sandbox map editor. Edits sandbox.design in place; main.js draws the design (instead of
// simulating a map) while document.body.dataset.editor is "on".

const HANDLE_PX = 5;        // handle half-size on screen, CSS px
const PICK_PX = 6;          // click tolerance on screen, CSS px
const MIN_SIZE = 2;         // smallest shape, world px
const HISTORY_LIMIT = 60;
const DOUBLE_CLICK_MS = 400;
const PERSON_RADIUS = 12;
const PERSON_SPEED = 36;    // px/s, about walking pace at the warehouse scale
const PERSON_COLOR = "rgba(230, 120, 60, 0.9)";
const SELECT_COLOR = "rgba(30, 110, 230, 1)";
const ROUTE_COLOR = "rgba(230, 120, 60, 1)";

const TOOL_HINTS = {
    select: "Click a shape to select it and drag to move it. Drag the square handles to resize, the round ones to change a walking route. Drag empty space to pan.",
    rectangle: "Drag to draw a rectangle.",
    circle: "Drag from the centre outwards.",
    wall: "Drag from one end of the wall to the other.",
    polygon: "Click to place corners. Click the first corner, double-click or press Enter to close the shape. Concave shapes collide as if they were convex.",
    person: "Click to place a standing person, or drag to make one walk back and forth between two points.",
    start: "Click to place the robot, drag to aim it.",
    erase: "Click or drag over shapes to delete them.",
};

const el = id => document.getElementById(id);
const canvas = el("board");
const ui = {
    toggle: el("editor-btn"),
    copy: el("editor-copy"),
    tools: el("editor-tools"),
    toolButtons: [...document.querySelectorAll("#editor-tools [data-tool]")],
    hint: el("editor-hint"),
    status: el("editor-status"),
    color: el("editor-color"),
    movable: el("editor-movable"),
    del: el("editor-delete"),
    undo: el("editor-undo"),
    thickness: el("editor-thickness"),
    snap: el("editor-snap"),
    grid: el("editor-grid"),
    width: el("editor-width"),
    height: el("editor-height"),
    border: el("editor-border"),
    clear: el("editor-clear"),
    name: el("editor-name"),
    exportBtn: el("editor-export"),
    importBtn: el("editor-import"),
    file: el("editor-file"),
    mapSelect: el("map-select"),
};

export const editor = {
    view: new DOMMatrix(),  // world -> canvas px, written by main.js every frame
    pan: { x: 0, y: 0 },    // camera offset from the world centre while editing
    currentMap: null,       // last map main.js loaded for driving
    currentMapId: null,
    get active() { return document.body.dataset.editor === "on"; },
    draw,
};

let tool = "select";
let selected = null;
let drag = null;       // pointer gesture in progress
let polygon = [];      // corners placed so far by the polygon tool
let lastClick = 0;
let hover = null;      // pointer position in world coords
let colorEditing = false;
let newColor = WALL_COLOR;
let newMovable = false;
const history = [];

const design = () => sandbox.design;
const dpr = () => window.devicePixelRatio || 1;
const viewScale = () => Math.hypot(editor.view.a, editor.view.b) || 1;
const screenToWorld = cssPx => cssPx * dpr() / viewScale();
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function toWorld(e) {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left - canvas.clientLeft) * canvas.width / canvas.clientWidth;
    const y = (e.clientY - r.top - canvas.clientTop) * canvas.height / canvas.clientHeight;
    const p = editor.view.inverse().transformPoint(new DOMPoint(x, y));
    return { x: p.x, y: p.y };
}

function gridSize() {
    const g = parseFloat(ui.grid.value);
    return ui.snap.checked && g > 0 ? g : 0;
}

function snap(p) {
    const g = gridSize();
    return g ? { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g } : p;
}

function thickness() {
    return clamp(parseFloat(ui.thickness.value) || 12, 1, 200);
}

// ---- geometry ----

function distToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function insidePolygon(pts, p) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

function hitTest(o, p, tol) {
    switch (o.shape) {
        case "rectangle":
            return p.x >= o.x - tol && p.x <= o.x + o.width + tol && p.y >= o.y - tol && p.y <= o.y + o.height + tol;
        case "circle":
            return Math.hypot(p.x - o.x, p.y - o.y) <= o.radius + tol;
        case "polygon":
            return insidePolygon(o.points, p)
                || o.points.some((a, i) => distToSegment(p, a, o.points[(i + 1) % o.points.length]) <= tol);
        case "line":
            return distToSegment(p, { x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }) <= tol;
    }
    return false;
}

// topmost obstacle under p
function pick(p) {
    const tol = screenToWorld(PICK_PX), obs = design().obstacles;
    for (let i = obs.length - 1; i >= 0; i--) if (hitTest(obs[i], p, tol)) return obs[i];
    return null;
}

// the point a move snaps to the grid
function anchor(o) {
    switch (o.shape) {
        case "polygon": return o.points[0];
        case "line": return { x: o.x1, y: o.y1 };
        default: return { x: o.x, y: o.y };
    }
}

function moveBy(o, dx, dy) {
    o.translate(dx, dy);
    for (const w of o.patrolRoute?.waypoints ?? []) { w.x += dx; w.y += dy; }
}

// Drag handles of a shape: { x, y, round, drag(p) }. Built when a drag starts, so the
// rectangle's opposite corner is captured as the fixed point.
function handles(o) {
    const out = [];
    switch (o.shape) {
        case "rectangle":
            for (const [fx, fy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
                const ox = o.x + (1 - fx) * o.width, oy = o.y + (1 - fy) * o.height;
                out.push({
                    x: o.x + fx * o.width, y: o.y + fy * o.height,
                    drag: p => {
                        o.x = Math.min(p.x, ox); o.y = Math.min(p.y, oy);
                        o.width = Math.max(Math.abs(p.x - ox), MIN_SIZE);
                        o.height = Math.max(Math.abs(p.y - oy), MIN_SIZE);
                    },
                });
            }
            break;
        case "circle":
            out.push({ x: o.x + o.radius, y: o.y, drag: p => { o.radius = Math.max(Math.hypot(p.x - o.x, p.y - o.y), MIN_SIZE); } });
            break;
        case "polygon":
            for (const pt of o.points) out.push({ x: pt.x, y: pt.y, drag: p => { pt.x = p.x; pt.y = p.y; } });
            break;
        case "line":
            out.push({ x: o.x1, y: o.y1, drag: p => { o.x1 = p.x; o.y1 = p.y; } });
            out.push({ x: o.x2, y: o.y2, drag: p => { o.x2 = p.x; o.y2 = p.y; } });
            break;
    }
    for (const w of o.patrolRoute?.waypoints ?? [])
        out.push({ x: w.x, y: w.y, round: true, drag: p => { w.x = p.x; w.y = p.y; } });
    return out;
}

function wallPoints(a, b, t) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < MIN_SIZE) return null;
    // ends reach t/2 past both points so walls drawn corner to corner join without a notch
    const ux = (b.x - a.x) / len * t / 2, uy = (b.y - a.y) / len * t / 2;
    return [
        { x: a.x - ux - uy, y: a.y - uy + ux },
        { x: b.x + ux - uy, y: b.y + uy + ux },
        { x: b.x + ux + uy, y: b.y + uy - ux },
        { x: a.x - ux + uy, y: a.y - uy - ux },
    ];
}

function makePerson(a, b) {
    const o = new Obstacle("circle", PERSON_COLOR, a.x, a.y, PERSON_RADIUS);
    o.outline = false;
    if (b && Math.hypot(b.x - a.x, b.y - a.y) >= 2 * PERSON_RADIUS) setPatrol(o, [{ ...a }, { ...b }], PERSON_SPEED, 1);
    return o;
}

// shape the current tool would create for a drag from a to b
function draft(a, b) {
    switch (tool) {
        case "rectangle": {
            const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
            return w >= MIN_SIZE && h >= MIN_SIZE
                ? new Obstacle("rectangle", newColor, Math.min(a.x, b.x), Math.min(a.y, b.y), w, h) : null;
        }
        case "circle": {
            const r = Math.hypot(b.x - a.x, b.y - a.y);
            return r >= MIN_SIZE ? new Obstacle("circle", newColor, a.x, a.y, r) : null;
        }
        case "wall": {
            const pts = wallPoints(a, b, thickness());
            return pts && new Obstacle("polygon", newColor, pts);
        }
        case "person":
            return makePerson(a, b);
    }
    return null;
}

// ---- edits and history ----

function snapshot() {
    return JSON.stringify(serializeMap(design()));
}

function checkpoint() {
    history.push(snapshot());
    if (history.length > HISTORY_LIMIT) history.shift();
}

function dropCheckpointIfUnchanged() {
    if (history.length && history[history.length - 1] === snapshot()) history.pop();
}

function changed() {
    sandbox.save();
    syncUi();
}

function replaceDesign(map, record = true) {
    if (record) checkpoint();
    sandbox.design = map;
    selected = null;
    polygon = [];
    editor.pan = { x: 0, y: 0 };
    ui.name.value = map.name;
    changed();
}

function undo() {
    const s = history.pop();
    if (s) replaceDesign(deserializeMap(JSON.parse(s)), false);
}

function addObstacle(o) {
    o.movable = newMovable && o.probe() !== null;
    design().obstacles.push(o);
    selected = o;
}

function remove(o) {
    const obs = design().obstacles, i = obs.indexOf(o);
    if (i >= 0) obs.splice(i, 1);
    if (selected === o) selected = null;
}

function erase(p) {
    const o = pick(p);
    if (o) remove(o);
}

function deleteSelected() {
    if (!selected) return;
    checkpoint();
    remove(selected);
    changed();
}

function finishPolygon() {
    if (polygon.length >= 3) {
        checkpoint();
        addObstacle(new Obstacle("polygon", newColor, polygon));
        changed();
    }
    polygon = [];
}

function addPolygonPoint(p) {
    const tol = screenToWorld(PICK_PX), now = performance.now();
    const last = polygon[polygon.length - 1];
    const nearFirst = polygon.length >= 3 && Math.hypot(p.x - polygon[0].x, p.y - polygon[0].y) <= tol;
    const nearLast = last && Math.hypot(p.x - last.x, p.y - last.y) <= tol;
    const double = nearLast && now - lastClick < DOUBLE_CLICK_MS;
    lastClick = now;
    if (nearFirst || (double && polygon.length >= 3)) finishPolygon();
    else if (!nearLast) polygon.push(p);
}

// ---- pointer input ----

canvas.addEventListener("pointerdown", e => {
    if (!editor.active) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = toWorld(e);
    hover = p;
    const pan = { kind: "pan", cx: e.clientX, cy: e.clientY };
    if (e.button !== 0) { drag = pan; return; }

    switch (tool) {
        case "select": {
            const tol = screenToWorld(HANDLE_PX + 2);
            const h = selected && handles(selected).find(h => Math.abs(h.x - p.x) <= tol && Math.abs(h.y - p.y) <= tol);
            if (h) { checkpoint(); drag = { kind: "handle", h }; break; }
            selected = pick(p);
            if (selected) {
                checkpoint();
                const a = anchor(selected);
                drag = { kind: "move", o: selected, offX: p.x - a.x, offY: p.y - a.y };
            } else {
                drag = pan;
            }
            syncUi();
            break;
        }
        case "rectangle":
        case "circle":
        case "wall":
        case "person":
            drag = { kind: "create", a: snap(p), b: null };
            break;
        case "polygon":
            addPolygonPoint(snap(p));
            break;
        case "start": {
            checkpoint();
            const s = snap(p);
            design().start.x = s.x;
            design().start.y = s.y;
            drag = { kind: "start" };
            break;
        }
        case "erase":
            checkpoint();
            erase(p);
            drag = { kind: "erase" };
            break;
    }
});

canvas.addEventListener("pointermove", e => {
    if (!editor.active) return;
    const p = toWorld(e);
    hover = p;
    if (!drag) return;
    switch (drag.kind) {
        case "pan":
            editor.pan.x -= (e.clientX - drag.cx) * dpr() / viewScale();
            editor.pan.y -= (e.clientY - drag.cy) * dpr() / viewScale();
            drag.cx = e.clientX;
            drag.cy = e.clientY;
            break;
        case "handle":
            drag.h.drag(snap(p));
            break;
        case "move": {
            const a = anchor(drag.o), t = snap({ x: p.x - drag.offX, y: p.y - drag.offY });
            moveBy(drag.o, t.x - a.x, t.y - a.y);
            break;
        }
        case "create":
            drag.b = snap(p);
            break;
        case "start": {
            const s = design().start;
            if (Math.hypot(p.x - s.x, p.y - s.y) > screenToWorld(PICK_PX)) s.angle = Math.atan2(p.y - s.y, p.x - s.x);
            break;
        }
        case "erase":
            erase(p);
            break;
    }
});

function endDrag() {
    if (!drag) return;
    if (drag.kind === "create") {
        const o = drag.b ? draft(drag.a, drag.b) : tool === "person" ? makePerson(drag.a) : null;
        if (o) {
            checkpoint();
            addObstacle(o);
            changed();
        }
    } else if (drag.kind !== "pan") {
        dropCheckpointIfUnchanged();
        changed();
    }
    drag = null;
}

canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener("pointerleave", () => { if (!drag) hover = null; });
canvas.addEventListener("contextmenu", e => { if (editor.active) e.preventDefault(); });
canvas.addEventListener("wheel", e => {
    if (!editor.active) return;
    e.preventDefault();
    el(e.deltaY < 0 ? "zoom-in" : "zoom-out").click();
}, { passive: false });

addEventListener("keydown", e => {
    if (!editor.active || e.target.closest?.("input, select, textarea")) return;
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
        e.preventDefault();
        undo();
        return;
    }
    switch (e.key) {
        case "Delete":
        case "Backspace":
            if (selected) { e.preventDefault(); deleteSelected(); }
            break;
        case "Escape":
            polygon = [];
            selected = null;
            syncUi();
            break;
        case "Enter":
            finishPolygon();
            break;
    }
});

// ---- drawing (world coords, called by main.js after the map is drawn) ----

function outlinePath(ctx, o) {
    ctx.beginPath();
    switch (o.shape) {
        case "rectangle": ctx.rect(o.x, o.y, o.width, o.height); break;
        case "circle": ctx.arc(o.x, o.y, o.radius, 0, Math.PI * 2); break;
        case "polygon":
            ctx.moveTo(o.points[0].x, o.points[0].y);
            for (const p of o.points.slice(1)) ctx.lineTo(p.x, p.y);
            ctx.closePath();
            break;
        case "line": ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); break;
    }
}

function drawRoute(ctx, waypoints, lw) {
    ctx.strokeStyle = ROUTE_COLOR;
    ctx.lineWidth = 1.5 * lw;
    ctx.setLineDash([5 * lw, 4 * lw]);
    ctx.beginPath();
    waypoints.forEach((w, i) => i ? ctx.lineTo(w.x, w.y) : ctx.moveTo(w.x, w.y));
    ctx.stroke();
    ctx.setLineDash([]);
}

function draw(ctx) {
    const lw = dpr() / viewScale(); // one CSS px in world units
    const { width: W, height: H } = design().worldSize;
    ctx.save();

    const g = gridSize();
    if (g && g / lw >= 6) {
        ctx.strokeStyle = "rgba(0, 0, 0, 0.07)";
        ctx.lineWidth = lw;
        ctx.beginPath();
        for (let x = 0; x <= W; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
        for (let y = 0; y <= H; y += g) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
        ctx.stroke();
    }
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.lineWidth = lw;
    ctx.setLineDash([4 * lw, 4 * lw]);
    ctx.strokeRect(0, 0, W, H);
    ctx.setLineDash([]);

    // walking routes are always shown faintly, the selected one fully
    ctx.globalAlpha = 0.4;
    for (const o of design().obstacles) if (o.patrolRoute && o !== selected) drawRoute(ctx, o.patrolRoute.waypoints, lw);
    ctx.globalAlpha = 1;

    if (drag?.kind === "create" && drag.b) {
        const o = draft(drag.a, drag.b);
        if (o) {
            ctx.globalAlpha = 0.6;
            o.draw(ctx);
            if (o.patrolRoute) drawRoute(ctx, o.patrolRoute.waypoints, lw);
            ctx.globalAlpha = 1;
        }
    }

    if (polygon.length) {
        ctx.strokeStyle = SELECT_COLOR;
        ctx.lineWidth = 1.5 * lw;
        ctx.beginPath();
        polygon.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        if (hover) {
            const h = snap(hover);
            ctx.lineTo(h.x, h.y);
        }
        ctx.stroke();
        ctx.fillStyle = SELECT_COLOR;
        for (const p of polygon) ctx.fillRect(p.x - 2 * lw, p.y - 2 * lw, 4 * lw, 4 * lw);
    }

    if (selected) {
        if (selected.patrolRoute) drawRoute(ctx, selected.patrolRoute.waypoints, lw);
        outlinePath(ctx, selected);
        ctx.strokeStyle = SELECT_COLOR;
        ctx.lineWidth = 2 * lw;
        ctx.setLineDash([6 * lw, 4 * lw]);
        ctx.stroke();
        ctx.setLineDash([]);
        const r = HANDLE_PX * lw;
        for (const h of handles(selected)) {
            ctx.fillStyle = "white";
            ctx.strokeStyle = h.round ? ROUTE_COLOR : SELECT_COLOR;
            ctx.lineWidth = 1.5 * lw;
            ctx.beginPath();
            if (h.round) ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
            else ctx.rect(h.x - r, h.y - r, 2 * r, 2 * r);
            ctx.fill();
            ctx.stroke();
        }
    }
    ctx.restore();
}

// ---- side menu ----

const colorCtx = document.createElement("canvas").getContext("2d");

// any CSS color -> { hex, alpha }
function parseColor(c) {
    colorCtx.fillStyle = "#000000";
    colorCtx.fillStyle = c;
    const s = colorCtx.fillStyle;
    if (s[0] === "#") return { hex: s, alpha: 1 };
    const [r, g, b, a = 1] = s.match(/[\d.]+/g).map(Number);
    return { hex: "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join(""), alpha: a };
}

function status(msg) {
    ui.status.textContent = msg;
}

function syncUi() {
    const on = editor.active;
    ui.toggle.textContent = on ? "Editor: On" : "Editor: Off";
    ui.tools.hidden = !on;
    ui.copy.disabled = on;
    for (const b of ui.toolButtons) b.setAttribute("aria-pressed", String(b.dataset.tool === tool));
    ui.hint.textContent = TOOL_HINTS[tool];
    const o = selected;
    if (!colorEditing) ui.color.value = parseColor(o ? o.color : newColor).hex;
    ui.movable.checked = o ? o.movable : newMovable;
    ui.movable.disabled = o ? o.probe() === null : false;
    ui.del.disabled = !o;
    ui.undo.disabled = history.length === 0;
    const { width, height } = design().worldSize;
    if (document.activeElement !== ui.width) ui.width.value = Math.round(width);
    if (document.activeElement !== ui.height) ui.height.value = Math.round(height);
}

function switchMap(id) {
    if (ui.mapSelect.value === id) return;
    ui.mapSelect.value = id;
    ui.mapSelect.dispatchEvent(new Event("change"));
}

function setActive(on) {
    if (on) switchMap("sandbox");
    document.body.dataset.editor = on ? "on" : "off";
    drag = null;
    polygon = [];
    if (!on) selected = null;
    syncUi();
}

ui.toggle.addEventListener("click", () => setActive(!editor.active));

ui.mapSelect.addEventListener("change", () => {
    if (ui.mapSelect.value !== "sandbox" && editor.active) setActive(false);
});

ui.copy.addEventListener("click", () => {
    if (!editor.currentMap) return;
    const name = environments.find(e => e.id === editor.currentMapId)?.name ?? "map";
    replaceDesign(deserializeMap(serializeMap(editor.currentMap, `${name.toLowerCase()} copy`)));
    setActive(true);
    status(`Copied the ${name} map into the sandbox.`);
});

for (const b of ui.toolButtons) {
    b.addEventListener("click", () => {
        tool = b.dataset.tool;
        polygon = [];
        drag = null;
        status("");
        syncUi();
    });
}

ui.color.addEventListener("input", () => {
    const hex = ui.color.value;
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const color = `rgba(${r}, ${g}, ${b}, ${parseColor(selected ? selected.color : newColor).alpha})`;
    if (!selected) { newColor = color; return; }
    if (!colorEditing) { checkpoint(); colorEditing = true; }
    selected.color = color;
});
ui.color.addEventListener("change", () => {
    colorEditing = false;
    if (selected) changed();
});

ui.movable.addEventListener("change", () => {
    if (!selected) { newMovable = ui.movable.checked; return; }
    checkpoint();
    selected.movable = ui.movable.checked && selected.probe() !== null;
    changed();
});

ui.del.addEventListener("click", deleteSelected);
ui.undo.addEventListener("click", undo);
ui.snap.addEventListener("change", syncUi);

for (const input of [ui.width, ui.height]) {
    input.addEventListener("change", () => {
        const ws = design().worldSize;
        const v = clamp(Math.round(parseFloat(input.value)) || 0, 100, 20000);
        checkpoint();
        design().worldSize = input === ui.width ? { ...ws, width: v } : { ...ws, height: v };
        changed();
    });
}

ui.border.addEventListener("click", () => {
    checkpoint();
    design().obstacles.unshift(...borderWalls(design().worldSize, thickness(), newColor));
    changed();
});

ui.clear.addEventListener("click", () => {
    checkpoint();
    Object.assign(design(), { obstacles: [], floor: [], outline: [] });
    selected = null;
    polygon = [];
    changed();
    status("Cleared. Undo brings it back.");
});

ui.name.addEventListener("input", () => {
    design().name = ui.name.value;
    sandbox.save();
});

ui.exportBtn.addEventListener("click", () => {
    const data = serializeMap(design());
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (design().name.trim().replace(/[^\w.-]+/g, "-") || "map") + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    status(`Exported ${a.download}.`);
});

ui.importBtn.addEventListener("click", () => ui.file.click());
ui.file.addEventListener("change", async () => {
    const f = ui.file.files[0];
    ui.file.value = "";
    if (!f) return;
    try {
        const map = deserializeMap(JSON.parse(await f.text()));
        if (!map.name) map.name = f.name.replace(/\.json$/i, "");
        replaceDesign(map);
        switchMap("sandbox");
        status(`Imported "${map.name}" with ${map.obstacles.length} obstacles.`);
    } catch (err) {
        status(`Import failed: ${err.message}`);
    }
});

document.body.dataset.editor = "off";
ui.name.value = design().name;
syncUi();
