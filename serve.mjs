// Live usage dashboard server: serves tools/usage/index.html and refreshes the
// payload incrementally every 10 s. Usage: node tools/usage/serve.mjs
// (PORT env var overrides 4317). Binds 127.0.0.1 only.
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

function computeEtag(p) {
  const tsi = p.fields.indexOf("ts");
  const lastTs = p.rows.length ? p.rows[p.rows.length - 1][tsi] : 0;
  return `${p.rows.length}:${lastTs}`;
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

refresh(); // collect once at startup
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
