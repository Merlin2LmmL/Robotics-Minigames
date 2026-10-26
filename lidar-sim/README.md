# LiDAR-Sim

A browser-based simulation of a LiDAR-equipped robot. Drive it around, watch the lidar scan the world, push pallets, annoy warehouse workers and build your own maps. The robot has googly eyes. This is not up for discussion.

**[Try the live demo](https://merlin2lmml.github.io/Robotics-Minigames/lidar-sim/)**

> Part of the [Robotics Minigames](https://github.com/Merlin2LmmL/Robotics-Minigames) collection.

## Features

- **Robot driving** with smooth acceleration and braking, and collision handling that slides along walls instead of getting stuck in them.
- **Real-world units:** every map knows how many pixels make a meter, so the robot (1 × 0.5 m) and its sensors are the same size everywhere.
- **LiDAR sensor:** 36 rays in a full circle with a 6.25 m range, plus a little angle and distance noise because real sensors aren't perfect either. Every reading is shown live in the side panel.
- **IMU and wheel odometry:** an accelerometer and gyroscope that measure acceleration and turn rate (not velocity, just like the real thing), and wheel encoders that report forward speed. All of them come with noise and a small bias.
- **GPS:** an absolute position fix twice a second. It never drifts, but every fix is about a meter off.
- **Dead reckoning:** a purple outline shows where the robot *thinks* it is using only the gyro and wheels. Like a real robot it first averages the gyro for 2 s while standing still and subtracts that bias, but it still drifts. That's the point.
- **Sensor fusion with an extended Kalman filter:** a green outline fuses gyro, accelerometer, wheel odometry, lidar and GPS into one estimate, with a 95% uncertainty ellipse around it. The lidar is matched against the map: each beam's range is compared with what the map predicts from the estimated pose, and beams that hit people or pushed pallets are rejected as outliers. Switch any sensor on or off and watch the live error chart, or scramble the estimate and watch it recover. The filter also learns the gyro's bias.
- **SLAM back end** (`src/slam/`): builds the robot's path from its own sensors, without the map. Keyframes every 0.5 m, linked by scan matching (point-to-line ICP), loop closures when the robot comes back to a place it has seen, and a pose graph optimized with Gauss-Newton. Loop closures that look ambiguous are rejected and a robust kernel down-weights wrong ones.
- **Mapping:** an occupancy grid drawn from the SLAM keyframes. White is floor the robot has seen, dark is wall, gray is unexplored. After a loop closure the map is redrawn from the corrected path in the background. Turn the environment off to see only what the robot knows, switch on the pose graph or the scan points, change the cell size (2.5 to 20 cm) and save the map as a PNG. SLAM also shows up in the error chart.
- **Two camera modes:** *World* keeps the map still; *Robot* keeps the robot still and turns the world around it.
- **Environment toggle:** hide all walls and obstacles and drive using only the lidar hits, just like the robot does.
- **Maps**
  - **Maze:** a random maze with no loops.
  - **Floorplan:** the ground floor of our school, traced from a photo of its floor plan (`assets/school-floorplan.jpg`), with 1.5 m doors and stairs you can drive over, and stored as a normal map file (`src/map/floorplan.json`), so it opens in the editor too.
  - **Warehouse:** rows of identical shelves, set by a seed. Pallets can be pushed, and workers walk the aisles (and politely wait when the robot is in their way).
  - **Sandbox:** your own map, built in the editor.
- **Map editor:** rectangles, circles, walls, polygons (pushable ones turn when hit off-center), walking people, the robot's start position, an eraser, snap to grid and undo. The lidar keeps scanning while you edit, so you see what the robot would see.
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

## Rebuilding the school floorplan

The floorplan map is traced from a phone photo of the plan that hangs in the school, in two steps (needs `python3-opencv` and `python3-scipy`):

```
python3 tools/floorplan/rectify_photo.py photo.jpg assets/school-floorplan.jpg
python3 tools/floorplan/trace_floorplan.py assets/school-floorplan.jpg src/map/floorplan.json debug.png
```

The first fits the lens distortion and the camera angle so the plan's walls come out straight, then crops to the sheet. The second turns the ground floor into straight walls of one thickness, pillars and the round bays beside the aula. Doors are found by the gap or the door leaf (arc) on the plan and widened to 1.5 m so the robot fits through like on a robotics course; stairs and door thresholds go into the floor layer, so they are drawn but can be driven over. `debug.png` shows what it found on top of the plan. The crop, the ground floor's position on the sheet and the scale (a classroom is taken as 9 m wide, because the scale bar has no length on it) are constants at the top of each script.

## Known limitations

- Shapes with corners pointing inwards collide as if those corners were filled in.
- Lines can't be pushed, and pushed rectangles and circles slide without turning (only polygons turn).
- The sandbox autosave lives in your browser only, so export your map if you want to keep or share it.
- The Kalman filter localizes against a map it is given (every wall that neither walks nor can be pushed). SLAM doesn't need one, but in open spaces where the lidar sees few walls it drifts like odometry, and in the warehouse the identical aisles make loop closures rare, so its map smears there.
- Without the gyro, lidar matching in the warehouse can lock onto the wrong aisle, because they all look the same. A Kalman filter only tracks one guess.

## Project structure

```
index.html            page, side menu and UI wiring
src/main.js           game loop and camera
src/robot.js          robot movement, collision response and the face
src/editor.js         map editor
src/sensors/lidar.js  ray casting and noise
src/sensors/imu.js    IMU and wheel odometry
src/sensors/gps.js    noisy absolute position fixes
src/deadReckoning.js  pose estimate from gyro and wheels
src/kalman.js         extended Kalman filter fusing all sensors
src/slam/             SLAM: scan matching, pose graph, loop closure and the occupancy grid map
src/map/              maps, obstacles, movers and the map file format
assets/               straightened photo of the school floor plan
tools/floorplan/      scripts that straighten the photo and trace it into src/map/floorplan.json
```

## License

GPL-2.0. See [LICENSE](../LICENSE).
