export function setupKeyListener(dir) {
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    switch (event.key) {
      case "w":
      case "W": dir.val = "up"; break;
      case "s":
      case "S": dir.val = "down"; break;
      case "a":
      case "A": dir.val = "left"; break;
      case "d":
      case "D": dir.val = "right"; break;
      default: return;
    }
    event.preventDefault();
  });
}