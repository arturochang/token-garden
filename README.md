# Token usage dashboard

A local dev tool that shows token usage and estimated cost across **Claude Code**, **Codex** and **OpenCode** sessions on this machine. It isn't part of the app and is never deployed.

## Run it

**Live (recommended):**

```sh
npm run usage:serve
```

Then open http://127.0.0.1:4317. The server collects usage every 10 s, and the page polls it every 10 s, so new usage appears within about 15 s. Filters, time range, sort order and scroll position stay the same across refreshes. The header shows `Live · updated Ns ago`, with a red dot when the server is unreachable. Set the `PORT` env var to change the port. The server only listens on 127.0.0.1.

**Static snapshot:**

```sh
npm run usage
```

Then open `tools/usage/index.html` straight from disk. This writes `data.js`, a one-time snapshot, and the page doesn't refresh. Rerun the command to update it.

Both modes load Chart.js from jsDelivr, so the page needs an internet connection.

## What it shows

- **Time range:** 1h, 6h, Today, 7d, 30d, 90d, All, or custom dates. Chart bars are 5 min wide for 1h, 15 min for up to 6h, hourly for up to 2 days, daily for up to 120 days, and weekly beyond that.
- **Filters:** tool, project (last folder of the session cwd), group-by (model / project / workspace / tool+model / workspace+model), and whether to include subagent sessions. Filters, time range, sort order and group-by persist in localStorage.
- **KPI tiles:** total tokens, active tokens, fresh input, cache read, cache write, output, cache hit rate, estimated cost (with $/1M-active unit cost), number of sessions, and average active tokens per session. Header notes `incl. N estimated` when text-length fallbacks are present (marked `~` in the table). Deltas have per-tile polarity (hit-rate up = green, token/cost up = red, sessions/averages neutral). 7d+ ranges compare against the previous period; 1h/6h/Today compare against the same clock window yesterday.
- **Charts:** tokens over time (stacked by tool, zero-filled gaps, idle tool series hidden, in-progress bar dimmed), cost over time (monotone-smooth), token mix per tool (empty tools hidden), top groups (follows group-by), top cost by model, month-to-date cumulative spend, cache hit rate trend, most-expensive-sessions top 10, and a weekday × hour activity heatmap over the trailing 28d (metric switch: tokens/active/cost) with a rhythm panel (peak hour/weekday, night/weekend share, streak, window cost).
- **Sessions table:** sortable, with workspace (auto-hidden when identical to project), active, and `~` estimated flag. Claude/Codex titles come from the first user message; OpenCode sessions started by `scripts/delegate.sh` show the packet id (e.g. `U-02-usage-live`) as their title.
- **Theme:** auto (follows OS) / dark / light toggle in the header, persisted. Charts re-tint on switch.

## Data sources

| Tool | Where it reads | Notes |
|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | `message.usage` on assistant lines. Deduped on `message.id:requestId`, because the same response is written several times. Sidechain (subagent) lines are flagged. Title = first user message. |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `token_usage_record` payloads count as per-request increments; `token_count` events prefer `last_token_usage` with cumulative `total_token_usage` diff fallback. Dedupe on response/request id + turn, with reset handling. `cached_input_tokens` is subtracted from input. Files with no usage fields yield one `estimated` record from text length (CJK-aware). Title = first user message. |
| OpenCode | `~/.local/share/opencode/opencode.db` (SQLite, opened read-only) | Reads both the v1 `message`/`session` tables and the v2 `session_message`/`session_v2` tables (the v2 tables are what `opencode2` writes). |

## How tokens and cost are counted

- **Total** = fresh input + cache read + cache write + output. OpenCode reasoning is added on top because OpenCode reports it separately. Codex reasoning is already part of its output, and Claude doesn't report it.
- **Active** = fresh input + output (+ reasoning for OpenCode). Ignores cache reads; closer to "new work done".
- Most of the volume is cache reads, which are much cheaper. Check the fresh input tile and the token-mix chart before reading much into the total.
- **Cost:** OpenCode costs are the ones OpenCode stores itself. Claude and Codex costs are **estimates**: `prices.mjs` layers a LiteLLM snapshot (`prices-cache.json`, 1h TTL, `node collect.mjs --refresh-prices` to force) over the hardcoded fallback, matched on model-name prefix. Models with no matching price show `—`.
- **Workspace:** git worktrees roll into the parent repo (`.git` file `gitdir:` pointer resolution, string-identity only — renames/nested repos resolve to their own root).

## Scripting

```sh
node collect.mjs --json --group-by=workspace+model  # aggregates to stdout
node collect.mjs --json --group-by=tool --out=groups.json  # UTF-8 file (preferred on Windows: `>` writes UTF-16)
node collect.mjs --snapshot=snapshot.json           # anonymized share (hashed sessions, no titles)
```

## Files

| File | Purpose |
|---|---|
| `collect.mjs` | Collectors. The CLI writes `data.js`. Also exports `createCollector()`, which caches each JSONL file by mtime and size so refreshes only re-parse changed files. |
| `serve.mjs` | Local HTTP server: `/` serves the page, `/api/usage` returns JSON (content-hash ETag/304 when nothing changed). |
| `prices.mjs` | USD per 1M tokens, looked up by model-name prefix. |
| `prices-cache.json` | LiteLLM snapshot cache (gitignored, 1h TTL). |
| `index.html` | The dashboard: a single file with plain JS and Chart.js. |
| `data.js` | The generated snapshot. It's gitignored because it contains local paths. |

## Known limits

- The first collection after starting the server takes about 6–9 s. Later refreshes take under 1 s.
- Session titles for Claude/Codex are the first user message (truncated); low-value system prompts are skipped.
