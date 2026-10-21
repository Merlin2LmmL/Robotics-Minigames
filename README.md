# Robotics Minigames

Small, playable browser demos built for our school's Robotics Team website. Each one lets you *feel* what it's like to make a machine sense and decide things, instead of just reading about it.

**[Play them here](https://merlin2lmml.github.io/Robotics-Minigames/)**

| Game | What it's about |
|---|---|
| [**Programmable Pac-Man**](pacman/) | Play Pac-Man yourself, write rules for him, or train a neural network to play, then climb the global leaderboard. |
| [**LiDAR Sim**](lidar-sim/) | Drive a LiDAR-equipped robot around mazes, a school floorplan and a warehouse, watch its sensors (LiDAR, IMU, wheel odometry) and build your own maps. |

## Running locally

No build step, no dependencies. The games use JavaScript modules, so serve the repository root with a web server instead of opening the files directly:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. In VS Code, the `serve` task does the same.

## Project structure

```
index.html    landing page that links to every game
pacman/       Programmable Pac-Man
lidar-sim/    LiDAR Sim
```

Each game folder is self-contained and has its own README.

## License

GPL-2.0. See [LICENSE](LICENSE).

<sub>Developed by Merlin2LmmL in 2026</sub>
