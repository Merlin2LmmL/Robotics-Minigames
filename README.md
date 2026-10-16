# Programmable Pac-Man

**Don't just play Pac-Man. Teach it how.**

A browser minigame built for our school's Robotics Team website. Instead of steering Pac-Man yourself, you can write the rules he lives by, or train a small neural network to make the decisions for him, and then see how high your creation climbs on the global leaderboard.

> Momentarily the only game of the [Robotics Minigames](https://github.com/Merlin2LmmL/Robotics-Minigames) collection, a set of small, playable demos meant to spark curiosity about algorithms, AI and robotics.

---

## Why this exists

Our robotics team needed a website. Websites are great, but a page that only *describes* robotics is a bit like a menu without food. So the plan became: build little games that let visitors *feel* what it's like to make a machine decide things.

Pac-Man turned out to be a perfect test bench. A tiny world, clear goals, and enemies that each have their own personality. That's a decision-making problem hiding in plain sight.

---

## Three ways to play

| Mode | What you do | Difficulty |
|---|---|---|
| **Manual** | Steer Pac-Man yourself. The classic. | Nostalgic |
| **Rule-based** | Build a set of rules that decide where Pac-Man goes. | Think like a programmer |
| **Neural network** | Train a network, or hand-tune its neurons, to control Pac-Man. | Think like a robot (and bring snacks) |

Every mode has its own high score, so there are three separate leaderboards to conquer.

### How the AI makes decisions

Pac-Man doesn't get to twitch randomly every frame. His controller is asked for a direction **at every junction**, and that's the only thing it has to decide. The rules or network you build receive the situation at the junction and return where to go next.

Since sometimes you really do need to turn around (a ghost is rolling towards you, after all), a 180° turn is allowed when things get dicey.

A **debug option** can pause Pac-Man at each junction so you can watch the decision being made.

---

## Features

- **Faithful ghost behavior.** All four ghosts have their own personality and targeting logic, like in the original, so they surround you instead of lining up in one boring conga line. That includes the famous overflow quirk that sends one ghost's target slightly off when Pac-Man faces upward.
- **Complete ghost mode cycle:** chase, scatter, frightened and eaten (just a pair of googly eyes sprinting home at 2.5× speed).
- **Per-state speeds.** Ghosts change speed depending on their mode, just like the real thing.
- **Scoring, lives, power pellets, ghost combos and fruit spawns.**
- **Portals.** Teleport tiles that keep your direction and drop you out of the other end.
- **Proper maze visuals** with connected walls, convex and concave corners, a ghost house and doors.
- **Global leaderboard** backed by a Cloudflare Worker and a SQLite database.
- **Runs in any modern browser,** so no installs and no plugins.
- **A tiny secret easter egg**. Hint: look closely at the control panel and you'll get the urge to dance (;

---

## Try it

Because it's a plain static website, you can run it anywhere:

1. Clone the repository:
   ```bash
   git clone https://github.com/Merlin2LmmL/Robotics-Minigames.git
   ```
2. Open `index.html` in your browser, or serve the folder with any static server.
3. Pick a mode, hit play and climb the board.

> **Note:** The global leaderboard talks to a hosted backend, so scores are only submitted when you're online. Mobile support hasn't been fully tested yet.

---

## Under the hood

- **Language:** Vanilla JavaScript, no frameworks
- **Rendering:** The built-in [Canvas 2D API](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D) (Used this doc and its exmaples A LOT!). Every sprite and wall tile is drawn by hand with shapes.
- **Architecture:** A sprite system with per-sprite state, speed and targeting, driven by a game loop.
- **Maps:** Text-based tile maps where letters mark special tiles such as portals.
- **Leaderboard:** Cloudflare Worker + SQLite. GitHub Pages is static and can't write data, so the leaderboard needed a small backend of its own.

---

## Challenge

Think you can write better rules than the author? Train a better network? Prove it on the leaderboard in any of the three modes.

---

## Credits

- Original maze layout from [bobeff/pacman](https://github.com/bobeff/pacman/blob/master/assets/maze.txt)
- Ghost AI behavior researched with the help of [this excellent breakdown](https://youtu.be/ataGotQ7ir8)
- Claude Code was used for debugging a few small issues, mainly in the early sprite system
- Pac-Man is a trademark of its respective owner. This is a non-commercial fan project made for learning.
- Thanks to Fiona and the entire team for her effort in terra for motivating me to make this project. Hope you read this!
---

<sub>Built with curiosity, too much coffee and a mild obsession with ghost pathfinding.</sub>
