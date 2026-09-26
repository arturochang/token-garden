// Collector tests against synthetic fixtures in a throwaway home directory.
// Never add real logs, prompts, paths, or session IDs here.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { aggregateGroups, anonymizePayload, createCollector } from "../collect.mjs";

process.env.TOKEN_GARDEN_OFFLINE = "1";

function fixtureHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "token-garden-test-"));
  const claudeDir = path.join(home, ".claude", "projects", "demo");
  fs.mkdirSync(claudeDir, { recursive: true });
  const assistant = (id, req, usage) => JSON.stringify({
    type: "assistant", sessionId: "s1", cwd: "/work/demo", timestamp: "2026-01-01T00:00:00Z", requestId: req,
    message: { id, model: "claude-sonnet-4", usage },
  });
  fs.writeFileSync(path.join(claudeDir, "s1.jsonl"), [
    JSON.stringify({ type: "user", message: { role: "user", content: "Synthetic prompt for testing" } }),
    assistant("m1", "r1", { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000 }),
    assistant("m1", "r1", { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000 }), // duplicate write
    "{not json",
    assistant("m2", "r2", { input_tokens: 10, output_tokens: 5 }),
  ].join("\n"));

  const codexDir = path.join(home, ".codex", "sessions", "2026", "01", "01");
  fs.mkdirSync(codexDir, { recursive: true });
  const count = (total, last) => JSON.stringify({
    type: "event_msg", timestamp: "2026-01-01T00:01:00Z",
    payload: { type: "token_count", info: { total_token_usage: total, last_token_usage: last } },
  });
  fs.writeFileSync(path.join(codexDir, "rollout-a.jsonl"), [
    JSON.stringify({ type: "session_meta", payload: { id: "c1", cwd: "/work/demo", model: "gpt-5" } }),
    count({ input_tokens: 200, cached_input_tokens: 50, output_tokens: 20, total_tokens: 220 },
      { input_tokens: 200, cached_input_tokens: 50, output_tokens: 20, total_tokens: 220 }),
    count({ input_tokens: 200, cached_input_tokens: 50, output_tokens: 20, total_tokens: 220 }, null), // repeat
  ].join("\n"));
  return home;
}

test("collects, dedupes, and normalizes synthetic Claude and Codex logs", () => {
  const home = fixtureHome();
  try {
    const collector = createCollector({ home, cacheFile: path.join(home, "cache.json"), sources: ["claude", "codex"] });
    const payload = collector.collect();
    const idx = Object.fromEntries(payload.fields.map((f, i) => [f, i]));
    const claude = payload.rows.filter((r) => r[idx.tool] === "claude");
    const codex = payload.rows.filter((r) => r[idx.tool] === "codex");
    assert.equal(claude.length, 2, "duplicate message.id:requestId counted once");
    assert.equal(claude[0][idx.title], "Synthetic prompt for testing");
    assert.equal(claude[0][idx.project], "demo");
    assert.equal(codex.length, 1, "repeated cumulative total ignored");
    assert.equal(codex[0][idx.input], 150, "cached input subtracted");
    assert.equal(codex[0][idx.cacheRead], 50);
    assert.ok(payload.rows.every((r) => r[idx.cost] === null || r[idx.cost] >= 0));

    const groups = aggregateGroups(payload, "tool");
    assert.deepEqual(groups.map((g) => g.key).sort(), ["claude", "codex"]);

    const anon = anonymizePayload(payload);
    assert.equal(anon.anonymized, true);
    const aIdx = Object.fromEntries(anon.fields.map((f, i) => [f, i]));
    assert.ok(anon.rows.every((r) => r[aIdx.title] === null && /^[0-9a-f]{16}$/.test(r[aIdx.session])));

    // Warm cache round-trip yields identical rows.
    collector.flush();
    const again = createCollector({ home, cacheFile: path.join(home, "cache.json"), sources: ["claude", "codex"] }).collect();
    assert.deepEqual(again.rows, payload.rows);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("missing sources yield an empty payload", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "token-garden-empty-"));
  try {
    const payload = createCollector({ home, cacheFile: path.join(home, "cache.json") }).collect();
    assert.deepEqual(payload.rows, []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
