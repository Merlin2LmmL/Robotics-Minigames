# LiDAR-Sim

A browser-based simulation of a LiDAR-equipped robot. Drive it around, watch the lidar scan the world, push pallets, annoy warehouse workers and build your own maps. The robot has googly eyes. This is not up for discussion.

**[Try the live demo](https://merlin2lmml.github.io/Robotics-Minigames/lidar-sim/)**

> Part of the [Robotics Minigames](https://github.com/Merlin2LmmL/Robotics-Minigames) collection.

## Features

- **Robot driving** with smooth acceleration and braking, and collision handling that slides along walls instead of getting stuck in them.
- **Real-world units:** every map knows how many pixels make a meter, so the robot (1 × 0.5 m) and its sensors are the same size everywhere.
- **LiDAR sensor:** 36 rays in a full circle with a 6.25 m range, plus a little angle and distance noise because real sensors aren't perfect either. Every reading is shown live in the side panel.
- **IMU and wheel odometry:** an accelerometer and gyroscope that measure acceleration and turn rate (not velocity, just like the real thing), and wheel encoders that report forward speed. All of them come with noise and a small bias.
- **Dead reckoning:** a purple outline shows where the robot *thinks* it is using only the gyro and wheels. It drifts. That's the point.
- **Two camera modes:** *World* keeps the map still; *Robot* keeps the robot still and turns the world around it.
- **Environment toggle:** hide all walls and obstacles and drive using only the lidar hits, just like the robot does.
- **Maps**
  - **Maze:** a random maze with no loops.
  - **Floorplan:** a (lovingly approximate) sketch of a school building.
  - **Warehouse:** rows of identical shelves, set by a seed. Pallets can be pushed, and workers walk the aisles (and politely wait when the robot is in their way).
  - **Sandbox:** your own map, built in the editor.
- **Map editor:** rectangles, circles, walls, polygons, walking people, the robot's start position, an eraser, snap to grid and undo. The lidar keeps scanning while you edit, so you see what the robot would see.
- **Import and export** maps as `.json` files to share them. Any built-in map can be copied into the editor as a starting point.

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` / arrow keys | Drive and turn |
| On-screen pad | Same, for touch screens |
| Mouse wheel (editor) | Zoom |
| Right-drag (editor) | Pan |
| `Delete` / `Ctrl+Z` (editor) | Delete selection / undo |

## Running locally

No build step, no dependencies. The code uses JavaScript modules, so the page has to be opened through a web server rather than straight from a file:

```bash
python3 -m http.server 8000
```

Run it from the repository root, then open <http://localhost:8000/lidar-sim/>. In VS Code, the `serve` task does the same.

The warehouse also takes URL parameters, for example:

```
lidar-sim/?map=warehouse&rowCount=5&aisleWidth=2.5&workerCount=1&spawn=10,20,0
```

Also supported: `rowLength`, `shelfUnitLength` and `clutterAmount`.

## Map file format

Exported maps are plain JSON. Coordinates are in pixels; `scale` says how many pixels make a meter (default 40).

```json
{
  "format": "lidar-sim-map",
  "version": 1,
  "name": "my map",
  "worldSize": { "width": 960, "height": 1080 },
  "scale": 40,
  "start": { "x": 480, "y": 540, "angle": -1.5708 },
  "obstacles": [
    { "shape": "rectangle", "color": "rgba(90, 90, 90, 0.8)", "x": 100, "y": 100, "width": 200, "height": 40, "movable": true },
    { "shape": "circle", "color": "rgba(230, 120, 60, 0.9)", "x": 300, "y": 600, "radius": 12,
      "patrol": { "waypoints": [{ "x": 300, "y": 600 }, { "x": 700, "y": 600 }], "speed": 36 } }
  ]
}
```

Supported shapes are `rectangle`, `circle`, `polygon` (`points`) and `line` (`x1`, `y1`, `x2`, `y2`).

## Known limitations

- Shapes with corners pointing inwards collide as if those corners were filled in.
- Only rectangles and circles can be pushed.
- The sandbox autosave lives in your browser only, so export your map if you want to keep or share it.
- No SLAM yet. The robot knows exactly where it is, which is frankly cheating. That's next.

## Project structure

```
index.html            page, side menu and UI wiring
src/main.js           game loop and camera
src/robot.js          robot movement, collision response and the face
src/editor.js         map editor
src/sensors/lidar.js  ray casting and noise
src/sensors/imu.js    IMU and wheel odometry
src/deadReckoning.js  pose estimate from gyro and wheels
src/map/              maps, obstacles, movers and the map file format
```

## License

GPL-2.0. See [LICENSE](../LICENSE).
