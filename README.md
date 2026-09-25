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
- **Filters:** tool, project (the last folder name of the session's working directory), and whether to include subagent sessions.
- **KPI tiles:** total tokens, fresh input, cache read, cache write, output, cache hit rate, estimated cost, number of sessions, and average tokens per session. Each tile shows the change against the previous period of the same length.
- **Charts:** tokens over time (stacked by tool), cost over time, token mix per tool, top models, and a weekday × hour activity heatmap.
- **Sessions table:** sortable. OpenCode sessions started by `scripts/delegate.sh` show the packet id (e.g. `U-02-usage-live`) as their title.

## Data sources

| Tool | Where it reads | Notes |
|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | `message.usage` on assistant lines. Deduped on `message.id:requestId`, because the same response is written several times. Sidechain (subagent) lines are flagged. |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `token_count` events, using `last_token_usage` per turn. The cumulative `total_token_usage` is never summed. `cached_input_tokens` is subtracted from input. |
| OpenCode | `~/.local/share/opencode/opencode.db` (SQLite, opened read-only) | Reads both the v1 `message`/`session` tables and the v2 `session_message`/`session_v2` tables (the v2 tables are what `opencode2` writes). |

## How tokens and cost are counted

- **Total** = fresh input + cache read + cache write + output. OpenCode reasoning is added on top because OpenCode reports it separately. Codex reasoning is already part of its output, and Claude doesn't report it.
- Most of the volume is cache reads, which are much cheaper. Check the fresh input tile and the token-mix chart before reading much into the total.
- **Cost:** OpenCode costs are the ones OpenCode stores itself. Claude and Codex costs are **estimates** from the hardcoded price table in `prices.mjs`, matched on model-name prefix. Models with no matching price show `—`. Edit `prices.mjs` to add or correct prices.

## Files

| File | Purpose |
|---|---|
| `collect.mjs` | Collectors. The CLI writes `data.js`. Also exports `createCollector()`, which caches each JSONL file by mtime and size so refreshes only re-parse changed files. |
| `serve.mjs` | Local HTTP server: `/` serves the page, `/api/usage` returns JSON (ETag/304 when nothing changed). |
| `prices.mjs` | USD per 1M tokens, looked up by model-name prefix. |
| `index.html` | The dashboard: a single file with plain JS and Chart.js. |
| `data.js` | The generated snapshot. It's gitignored because it contains local paths. |

## Known limits

- The first collection after starting the server takes about 6–9 s. Later refreshes take under 1 s.
- The ETag is the row count plus the latest timestamp. If a record's token counts change in place (for example, an OpenCode message that is still streaming), the update may not show until the next new record arrives.
- Session titles only exist for OpenCode. Claude and Codex sessions show a shortened session id.
