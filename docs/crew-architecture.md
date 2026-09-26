# Crew artwork architecture

## Purpose

Crew files own a theme's identity: figures, small support heads, held implements,
the page pet, optional chart art, personality data, and crew-scoped animation CSS.
The dashboard owns lifecycle and data: selecting a crew, translating token rates
into UI states, scheduling page-pet actions, and moving the pet through the page.

This split keeps character work local to `crews/<id>.js` while allowing the shared
controller to gain capabilities without duplicating timers or movement loops.

## Registration contract

Each crew calls `registerCrew(id, definition)` from `crews/registry.js`.

```js
registerCrew("example", {
  displayName: "Example Crew", // human-readable Settings label
  fig(tool),                 // header figure SVG, viewBox 0 0 66 60
  head(key, color),          // support-staff head SVG, viewBox 0 0 44 44
  impl(tool, helpers),       // implement rooted at hand position 0,0
  pet(pose, frame),          // page-pet SVG, viewBox 0 0 64 64
  petProfile: {              // optional; defaults preserve legacy behavior
    greetings: ["..."],
    weights: { walk: 30, run: 10, sit: 20, wave: 10, special: 0, hop: 5, nap: 10, spin: 2 },
    speed: { walk: [40, 100], run: [200, 360] },
    timing: { sit: [1500, 6000], wave: [1500, 2400], nap: [5000, 11000], hopDuration: .5 },
    labels: { special: "signature action", wave: "wave", walk: "stroll", run: "dash" },
    interaction: "wave", // action used on click and contextual greetings
  },
  climber(ctx, size, leader), // optional cost-chart canvas figure
  css: "...",                // optional crew-scoped animation CSS
});
```

`displayName` and the four rendering functions are required. The lowercase ID
remains the stable value stored in preferences; changing the display name does
not break a saved selection. A crew without `petProfile` uses
`DEFAULT_PET_PROFILE` in `index.html`; a crew without `climber` continues through
the existing chart fallbacks.

### Header figures

`fig(tool)` is called once per harness (`claude`, `codex`, `opencode`, and any
added harness). A crew may draw one character recolored per tool, as the gnomes
do with `COLORS[tool]` hats, or a distinct character per tool, as a private
One-Punch Man crew does with per-tool `pick-<character>` classes.

The dashboard applies `.idle`, `.off`, and `.frenzy` to each `.gnome` wrapper
and sets `--spd` (seconds per cycle, faster with higher token rate). Inside the
SVG it animates two shared hooks:

| Hook | Default dashboard motion |
|---|---|
| `.bob` | Whole-body bounce at `--spd`. |
| `.swing` | Implement swing at `--spd`, origin near the hand. |

Figures also expose `.f-work`, `.f-idle`, and `.f-frenzy` facial groups; the
dashboard shows the one matching the current state. Give the root `<svg>` a
unique class (`gardenfig`, `onepunchfig`) and scope all crew CSS beneath it.
A crew may override the shared hooks (for example
`.gnome .onepunchfig .swing{animation:none}`) and animate smaller semantic
groups such as cap, beard, cape, jets, or aura rather than the entire SVG.

Header art is displayed at 52×52 CSS pixels. Strong silhouette, color blocking,
and one or two identifying details matter more than very fine paths.

### Heads and implements

`head(key, color)` draws the small faces used by KPI mascots, porters, the
subagent baby, and arm-wrestlers, at sizes from about 19px to 30px. The root
`<svg>` **must** carry the class `ghead` or `ahead`; the dashboard sizes heads
by those classes. `key` is a tool ID or a helper name; `color` is the accent to use.

`impl(tool, helpers)` returns SVG fragments drawn with the hand at `0,0`.
`helpers` is `{ grip, col, COLORS }`, where `grip` is a ready-made handle line
that a crew may prepend or ignore.

### Page-pet controller

The controller schedules `sit`, `wave`, `walk`, `run`, `hop`, `nap`, `spin`,
and the opt-in `special` action. `pet(pose, frame)` receives only the poses
that need art: `sit`, `wave`, `walk`, `run`, `nap`, and `special`. `hop` is
drawn with `run` art plus a vertical lift, and `spin` with `wave` art plus a
direction flip. `frame` counts up while a pose is held, so alternate on
`frame % 2` for two-frame motion. The dashboard mirrors the pet for leftward
travel, so draw it facing right.

`petProfile` changes selection weights, movement speed, dwell timing, dialogue,
and accessible action labels. Missing fields fall back per key to
`DEFAULT_PET_PROFILE` in `index.html`. A weight of `0` disables an action.
`special` is selected only when a crew gives it weight or names it as
`interaction`, the action used on click and after a nap. The gnomes use
`special` for an acorn juggle; One-Punch Man uses it for a normal punch and
sets `wave` and `spin` to `0`. The profile contains serializable data only.
Rendering stays in `pet()`, and scheduling stays in the shared controller.

### Motion and accessibility

End crew CSS with a `prefers-reduced-motion: reduce` rule that disables every
crew animation, for example
`@media (prefers-reduced-motion:reduce){.gardenfig *,.garden-pet *{animation:none!important}}`.
Give the pet root a light outline (the built-in crews use stacked white
`drop-shadow` filters) so it stays readable over dark charts.

## Adding or upgrading another crew

Start with a character matrix: tool mapping, identifying silhouette, work/idle/
frenzy expression, signature movement, implement, and pet personality. Build and
check the header at 52px before adding secondary detail. Then implement heads,
pet frames, `petProfile`, optional climber art, and scoped CSS. Verify light/dark
themes, all activity states, both travel directions, reduced motion, and that a
style switch immediately refreshes pet art, dialogue, title, and timing.

Keep crew-specific conditionals out of the controller. If a future character
needs a genuinely new action—not merely a reinterpretation of an existing pose—
extend the shared action vocabulary and provide a safe default for every crew.

## Creating a crew with AI

Use this prompt with an AI coding assistant from the Token Garden directory:

> Create a Token Garden crew for `<character or concept>`. Study the reference
> images I provide, then read `docs/crew-architecture.md`, `crews/registry.js`,
> and `crews/gnomes.js`. Build `crews/private/<name>.js` with detailed inline SVG
> art. Make the proportions, silhouette, face, hair, clothing, props, palette,
> materials, shading, expressions, and signature motion accurate and lifelike,
> while keeping details readable at the real 52px header and 64px pet sizes.
> Implement every required crew state, keep changes inside the crew extension
> points, add no network or telemetry code, and iteratively inspect and refine
> work, idle, frenzy, filtered, page-pet, light, and dark renders.

The `crews/private/` directory is gitignored so personal experiments do not
accidentally enter the public repository. Live mode discovers direct `.js`
files in that directory automatically. A crew file is executable JavaScript:
review its code before installing it. Move a finished crew into `crews/` only
when you intend to publish it with the repository, and only with artwork you
have the right to share (fan art of existing characters usually is not).
