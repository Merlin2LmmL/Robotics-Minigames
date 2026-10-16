import { Obstacle } from "./obstacle.js";

export const map = {
    obstacles: [
        new Obstacle("rectangle", "rgba(190, 207, 90, 0.5)", 100, 100, 50, 50),
        new Obstacle("circle", "rgba(199, 84, 164, 0.5)", 200, 200, 30),
        new Obstacle("polygon", "rgba(116, 17, 17, 0.5)", [{ x: 300, y: 300 }, { x: 350, y: 350 }, { x: 400, y: 300 }]),
        new Obstacle("line", "rgba(42, 179, 15, 0.5)", 500, 500, 600, 600),
        new Obstacle("rectangle", "rgba(70, 130, 200, 0.5)", 650, 150, 120, 40),
        new Obstacle("rectangle", "rgba(230, 150, 50, 0.5)", 150, 450, 40, 140),
        new Obstacle("circle", "rgba(60, 170, 170, 0.5)", 450, 120, 45),
        new Obstacle("circle", "rgba(150, 100, 200, 0.5)", 750, 450, 25),
        new Obstacle("polygon", "rgba(200, 60, 60, 0.5)", [{ x: 650, y: 650 }, { x: 750, y: 700 }, { x: 700, y: 780 }, { x: 620, y: 740 }]),
        new Obstacle("line", "rgba(90, 90, 90, 0.5)", 300, 650, 450, 600),
        new Obstacle("line", "rgba(90, 90, 90, 0.5)", 800, 250, 800, 380)
    ]
};