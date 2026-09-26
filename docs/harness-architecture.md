# Harness adapter guide

A harness is a local coding-agent data source such as Claude Code, Codex,
OpenCode, Cursor, or CommandCode. Token Garden ships three adapters. Adding a
new one takes one collector registration in `collect.mjs` and one UI entry in
`index.html`.

## How collection runs

`serve.mjs` calls `collect()` synchronously every 10 s, and every source runs
on each call. An adapter must therefore be incremental: re-reading an unchanged
multi-megabyte log on every tick stalls the server. File-based adapters use the
per-file cache (`refreshCache`); database adapters keep one read-only
connection open and reuse prepared statements.

If a collector throws, the collector logs a warning and the source contributes
0 records for that tick. For transient failures, such as a locked database,
return the previous tick's records instead, as the OpenCode adapter does on
`SQLITE_BUSY`.

## Record contract

Each collector returns plain objects with these fields:

| Field | Meaning |
|---|---|
| `tool` | Stable lowercase harness ID; must match the `sources` and `TOOL_CONFIG` key. |
| `session` | Stable session ID (hashed in anonymized snapshots). |
| `title` | First useful user message, passed through `cleanTitle()`, or `null`. |
| `project`, `workspace` | Display names from `resolveWorkspace(cwd)`; never full paths. |
| `model` | Model ID as the harness reports it; drives price lookup. |
| `ts` | Unix timestamp in milliseconds. |
| `input` | Fresh (uncached) input tokens. Subtract cached tokens if the harness includes them. |
| `cacheRead`, `cacheWrite`, `output`, `reasoning` | Non-negative token counts. |
| `reasoningSeparate` | `1` only when reasoning is **not** already included in `output`. |
| `cost` | Stored USD cost, `costFor(model, tokens)` for an estimate, or `null`. |
| `sidechain` | `true` for subagent/child-session usage, otherwise `false`. |
| `estimated` | `1` when counts are guessed from text length, otherwise `0`. |
| `active` | `activeOf(...)`: fresh input + output + separately reported reasoning. |

Rows travel to the browser as arrays in `FIELDS` order. Properties not in
`FIELDS` (such as the Claude adapter's internal `_key`) are dropped. A genuinely
new field must be appended to the end of `FIELDS`, never inserted, so older
snapshots keep working, and `index.html` must default it when missing.

## Add an adapter

1. Locate and understand the harness's local logs or database. Open source data
   read-only and tolerate missing, locked, partial, and malformed records.
2. Add a parser and collector inside `createCollector()` in `collect.mjs`.
   Resolve every path from the `home` passed to `createCollector({ home })`,
   not `os.homedir()`, so tests can use a temporary directory. Reuse
   `walkJsonl`, `refreshCache`, `resolveWorkspace`, and `cleanTitle`.
   Deduplicate usage that the harness writes more than once.
3. For file-based adapters, add a cache map to the saved and loaded
   `.usage-cache.json` sections (next to `claude` and `codex`) and bump
   `CACHE_VERSION`. Without this, every server restart re-parses all files.
4. Add `{ id, collect }` once to the `sources` registry in `collect()`.
   `TOKEN_GARDEN_SOURCES` then supports the ID automatically.
5. Add the same ID with a `label` and `color` to `TOOL_CONFIG` in `index.html`.
   Filters, charts, tables, the Settings harness list, and crew figures are
   generated from it. Crews receive the new ID in `fig(tool)`, so check that
   installed crews render an unknown tool sensibly.
6. Use `costFor()` when the harness does not store cost. Document whether its
   reasoning tokens are included in output.
7. Add a synthetic fixture test in `test/collect.test.mjs`. Never commit real
   logs, prompts, paths, session IDs, or databases.
8. Add a row to the README data-source table, then run the checks in
   `AGENTS.md`: `npm test`, syntax checks, and a live-server check covering
   filters, empty states, and malformed input.

## AI prompt

> Add Token Garden support for `<harness>`. Read
> `docs/harness-architecture.md`, `collect.mjs`, and the `TOOL_CONFIG` in
> `index.html`. Inspect only the sample data I provide and treat it as private.
> Implement a read-only, incremental collector that emits the normalized record
> contract, handles deduplication and partial data, persists its file cache if
> it reads log files, registers once in `sources`, and adds one UI config entry.
> Preserve existing adapters and filtering. Use synthetic fixtures, expose no
> private content in tests or output, run all documented checks, and summarize
> the schema decisions and exact files changed.
