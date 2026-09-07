const states = ["empty", "ready", "image", "generating", "error"];
export function reduceShellState(state, event) {
  if (event.type === "navigate" && ["studio", "library"].includes(event.view)) return { ...state, view: event.view };
  if (event.type === "canvas" && states.includes(event.state)) return { ...state, canvas: event.state };
  if (event.type === "inspector") return { ...state, inspector: event.open };
  throw new Error("Unknown shell action");
}
