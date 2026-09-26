// Garden gnome crew: original woodland tinkerers with figures, support heads,
// implements, a page pet, personality, chart climbers and scoped motion.
// May read COLORS at call time. Mutates nothing and calls no other crew.
const GNOME = {
  skin: "#efbd8b", skinShade: "#cf875d", ink: "#292523",
  beard: "#f3eee2", beardShade: "#c9c1b2", tunic: "#49617a",
  tunicDark: "#293b50", leather: "#715034", leatherDark: "#432f22",
  brass: "#e4ad3f", moss: "#53764a", mossLight: "#86a65d",
  mushroom: "#d85b4d", metal: "#9ca5a3", metalDark: "#59615f",
};

function gnomeFaces() {
  return `<g class="f-work"><path d="m23 23 6 1m6 0 6-1" fill="none" stroke="${GNOME.ink}" stroke-width="1.3"/><circle cx="27" cy="25" r="1.15" fill="${GNOME.ink}"/><circle cx="37" cy="25" r="1.15" fill="${GNOME.ink}"/><path d="M29 31q3 2 6 0" fill="none" stroke="#8d493c"/></g>`
    + `<g class="f-idle"><path d="M23.5 25q3.5 2.5 7 0m3 0q3.5 2.5 7 0" fill="none" stroke="${GNOME.ink}" stroke-width="1.35"/><ellipse cx="32" cy="31" rx="1.6" ry="2" fill="#8d493c"/></g>`
    + `<g class="f-frenzy"><path d="m22 21 8 3-7 3m19-6-8 3 7 3" fill="#fff7db" stroke="${GNOME.ink}" stroke-width="1.2"/><circle cx="27" cy="24" r="1.2" fill="${GNOME.ink}"/><circle cx="37" cy="24" r="1.2" fill="${GNOME.ink}"/><path d="M28 31q4-3 8 0" fill="none" stroke="#8d493c"/></g>`;
}

function gnomeHat(tool, hat) {
  if (tool === "codex") return `<path class="cap" d="M16 20Q19 5 28 2q8 1 13 11l8 7H16Z" fill="${hat}" stroke="${GNOME.ink}" stroke-width="1.2"/><path d="M27 5q5 4 7 13" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="2"/><path class="cap-tip" d="m41 13 8 7-10-1Z" fill="${GNOME.mossLight}"/><circle cx="48" cy="19" r="2.2" fill="${GNOME.brass}" stroke="${GNOME.ink}"/>`;
  if (tool === "opencode") return `<path class="cap" d="M15 20Q19 8 27 3l7 8 7-5 8 14H15Z" fill="${hat}" stroke="${GNOME.ink}" stroke-width="1.2"/><path d="m27 3 7 8 7-5" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="2"/><path d="M17 19q14-4 30 0" fill="none" stroke="${GNOME.mossLight}" stroke-width="2"/>`;
  return `<path class="cap" d="M15 20Q19 5 31 1q5 8 4 15l14-3-7 7H15Z" fill="${hat}" stroke="${GNOME.ink}" stroke-width="1.2"/><path d="M29 4q4 6 3 13" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="2"/><path class="cap-tip" d="m35 16 14-3-7 7Z" fill="${GNOME.mushroom}"/><circle cx="49" cy="13" r="1.8" fill="#f7dc9d"/>`;
}

