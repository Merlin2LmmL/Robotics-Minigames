// Neural Network: sensors -> hidden layer -> output layer (direction)
// Network parameters come from the webpage
//   { config: { inputs: [ids], hidden: [sizes], outputs: 4 }, weights, biases }
//   weights[l][to][from] connects layer l to layer l+1, biases[l][to] belongs to node "to" in layer l+1.

import { isWall } from "../map.js";
import { STEP } from "../main.js";
import { ORDER } from "../control.js";

// Pacmans maxum "view" distance in tiles (rest reads 1)
const MAX_SENSE  = 15;

const key = (x, y) => x + "," + y;

// ---------- Sensors ----------
// Every value is boolean (between 0 and 1)

// Breadth-first search from the tile next to Pac-Man (distance 1), never stepping back onto
// Pac-Man's own tile, so each direction only reports what lies that way.
function look(start, banned, goals) {
  const seen = new Set([key(...banned), key(...start)]);
  const found = { ghost: null, pellet: null, power: null };
  let frontier = [start];
 
  for (let dist = 1; dist <= MAX_SENSE && frontier.length > 0; dist++) {
    const next = [];
    for (const [x, y] of frontier) {
      const k = key(x, y);
      for (const name of Object.keys(found)) {
        if (found[name] === null && goals[name].has(k)) found[name] = dist;
      }
      for (const [dx, dy] of Object.values(STEP)) {
        const nx = x + dx, ny = y + dy;
        const nk = key(nx, ny);
        if (isWall(nx, ny) || seen.has(nk)) continue;
        seen.add(nk);
        next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  return found;
}

const far = (dist) => (dist === null ? MAX_SENSE : dist) / MAX_SENSE;

// Computes all sensores and returns them by id
export function readSensors(player, sprites) {
  const goals = { ghost: new Set(), pellet: new Set(), power: new Set() };
  let scared = false;
 
  for (const o of sprites) {
    if (o.kind === "ghost") {
      if (o.state === "active") goals.ghost.add(key(o.x, o.y));
      if (o.state === "frightened") scared = true;
    } else if (o.kind === "dot") {
      goals.pellet.add(key(o.x, o.y));
    } else if (o.kind === "pellet") {
      goals.pellet.add(key(o.x, o.y));
      goals.power.add(key(o.x, o.y));
    }
  }
 
  const values = { scared: scared ? 1 : 0 };
  let nearestPower = null;
 
  for (const [name, [dx, dy]] of Object.entries(STEP)) {
    const Name = name[0].toUpperCase() + name.slice(1);
    const nx = player.x + dx, ny = player.y + dy;
 
    if (isWall(nx, ny)) {                       // nothing to see through a wall
      values["ghost" + Name] = 1;
      values["pellet" + Name] = 1;
      continue;
    }
    const found = look([nx, ny], [player.x, player.y], goals);
    values["ghost" + Name] = far(found.ghost);
    values["pellet" + Name] = far(found.pellet);
    if (found.power !== null && (nearestPower === null || found.power < nearestPower)) {
      nearestPower = found.power;
    }
  }
 
  values.powerNear = nearestPower === null ? 0 : 1 - nearestPower / MAX_SENSE;
  return values;
}

export function computeInputs(inputIds, player, sprites) {
    const all = readSensors(player, sprites);
    return inputIds.map((id) => all[id] ?? 0);
}

// ---------- Forward pass ----------
// Hidden layers use tanh, the output layer is left linear
// Returns activations[layer][neuron] with layer 0 = the inputs
export function forward(network, inputs) {
    const { weights, biases } = network;
    if (!weights.length || weights[0][0]?.length !== inputs.length) return null;

    const activations = [inputs];
    let x = inputs;
    for (let l = 0; l < weights.length; l++) {
        const isOutput = l === weights.length - 1;
        x = weights[l].map((row, to) => {
            let sum = biases[l][to];
            for (let from = 0; from < row.length; from++) sum += row[from] * x[from];
            return isOutput ? sum : Math.tanh(sum);
        });
        activations.push(x);
    }
    return activations;
}

// ---------- Decision ----------
// legal = directions that are not blocked by a wall, e.g. ["up", "left"].
// Returns { direction, outputs, activations, inputs } or null if the network can't run.
export function decideNetwork(network, player, sprites, legal) {
  const inputs = computeInputs(network.config.inputs, player, sprites);
  const activations = forward(network, inputs);
  if (!activations) return null;
 
  const outputs = activations[activations.length - 1];
  let best = -1;
  ORDER.forEach((d, i) => {
    if (!legal.includes(d)) return;                       // walls are masked out
    if (best === -1 || outputs[i] > outputs[best]) best = i;
  });
 
  return { direction: best === -1 ? null : ORDER[best], outputs, activations, inputs };
}