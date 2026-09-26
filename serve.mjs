// Live usage dashboard server: serves index.html and refreshes the payload
// incrementally every 10 s. Usage: node serve.mjs
// (PORT env var overrides 4317). Binds 127.0.0.1 only.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { createCollector, writeFileAtomic } from "./collect.mjs";
import { startPriceRefresh } from "./prices.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexFile = path.join(here, "index.html");
const PORT = process.env.PORT ? Number(process.env.PORT) : 4317;
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([...ALLOWED_HOSTS].map((h) => `http://${h}`));
const INTERVAL_MS = 10_000;
const MAX_PREFS_BYTES = 16_384;
// Scripts: self (i18n/crews) + the SRI-pinned Chart.js CDN build. connect-src
// 'self' keeps any page script (including installed crews) from sending usage
// data elsewhere.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const collector = createCollector();
// Serialized once per change, not per request: the payload can be several MB.
let body = "{}";
let gzipped = null;
let etag = "";

// UI prefs shared across browsers/ports/restarts. Local copy in the page is
// instant; this file is the durable quorum (last write wins via updatedAt).
const PREF_KEYS = ["lang", "crewStyle", "preset", "tools", "kpis", "project", "group", "metric", "mixPct", "logT", "logC", "prevT", "prevC",
  "gnomes", "collapsed", "includeSub", "sortKey", "sortDir", "headingText", "hideHeading", "tabTitleText", "from", "to"];
const prefsFile = process.env.USAGE_PREFS ?? path.join(here, ".usage-prefs.json");
function readPrefs() {
  try {
    const p = JSON.parse(fs.readFileSync(prefsFile, "utf8"));
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}

function listCrewScripts() {
  const safeFiles = (dir, urlPrefix) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /^[A-Za-z0-9][A-Za-z0-9_.+-]*\.js$/.test(entry.name))
        .map((entry) => `${urlPrefix}${entry.name}`);
    } catch {
      return [];
    }
  };
  return [
    ...safeFiles(path.join(here, "crews"), "/crews/"),
    ...safeFiles(path.join(here, "crews", "private"), "/crews/private/"),
  ].filter((url) => !url.endsWith("/registry.js"));
}

function refresh() {
  const t0 = Date.now();
  const payload = collector.collect();
  const ms = Date.now() - t0;
  // Content hash over rows only (generatedAt changes every tick): catches
  // in-place edits (streaming messages) that a count/last-ts pair misses.
  const rowsJson = JSON.stringify(payload.rows);
  const next = `"${crypto.createHash("sha1").update(rowsJson).digest("hex").slice(0, 27)}"`;
  if (next === etag) return ms;
  etag = next;
  const { rows, ...rest } = payload;
  body = JSON.stringify(rest).replace(/}$/, `,"rows":${rowsJson}}`);
  gzipped = zlib.gzipSync(body, { level: 6 });
  console.log(`${new Date().toISOString()} records=${rows.length} ms=${ms} bytes=${body.length} gz=${gzipped.length}`);
  return ms;
}

function readJsonBody(req, res, onJson) {
  let size = 0;
  const chunks = [];
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_PREFS_BYTES) {
      res.writeHead(413, { Connection: "close" });
      res.end("too large");
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    let raw;
    try { raw = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { raw = undefined; }
    onJson(raw);
  });
}

const server = http.createServer((req, res) => {
  // Reject DNS-rebinding requests before returning private usage data.
  const host = String(req.headers.host || "").toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("forbidden host");
    return;
  }
  // Reject cross-site requests (CSRF from any page open in the browser).
  // Browsers always send Origin on cross-origin fetches and on POSTs.
  const origin = req.headers.origin;
  if (origin !== undefined && !ALLOWED_ORIGINS.has(String(origin).toLowerCase())) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("forbidden origin");
    return;
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP, "Cache-Control": "no-store" });
    res.end(fs.readFileSync(indexFile, "utf8"));
  } else if (req.method === "GET" && url.pathname === "/favicon.ico") {
    res.writeHead(204, { "Cache-Control": "public, max-age=86400" });
    res.end();
  } else if (req.method === "GET" && url.pathname.startsWith("/i18n/")) {
    const name = url.pathname.slice("/i18n/".length);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.+-]*\.js$/.test(name)) {
      res.writeHead(400);
      res.end("bad locale");
    } else {
      try {
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
        res.end(fs.readFileSync(path.join(here, "i18n", name), "utf8"));
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    }
  } else if (req.method === "GET" && url.pathname.startsWith("/crews/")) {
    const match = url.pathname.match(/^\/crews\/(?:(private)\/)?([A-Za-z0-9][A-Za-z0-9_.+-]*\.js)$/);
    if (!match) {
      res.writeHead(400);
      res.end("bad crew file");
    } else {
      const dir = match[1] ? path.join(here, "crews", "private") : path.join(here, "crews");
      try {
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
        res.end(fs.readFileSync(path.join(dir, match[2]), "utf8"));
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    }
  } else if (req.method === "GET" && url.pathname === "/api/crews") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(listCrewScripts()));
  } else if (req.method === "GET" && url.pathname === "/api/prefs") {
    const p = readPrefs();
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(p ?? {}));
  } else if (req.method === "POST" && url.pathname === "/api/prefs") {
    // application/json is not a CORS "simple" type, so a cross-site form or
    // no-cors fetch cannot reach this handler even without an Origin header.
    if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
      res.writeHead(415);
      res.end("expected application/json");
      return;
    }
    readJsonBody(req, res, (raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        res.writeHead(400);
        res.end("bad prefs");
        return;
      }
      const clean = {};
      for (const k of PREF_KEYS) if (raw[k] !== undefined) clean[k] = raw[k];
      clean.updatedAt = Date.now(); // server stamps: last write wins
      try {
        writeFileAtomic(prefsFile, JSON.stringify(clean));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      } catch {
        res.writeHead(500);
        res.end("could not save prefs");
      }
    });
  } else if (req.method === "GET" && url.pathname === "/api/usage") {
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { ETag: etag });
      res.end();
    } else {
      const gz = gzipped && /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
      res.writeHead(200, {
        "Content-Type": "application/json",
        ETag: etag,
        "Cache-Control": "no-store",
        Vary: "Accept-Encoding",
        ...(gz ? { "Content-Encoding": "gzip" } : {}),
      });
      res.end(gz ? gzipped : body);
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
startPriceRefresh(); // no-op when TOKEN_GARDEN_OFFLINE=1
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