function gnomeSVG(tool) {
  const hat = COLORS[tool] || "#88765d";
  const badge = tool === "claude" ? "leaf" : tool === "codex" ? "key" : "moon";
  const badgeArt = badge === "leaf"
    ? `<path d="M30 43q4-6 8-1-3 5-8 1Z" fill="${GNOME.mossLight}"/><path d="m31 44 5-3" stroke="${GNOME.moss}"/>`
    : badge === "key"
      ? `<circle cx="34" cy="42" r="2" fill="none" stroke="${GNOME.brass}"/><path d="m36 42 4 3m-2-1 1-1" stroke="${GNOME.brass}"/>`
      : `<path d="M38 39q-5 6 1 9-8-1-7-6 1-4 6-3Z" fill="${GNOME.brass}"/>`;
  return `<svg class="gardenfig tool-${tool}" viewBox="0 0 66 60" aria-hidden="true"><g class="gnome-fx"><circle cx="33" cy="40" r="23"/><circle cx="33" cy="40" r="17"/></g><g class="bob gnome-body"><path d="M21 43h9v12h-9Zm24 0h-9v12h9Z" fill="${GNOME.leather}" stroke="${GNOME.leatherDark}"/><path d="M18 54h13v4H15q0-3 3-4Zm30 0H35v4h16q0-3-3-4Z" fill="${GNOME.leatherDark}" stroke="${GNOME.ink}"/><path d="M18 36q14-8 28 0l-2 14H20Z" fill="${GNOME.tunic}" stroke="${GNOME.tunicDark}"/><path d="M20 44h24" stroke="${GNOME.leatherDark}" stroke-width="2.8"/><rect x="29" y="42" width="7" height="5" rx="1" fill="${GNOME.brass}" stroke="${GNOME.leatherDark}"/>${badgeArt}<g transform="translate(45 38)"><path d="M0-1q5 2 5 8" fill="none" stroke="${GNOME.tunicDark}" stroke-width="4.2" stroke-linecap="round"/><path d="M0-1q5 2 5 8" fill="none" stroke="${GNOME.tunic}" stroke-width="2.6" stroke-linecap="round"/><g transform="translate(5 7)"><g class="swing gnome-tool">${gnomeImpl(tool)}</g><circle r="2.6" fill="${GNOME.skin}" stroke="${GNOME.ink}" stroke-width="1"/></g></g><path d="M18 20Q19 10 32 10t14 10v9Q43 39 32 39T18 29Z" fill="${GNOME.skin}" stroke="${GNOME.ink}"/><path d="m18 24-4 2 5 3m27-5 4 2-5 3" fill="${GNOME.skinShade}" stroke="${GNOME.ink}"/>${gnomeFaces()}<path class="beard" d="M21 29q4 3 7 1 4 4 8 0 3 2 7-1-1 12-5 15l-5 7-5-7q-6-4-7-15Z" fill="${GNOME.beard}" stroke="${GNOME.beardShade}"/><path d="M25 33q3 4 7 2m9-2q-3 4-7 2M29 38l4 10 4-10" fill="none" stroke="#fff" stroke-opacity=".72"/>${gnomeHat(tool, hat)}<path class="hat-band" d="M15 19q17-4 34 0v4H15Z" fill="${GNOME.leatherDark}" stroke="${GNOME.ink}"/><g transform="translate(19 38) scale(-1 1)"><path d="M0-1q5 2 5 8" fill="none" stroke="${GNOME.tunicDark}" stroke-width="4.2" stroke-linecap="round"/><path d="M0-1q5 2 5 8" fill="none" stroke="${GNOME.tunic}" stroke-width="2.6" stroke-linecap="round"/><circle cx="5" cy="7" r="2.6" fill="${GNOME.skin}" stroke="${GNOME.ink}" stroke-width="1"/></g></g></svg>`;
}

// Pocket-size head for tiles, porters, flags and other dashboard helpers.
function gnomeHead(key, color) {
  const tilt = key === "opencode" ? -2 : key === "codex" ? 2 : 0;
  return `<svg class="ghead moss-head" viewBox="0 0 44 44" aria-hidden="true"><g transform="rotate(${tilt} 22 24)"><path d="M7 20Q10 6 20 3q7 5 9 13l9-3-6 8Z" fill="${color}" stroke="${GNOME.ink}"/><path d="M8 19q13-3 27 0v4H8Z" fill="${GNOME.leatherDark}"/><path d="M10 22q1-8 12-8t12 8v7q-2 10-12 10T10 29Z" fill="${GNOME.skin}" stroke="${GNOME.ink}"/><circle cx="18" cy="25" r="1.1" fill="${GNOME.ink}"/><circle cx="26" cy="25" r="1.1" fill="${GNOME.ink}"/><circle cx="22" cy="28" r="1.6" fill="${GNOME.skinShade}"/><path d="M13 29q3 2 5 0 4 3 8 0 2 2 5 0-1 7-5 9l-4 4-4-4q-4-2-5-9Z" fill="${GNOME.beard}" stroke="${GNOME.beardShade}"/></g></svg>`;
}

