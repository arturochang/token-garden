// Crew registry: each crews/<id>.js file calls registerCrew(id, def).
// def = {
//   displayName           human-readable name shown in Settings,
//   fig(tool)            66x60 header figure (faces via .f-work/.f-idle/.f-frenzy,
//                        shared motion hooks .bob and .swing),
//   head(key, color)     44x44 head for tiles/porters/wrestlers; root class ghead or ahead,
//   impl(tool, helpers)  hand-held implement; helpers = {grip, col, COLORS},
//   pet(pose, frame)     64x64 page-pet art (poses: sit/wave/walk/run/nap/special),
//   petProfile?          optional personality data consumed by the shared pet loop:
//                        {greetings, weights, speed, timing, labels, interaction}
//   climber?(ctx,s,lead) optional tiny canvas figure used on cost-chart bars,
//   css?                 optional per-crew keyframes, injected once, namespaced.
// }
// Rule: a crew file may read window.COLORS / window.state at CALL time but
// must never mutate them or call another crew's functions.
window.CREWS = Object.create(null);
function registerCrew(id, def) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || !def) throw new Error("invalid crew registration");
  if (typeof def.displayName !== "string" || !def.displayName.trim()) {
    throw new Error(`crew ${id} is missing displayName`);
  }
  def.displayName = def.displayName.trim();
  for (const key of ["fig", "head", "impl", "pet"]) {
    if (typeof def[key] !== "function") throw new Error(`crew ${id} is missing ${key}()`);
  }
  if (def.css && typeof document !== "undefined" && document.head) {
    if (!document.head.querySelector('style[data-crew="' + id + '"]')) {
      const st = document.createElement("style");
      st.dataset.crew = id;
      st.textContent = def.css;
      document.head.appendChild(st);
    }
  }
  window.CREWS[id] = def;
  if (typeof window.dispatchEvent === "function") window.dispatchEvent(new Event("crewregistered"));
}
function crewDef(id) {
  return window.CREWS[id] || window.CREWS.gnomes;
}
