// Server boundary tests: host/origin checks, CSRF guard, prefs allowlist.
// Runs the real server against an empty synthetic home directory.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 43000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${PORT}`;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "token-garden-serve-"));
let child;

test.before(async () => {
  child = spawn(process.execPath, [path.join(root, "serve.mjs")], {
    env: {
      ...process.env, PORT: String(PORT), HOME: home, USERPROFILE: home, TOKEN_GARDEN_OFFLINE: "1",
      USAGE_CACHE: path.join(home, "cache.json"), USAGE_PREFS: path.join(home, "prefs.json"),
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => { if (String(d).includes("live at")) resolve(); });
    child.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
});
test.after(() => {
  child?.kill();
  fs.rmSync(home, { recursive: true, force: true });
});

test("serves the dashboard with security headers", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-security-policy"), /connect-src 'self'/);
  assert.equal(res.headers.get("x-frame-options"), "DENY");
});

test("rejects non-local Host headers (DNS rebinding)", async () => {
  const http = await import("node:http");
  const status = await new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: PORT, path: "/api/usage", headers: { Host: `evil.example:${PORT}` } },
      (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject);
  });
  assert.equal(status, 403);
});

test("rejects cross-origin requests", async () => {
  const res = await fetch(`${base}/api/usage`, { headers: { Origin: "https://evil.example" } });
  assert.equal(res.status, 403);
});

test("prefs require JSON and keep only allowlisted keys", async () => {
  const form = await fetch(`${base}/api/prefs`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
  assert.equal(form.status, 415);
  const ok = await fetch(`${base}/api/prefs`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ lang: "en", injected: "nope" }),
  });
  assert.equal(ok.status, 200);
  const prefs = await (await fetch(`${base}/api/prefs`)).json();
  assert.equal(prefs.lang, "en");
  assert.equal(prefs.injected, undefined);
  const big = await fetch(`${base}/api/prefs`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang: "x".repeat(20000) }),
  }).catch(() => ({ status: 413 }));
  assert.equal(big.status, 413);
});

test("usage endpoint supports ETag revalidation and gzip", async () => {
  const res = await fetch(`${base}/api/usage`);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.ok(Array.isArray(payload.rows) && Array.isArray(payload.fields));
  const again = await fetch(`${base}/api/usage`, { headers: { "If-None-Match": res.headers.get("etag") } });
  assert.equal(again.status, 304);
});

test("crew and locale paths cannot traverse", async () => {
  for (const p of ["/crews/..%2Fserve.mjs", "/crews/private/../../serve.mjs", "/i18n/..%2Fcollect.mjs"]) {
    const res = await fetch(`${base}${p}`);
    assert.notEqual(res.status, 200, p);
  }
});