function gnomeImpl(tool) {
  if (tool === "claude") return `<path d="M0 1 7-12" stroke="${GNOME.leather}" stroke-width="3"/><path d="M6-11q4-10 12-7-2 7-9 9Z" fill="${GNOME.metal}" stroke="${GNOME.metalDark}"/><path d="m11-15 4-1" stroke="#dce2df"/>`;
  if (tool === "opencode") return `<path d="M0 1 7-12" stroke="${GNOME.leather}" stroke-width="3"/><path d="M3-20h14l-2 9H5Z" fill="${GNOME.metal}" stroke="${GNOME.metalDark}"/><path d="m5-18 10 5m1-5L6-13" stroke="#d8ddda"/><path d="M7-20q3-5 6 0" fill="none" stroke="${GNOME.leather}"/>`;
  return `<path d="M0 1 7-14" stroke="${GNOME.leather}" stroke-width="3"/><path d="m7-14 7-7 6 3-5 9Z" fill="${GNOME.metal}" stroke="${GNOME.metalDark}"/><path d="m15-18 3 1" stroke="#edf1ee"/>`;
}

function gnomePet(pose, frame) {
  const even = frame % 2 === 0;
  const nap = pose === "nap", sit = pose === "sit", run = pose === "run";
  const special = pose === "special", moving = pose === "walk" || run;
  const rock = moving ? (even ? (run ? 7 : 3) : (run ? -7 : -3)) : 0;
  const line = `stroke="${GNOME.ink}" stroke-width="1.15" stroke-linejoin="round" stroke-linecap="round"`;
  const hat = `<path class="pet-cap" d="M13 20Q17 5 29 2q7 6 8 14l15-4-9 9Z" fill="${GNOME.mushroom}" ${line}/><path d="M18 16q5-8 12-10" fill="none" stroke="#f18b75" stroke-width="2"/><circle cx="50" cy="12" r="2.2" fill="#f5d27b" ${line}/><path d="M13 19q16-4 34 0v4H13Z" fill="${GNOME.leatherDark}" ${line}/>`;
  let legs;
  if (sit || nap) legs = `<path d="M25 47q-8 0-10 7h13l4-5Zm14 0q8 0 10 7H36l-4-5Z" fill="${GNOME.leather}" ${line}/><path d="M15 53h13v5H13q0-4 2-5Zm34 0H36v5h15q0-4-2-5Z" fill="${GNOME.leatherDark}" ${line}/>`;
  else {
    const lift = run ? 6 : 3, spread = run ? 5 : 2;
    const lx = 24 - (even ? spread : 0), rx = 35 + (even ? spread : 0);
    const ly = even ? 45 - lift : 45, ry = even ? 45 : 45 - lift;
    legs = `<path d="M${lx} ${ly}h7v11h-7ZM${rx} ${ry}h7v11h-7Z" fill="${GNOME.leather}" ${line}/><path d="M${lx-2} ${ly+9}h11v5H${lx-4}q0-4 2-5ZM${rx+9} ${ry+9}H${rx-2}v5h15q0-4-2-5Z" fill="${GNOME.leatherDark}" ${line}/>`;
  }
  const face = nap
    ? `<path d="M23 26q3 2 6 0m6 0q3 2 6 0" fill="none" stroke="${GNOME.ink}" stroke-width="1.3"/><ellipse cx="32" cy="32" rx="1.6" ry="2" fill="#8d493c"/>`
    : special
      ? `<path d="m22 23 8 3-7 3m19-6-8 3 7 3" fill="#fff7db" stroke="${GNOME.ink}"/><circle cx="27" cy="26" r="1.1"/><circle cx="37" cy="26" r="1.1"/><path d="M29 32h6" stroke="#8d493c"/>`
      : `<g class="pet-eyes"><circle cx="27" cy="26" r="1.3"/><circle cx="37" cy="26" r="1.3"/></g><path d="M29 32q3 2 6 0" fill="none" stroke="#8d493c"/>`;
  let arms = "", prop = "";
  if (sit) {
    arms = `<path d="m23 39-5 8m23-8 5 8" stroke="${GNOME.tunic}" stroke-width="4.5"/><circle cx="17" cy="48" r="3" fill="${GNOME.skin}" ${line}/><circle cx="47" cy="48" r="3" fill="${GNOME.skin}" ${line}/>`;
    prop = `<g class="pet-acorn"><path d="M25 43q7-8 14 0l-2 9H27Z" fill="#a86f37" ${line}/><path d="M25 43q7-5 14 0" fill="none" stroke="${GNOME.leatherDark}" stroke-width="3"/><path d="m32 39 2-4" stroke="${GNOME.leatherDark}" stroke-width="2"/></g>`;
  } else if (special) {
    const y = even ? 8 : 11;
    arms = `<path d="M23 39 13 28m28 11 10-11" stroke="${GNOME.tunic}" stroke-width="4.5"/><circle cx="12" cy="27" r="3" fill="${GNOME.skin}" ${line}/><circle cx="52" cy="27" r="3" fill="${GNOME.skin}" ${line}/>`;
    prop = `<g class="pet-juggle"><path d="M20 ${y}q3-5 6 0l-1 4h-4Z" fill="#a86f37" ${line}/><path d="M29 ${15-y/2}q3-5 6 0l-1 4h-4Z" fill="#a86f37" ${line}/><path d="M39 ${y}q3-5 6 0l-1 4h-4Z" fill="#a86f37" ${line}/></g>`;
  } else if (pose === "wave" || pose === "spin") {
    const wy = even ? 13 : 17;
    arms = `<path d="m23 39-7 8M41 39l12-${39-wy}" stroke="${GNOME.tunic}" stroke-width="4.5"/><circle cx="15" cy="48" r="3" fill="${GNOME.skin}" ${line}/><circle cx="53" cy="${wy}" r="3" fill="${GNOME.skin}" ${line}/>`;
  } else {
    arms = `<path d="m23 39-7 ${even ? 7 : 3}m25-7 7 ${even ? 3 : 7}" stroke="${GNOME.tunic}" stroke-width="4.5"/><circle cx="15" cy="${even ? 47 : 43}" r="3" fill="${GNOME.skin}" ${line}/><circle cx="49" cy="${even ? 43 : 47}" r="3" fill="${GNOME.skin}" ${line}/>`;
  }
  const speed = run ? `<path d="M2 36h15M5 43h11M1 50h14" stroke="var(--muted)" stroke-width="1.5" opacity=".6"/>` : "";
  return `<svg class="garden-pet" viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="32" cy="60" rx="19" ry="2.6" fill="rgba(0,0,0,.24)"/>${speed}<g transform="rotate(${rock} 32 51)">${legs}<path d="M20 38q12-7 24 0l-2 13H22Z" fill="${GNOME.tunic}" ${line}/><path d="M22 45h20" stroke="${GNOME.leatherDark}" stroke-width="2.5"/><rect x="29" y="43" width="6" height="5" rx="1" fill="${GNOME.brass}" ${line}/>${arms}${prop}<path d="M18 21q1-11 14-11t14 11v9q-3 11-14 11T18 30Z" fill="${GNOME.skin}" ${line}/>${face}<circle cx="32" cy="29" r="2" fill="${GNOME.skinShade}"/><path class="pet-beard" d="M20 32q4 3 8 1 4 4 8 0 4 2 8-1-2 12-7 15l-5 7-5-7q-5-3-7-15Z" fill="${GNOME.beard}" stroke="${GNOME.beardShade}"/><path d="m27 37 5 14 5-14" fill="none" stroke="#fff" stroke-opacity=".7"/>${hat}</g></svg>`;
}

