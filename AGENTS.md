# Token Garden agent guide

## Goal

Token Garden is a dependency-free Node.js 22+ dashboard for local Claude Code,
Codex, and OpenCode usage. Keep it local, private-data-aware, and simple to run:
no dependencies, no build step, no bundler, no framework.

## Set up and run

1. Confirm `node --version` is 22 or newer. Do not run `npm install`; there are
   no package dependencies.
2. Run `npm run usage:serve` and wait for it to print its URL, normally
   `http://127.0.0.1:4317`. If the port is busy, another instance is running;
   stop it or set `PORT`.
3. Use `TOKEN_GARDEN_SOURCES=claude,codex,opencode` to collect only selected
   sources, and `TOKEN_GARDEN_OFFLINE=1` to skip the price-table download. The
   README's Configuration table lists every environment variable.

The first collection can take a minute; later starts use `.usage-cache.json`.
The Settings modal controls which collected sources are visible, independently
of `TOKEN_GARDEN_SOURCES`.

## Architecture

| File | Role |
|---|---|
| `collect.mjs` | Per-harness parsers and `createCollector()`, which caches parsed records per file (mtime + size) in `.usage-cache.json`. Also the CLI for `data.js`, JSON aggregates, and anonymized snapshots. |
| `serve.mjs` | Loopback HTTP server. Calls `collect()` every 10 s, serializes and gzips the payload only when its row hash changes, and serves it with an ETag. |
| `prices.mjs` | Model prices: LiteLLM snapshot over the built-in `PRICES` table, matched by model-name prefix. |
| `index.html` | The entire UI in one file: CSS, plain JS, and the `TOOL_CONFIG` harness registry. Chart.js comes from an SRI-pinned CDN build. |
| `crews/`, `i18n/` | Plain scripts the page loads: crew art and UI strings. |

Rows travel as arrays in `FIELDS` order to keep the payload small.

## What needs a restart

- `index.html`, `crews/`, and `i18n/` are served uncached: reload the page.
- `collect.mjs`, `serve.mjs`, and `prices.mjs`: restart the server.
- Any change to a parser or to record shape: bump `CACHE_VERSION` in
  `collect.mjs`. Otherwise unchanged log files keep their old cached records
  and the fix appears not to work.

## Conventions

- New UI text goes in both `i18n/en.js` and `i18n/zh-Hant.js` and is read with
  `t(key)`, or `t(key, { n })` for `{n}`-style placeholders. Never branch on
  `state.lang` for UI text. Keep keys identical across locales. To add a language, follow the
  header comment in `i18n/en.js`.
- A new persisted UI preference must also be added to `PREF_KEYS` in
  `serve.mjs`, or the server silently drops it.
- A new record field is appended to the end of `FIELDS`, never inserted, and
  defaulted in `index.html` for older payloads.
- Match the surrounding style: small functions, brief comments that explain
  why, no new files when an existing extension point fits.

## Private local files

Never commit or share `data.js`, `snapshot.json`, `prices-cache.json`,
`.usage-cache.json`, `.usage-prefs.json`, or files under `crews/private/`.
Session titles can contain user prompts; project and workspace values can
contain local path information. Use `node collect.mjs --snapshot=snapshot.json`
only when an anonymized export is explicitly requested.

Screenshots for the repository or issues may show aggregate numbers and charts,
but not the sessions table, session titles, project names, or paths. Never put
real usage payloads in test output.

## Create a local crew

1. Read `docs/crew-architecture.md`, `crews/registry.js`, and `crews/gnomes.js`.
2. Create `crews/private/<name>.js`; the directory is gitignored and live mode
   discovers it automatically. Do not edit `index.html` to install a crew.
3. Follow the registration contract in the crew guide and keep all art inline.
   Add no dependencies, remote loaders, telemetry, or network requests; the
   page's Content Security Policy blocks outbound requests anyway.
4. Treat every crew file as executable code and review it before installing.
5. Test the states listed in the crew guide at their real rendered sizes.
6. Crews depicting existing copyrighted characters stay in `crews/private/`.
   Only original art may move to `crews/`.

Changes to the shared crew contract (a new pet action, a new figure hook) must
give every existing crew a safe default and update `docs/crew-architecture.md`.

## Add a harness

Follow `docs/harness-architecture.md`. In short: read the source without
modifying it, collect incrementally, normalize to the record contract, persist
the file cache, register once in `sources`, and add one `TOOL_CONFIG` entry.
Use synthetic fixtures; never commit real prompts, paths, session IDs,
databases, or logs.

## Security boundaries

Keep these intact; `test/serve.test.mjs` covers them:

- Bind to `127.0.0.1` only; never deploy the server or listen on other interfaces.
- `Host` allowlist and foreign-`Origin` rejection in `serve.mjs`.
- `POST /api/prefs` requires `application/json`, stays under 16 KB, and keeps
  only `PREF_KEYS`.
- The page's Content Security Policy. A new external script origin or a
  `connect-src` other than `'self'` needs a clear reason in the change description.
- Static routes accept only flat file names; no path segments.
- Escape every log-derived string with `esc()` before inserting it as HTML.
- Write local state with `writeFileAtomic()`.

## Validate changes

1. `npm test`. Tests use synthetic fixtures and a temporary home directory;
   any new test that starts the server sets `HOME`, `USERPROFILE`,
   `USAGE_CACHE`, `USAGE_PREFS`, and `TOKEN_GARDEN_OFFLINE=1`, as
   `test/serve.test.mjs` does.
2. `node --check` on every changed JavaScript file, and `git diff --check`.
3. For dashboard changes, start the server, load the page, and check the browser
   console for errors and Content Security Policy violations. Verify `/`
   returns 200 and a request with a non-local `Host` header returns 403.
4. Update the README and the relevant `docs/` guide when behavior, commands,
   files, or extension contracts change.

## Before publishing or pushing

Run `git status --ignored` and confirm none of the private files above are
staged. Local tools may create extra refs (for example `refs/codex/*`
checkpoints) that snapshot the working tree; push branches explicitly and never
use `git push --mirror` or `--all`.
