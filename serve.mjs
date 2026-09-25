// Live usage dashboard server: serves tools/usage/index.html and refreshes the
// payload incrementally every 10 s. Usage: node tools/usage/serve.mjs
// (PORT env var overrides 4317). Binds 127.0.0.1 only.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCollector } from "./collect.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexFile = path.join(here, "index.html");
const PORT = process.env.PORT ? Number(process.env.PORT) : 4317;
const INTERVAL_MS = 10_000;

const collector = createCollector();
let payload = null;
let etag = "";

// UI prefs shared across browsers/ports/restarts. Local copy in the page is
// instant; this file is the durable quorum (last write wins via updatedAt).
const PREF_KEYS = ["preset", "tools", "project", "group", "metric", "mixPct", "logT", "logC", "prevT", "prevC",
  "gnomes", "collapsed", "includeSub", "sortKey", "sortDir", "from", "to"];
const prefsFile = process.env.USAGE_PREFS ?? path.join(here, ".usage-prefs.json");
function readPrefs() {
  try {
    const p = JSON.parse(fs.readFileSync(prefsFile, "utf8"));
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}

export function computeEtag(p) {
  // Content hash: catches in-place edits (streaming messages) that a
  // row-count + last-timestamp pair misses. Rows are already sorted by ts,
  // so a stable stringify of the row array is enough.
  if (!p || !Array.isArray(p.rows) || !p.rows.length) return "0:empty";
  const h = crypto.createHash("sha1");
  h.update(String(p.rows.length));
  h.update("|");
  h.update(JSON.stringify(p.rows));
  return `"${h.digest("hex").slice(0, 27)}"`;
}

function refresh() {
  const t0 = Date.now();
  payload = collector.collect();
  const ms = Date.now() - t0;
  const next = computeEtag(payload);
  const changed = next !== etag;
  etag = next;
  if (changed) {
    console.log(`${new Date().toISOString()} records=${payload.rows.length} ms=${ms}`);
  }
  return ms;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(indexFile, "utf8"));
  } else if (req.method === "GET" && url.pathname === "/api/prefs") {
    const p = readPrefs();
    if (!p) {
      res.writeHead(404, { "Cache-Control": "no-store" });
      res.end("{}");
    } else {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(p));
    }
  } else if (req.method === "POST" && url.pathname === "/api/prefs") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 16384) req.destroy(); // prefs are <1KB; drop floods
    });
    req.on("end", () => {
      try {
        const raw = JSON.parse(body);
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("bad prefs");
        const clean = {};
        for (const k of PREF_KEYS) if (raw[k] !== undefined) clean[k] = raw[k];
        clean.updatedAt = Date.now(); // server stamps: last write wins
        fs.writeFileSync(prefsFile, JSON.stringify(clean), "utf8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      } catch {
        res.writeHead(400);
        res.end("bad prefs");
      }
    });
  } else if (req.method === "GET" && url.pathname === "/api/usage") {
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304);
      res.end();
    } else {
      const body = JSON.stringify(payload);
      res.writeHead(200, {
        "Content-Type": "application/json",
        ETag: etag,
        "Cache-Control": "no-store",
      });
      res.end(body);
    }
  } else {
    res.writeHead(404);
    res.end("not found");
  }
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`port ${PORT} busy: another usage server already running? (quit it or set PORT=4321)`);
    process.exit(1);
  }
  throw err;
});

console.log("usage: collecting… (first run parses all sessions, can take under a minute)");
refresh(); // collect once at startup
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    try { collector.flush(); } catch { /* best effort */ }
    process.exit(0);
  });
}
server.listen(PORT, "127.0.0.1", () => {
  console.log(`usage: live at http://127.0.0.1:${PORT}`);
  const tick = () => {
    try {
      refresh();
    } catch (err) {
      console.warn(`warning: refresh failed (${err.message})`);
    }
    setTimeout(tick, INTERVAL_MS); // chained so two runs never overlap
  };
  setTimeout(tick, INTERVAL_MS);
});