const GNOME_PET_PROFILE = {
  greetings: ["Root and ready!", "Tiny crew, big plans.", "Mind the mushrooms.", "Found an acorn!", "Garden's growing."],
  weights: { walk: 30, run: 12, sit: 21, wave: 14, special: 10, hop: 6, nap: 6, spin: 1 },
  speed: { walk: [42, 100], run: [220, 390] },
  timing: { sit: [2400, 6500], wave: [1200, 2100], nap: [5200, 10000], hopDuration: .48 },
  labels: { special: "acorn juggle", wave: "cap-tip greeting", walk: "garden patrol", run: "mushroom dash" },
  interaction: "special",
};

function gnomeClimber(ctx, size, leader) {
  const s = size;
  ctx.fillStyle = GNOME.tunic; ctx.fillRect(-s * .42, s * .28, s * .84, s * .78);
  ctx.fillStyle = GNOME.leatherDark; ctx.fillRect(-s * .48, s * .91, s * .38, s * .25); ctx.fillRect(s * .1, s * .91, s * .38, s * .25);
  ctx.fillStyle = GNOME.skin; ctx.strokeStyle = GNOME.ink; ctx.lineWidth = Math.max(.8, s * .06); ctx.beginPath(); ctx.arc(0, 0, s * .53, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = GNOME.beard; ctx.beginPath(); ctx.moveTo(-s * .43, s * .16); ctx.quadraticCurveTo(0, s * .95, s * .43, s * .16); ctx.quadraticCurveTo(0, s * .5, -s * .43, s * .16); ctx.fill();
  ctx.fillStyle = GNOME.mushroom; ctx.beginPath(); ctx.moveTo(-s * .7, -s * .24); ctx.quadraticCurveTo(-s * .18, -s * 1.18, s * .18, -s * .98); ctx.lineTo(s * .72, -s * .22); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = GNOME.leatherDark; ctx.fillRect(-s * .69, -s * .27, s * 1.4, s * .18);
  if (leader) { ctx.strokeStyle = GNOME.leather; ctx.beginPath(); ctx.moveTo(s * .55, s * .2); ctx.lineTo(s * .55, -s * 1.3); ctx.stroke(); ctx.fillStyle = GNOME.mossLight; ctx.beginPath(); ctx.moveTo(s * .55, -s * 1.3); ctx.lineTo(s * 1.18, -s * 1.08); ctx.lineTo(s * .55, -s * .84); ctx.fill(); }
}

registerCrew("gnomes", {
  displayName: "Garden Gnomes",
  fig: gnomeSVG,
  head: gnomeHead,
  impl: gnomeImpl,
  pet: gnomePet,
  petProfile: GNOME_PET_PROFILE,
  climber: gnomeClimber,
  css: [
    ".gardenfig .gnome-body,.gardenfig .gnome-tool,.gardenfig .cap,.gardenfig .cap-tip,.gardenfig .beard,.gardenfig .gnome-fx{transform-box:fill-box}",
    ".gardenfig .gnome-fx{fill:none;stroke:#86a65d;stroke-width:1.1;opacity:0;transform-origin:center}",
    ".gnome .gardenfig .gnome-tool{transform-origin:0 100%}",
    ".gnome:not(.idle):not(.off) .gardenfig .cap-tip{transform-origin:left center;animation:gnome-cap-wag var(--spd,1.2s) ease-in-out infinite}@keyframes gnome-cap-wag{50%{transform:rotate(9deg)}}",
    ".gnome:not(.idle):not(.off) .gardenfig .beard{transform-origin:top center;animation:gnome-beard-bob var(--spd,1.2s) ease-in-out infinite reverse}@keyframes gnome-beard-bob{50%{transform:scaleY(.94) skewX(2deg)}}",
    ".gnome.frenzy .gardenfig .gnome-fx{opacity:.85;animation:gnome-rustle .7s ease-out infinite}@keyframes gnome-rustle{0%{transform:scale(.72) rotate(0);opacity:.9}100%{transform:scale(1.15) rotate(20deg);opacity:0}}",
    ".gnome.frenzy .gardenfig .hat-band{filter:drop-shadow(0 0 2px #e4ad3f)}",
    ".gnome.idle .gardenfig .cap{transform-origin:bottom center;transform:rotate(8deg)}",
    ".garden-pet{filter:drop-shadow(1px 0 #fff) drop-shadow(-1px 0 #fff) drop-shadow(0 1px #fff) drop-shadow(0 -1px #fff)}",
    ".garden-pet .pet-cap{transform-box:fill-box;transform-origin:bottom left;animation:pet-cap-wag 2.1s ease-in-out infinite}@keyframes pet-cap-wag{50%{transform:rotate(4deg)}}",
    ".garden-pet .pet-beard{transform-box:fill-box;transform-origin:top center;animation:pet-beard 1.5s ease-in-out infinite}@keyframes pet-beard{50%{transform:scaleY(.96)}}",
    ".garden-pet .pet-eyes{transform-box:fill-box;transform-origin:center;animation:gnome-blink 4.3s steps(1,end) infinite}@keyframes gnome-blink{0%,93%,100%{transform:scaleY(1)}94%,96%{transform:scaleY(.12)}}",
    ".garden-pet .pet-acorn{transform-box:fill-box;transform-origin:center;animation:pet-acorn 2.4s ease-in-out infinite}@keyframes pet-acorn{50%{transform:rotate(-5deg) translateY(-1px)}}",
    ".garden-pet .pet-juggle{transform-box:fill-box;transform-origin:center;animation:pet-juggle .62s ease-in-out infinite alternate}@keyframes pet-juggle{to{transform:translateY(-2px)}}",
    "@media (prefers-reduced-motion:reduce){.gardenfig *,.garden-pet *{animation:none!important}}",
  ].join("\n"),
});
