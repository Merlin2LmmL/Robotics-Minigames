import { Obstacle } from "./obstacle.js";

export const map = {
    obstacles: [
        new Obstacle("rectangle", "rgba(190, 207, 90, 0.5)", 100, 100, 50, 50),
        new Obstacle("circle", "rgba(199, 84, 164, 0.5)", 200, 200, 30),
        new Obstacle("polygon", "rgba(116, 17, 17, 0.5)", [{ x: 300, y: 300 }, { x: 350, y: 350 }, { x: 400, y: 300 }]),
        new Obstacle("line", "rgba(42, 179, 15, 0.5)", 500, 500, 600, 600)
    ]
};