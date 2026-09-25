// Collect token usage from Claude Code, Codex and OpenCode into tools/usage/data.js.
// Usage: node tools/usage/collect.mjs
// Importable: createCollector() returns { collect() } with an incremental per-file
// cache, so repeated collect() calls only re-parse changed JSONL files.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { costFor } from "./prices.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(here, "data.js");
const home = os.homedir();

// Normalized record field order (rows are arrays in this order).
const FIELDS = [
  "tool", "session", "title", "project", "model", "ts",
  "input", "cacheRead", "cacheWrite", "output", "reasoning", "cost", "sidechain",
];

function projectOf(cwd) {
  if (!cwd) return "unknown";
  const parts = String(cwd).split(/[\\/]/).filter(Boolean);
  return (parts[parts.length - 1] || "unknown").toLowerCase();
}

function walkJsonl(dir, match) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkJsonl(p, match));
    else if (e.isFile() && match(e.name, p)) out.push(p);
  }
  return out;
}

function readLines(file) {
  return fs.readFileSync(file, "utf8").split("\n");
}

// Parse one Claude JSONL file. Dedupe across files happens later, so each
// record carries its internal _key (left out of FIELDS).
function parseClaudeFile(file) {
  const records = [];
  for (const line of readLines(file)) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== "assistant" || !o.message || !o.message.usage) continue;
    if (o.message.model === "<synthetic>") continue;
    const key = String(o.message.id) + ":" + String(o.requestId);
    const u = o.message.usage;
    const model = o.message.model || "unknown";
    const input = u.input_tokens || 0;
    const cacheWrite = u.cache_creation_input_tokens || 0;
    const cacheRead = u.cache_read_input_tokens || 0;
    const output = u.output_tokens || 0;
    records.push({
      tool: "claude",
      session: o.sessionId || path.basename(file, ".jsonl"),
      title: null,
      project: projectOf(o.cwd),
      model,
      ts: o.timestamp ? Date.parse(o.timestamp) : 0,
      input, cacheRead, cacheWrite, output,
      reasoning: 0,
      cost: costFor(model, { input, cacheRead, cacheWrite, output }),
      sidechain: o.isSidechain === true,
      _key: key,
    });
  }
  return records;
}

// Parse one Codex rollout file as a whole (same logic as the original loop).
function parseCodexFile(file) {
  const records = [];
  let sessionId = null;
  let cwd = null;
  let model = null;
  let prevTotal = null;
  let first = true;
  for (const line of readLines(file)) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (first && o.type === "session_meta") {
      sessionId = (o.payload && (o.payload.id || o.payload.session_id)) || null;
      cwd = (o.payload && o.payload.cwd) || null;
    }
    first = false;
    if (o.type === "turn_context" && model === null && o.payload) {
      model = o.payload.model || "unknown";
    }
    if (o.type !== "event_msg" || !o.payload || o.payload.type !== "token_count") continue;
    const info = o.payload.info;
    if (info == null) continue;
    const total = info.total_token_usage && info.total_token_usage.total_tokens;
    if (total === prevTotal) continue; // duplicate emit
    prevTotal = total;
    const last = info.last_token_usage || {};
    const rawInput = last.input_tokens || 0;
    const cached = last.cached_input_tokens || 0;
    const cacheWrite = last.cache_write_input_tokens || 0;
    const output = last.output_tokens || 0;
    const reasoning = last.reasoning_output_tokens || 0;
    const m = model || "unknown";
    const input = Math.max(0, rawInput - cached);
    records.push({
      tool: "codex",
      session: sessionId || path.basename(file, ".jsonl"),
      title: null,
      project: projectOf(cwd),
      model: m,
      ts: o.timestamp ? Date.parse(o.timestamp) : 0,
      input,
      cacheRead: cached,
      cacheWrite,
      output,
      reasoning,
      cost: costFor(m, { input, cacheRead: cached, cacheWrite, output }),
      sidechain: false,
    });
  }
  return records;
}

// Refresh the per-file cache: re-parse only files that are new or whose mtime
// or size changed. Drops files that no longer exist. Returns all cached
// records in walk order.
function refreshCache(cache, files, parse) {
  const seen = new Set(files);
  for (const gone of [...cache.keys()]) {
    if (!seen.has(gone)) cache.delete(gone);
  }
  const all = [];
  for (const file of files) {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      cache.delete(file);
      continue;
    }
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
      all.push(...hit.records);
    } else {
      const records = parse(file);
      cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, records });
      all.push(...records);
    }
  }
  return all;
}

function totalOf(r) {
  // Reasoning counts toward totals only when the tool counts it separately
  // (OpenCode). Codex reasoning is a subset of output; Claude has none.
  return r.input + r.cacheRead + r.cacheWrite + r.output + (r.tool === "opencode" ? r.reasoning : 0);
}

export function createCollector() {
  const claudeCache = new Map(); // path -> { mtimeMs, size, records }
  const codexCache = new Map();
  let db = null; // single readOnly DatabaseSync for the life of the process
  let dbFailed = false;
  let prevOpencode = [];

  function collectClaude() {
    const root = path.join(home, ".claude", "projects");
    const files = walkJsonl(root, (name) => name.endsWith(".jsonl"));
    const cached = refreshCache(claudeCache, files, parseClaudeFile);
    // Dedupe across files on message.id:requestId, first wins.
    const seen = new Set();
    const records = [];
    for (const r of cached) {
      if (seen.has(r._key)) continue;
      seen.add(r._key);
      records.push(r);
    }
    return records;
  }

  function collectCodex() {
    const root = path.join(home, ".codex", "sessions");
    const files = walkJsonl(root, (name) => name.startsWith("rollout-") && name.endsWith(".jsonl"));
    return refreshCache(codexCache, files, parseCodexFile);
  }

  function collectOpencode() {
    const dbPath = path.join(home, ".local", "share", "opencode", "opencode.db");
    if (!db && !dbFailed) {
      try {
        db = new DatabaseSync(dbPath, { readOnly: true });
      } catch (err) {
        dbFailed = true;
        throw err;
      }
    }
    // v1 tables (message/session) and v2 tables (session_message/session_v2, written by opencode2).
    let rows;
    try {
      rows = db
        .prepare(
          "SELECT m.id, m.session_id, m.time_created, m.data, s.title, s.directory, s.parent_id FROM message m JOIN session s ON s.id = m.session_id"
        )
        .all();
      try {
        rows.push(...db
          .prepare(
            "SELECT m.id, m.session_id, m.time_created, m.data, s.title, s.directory, s.parent_id FROM session_message m JOIN session_v2 s ON s.id = m.session_id WHERE m.type = 'assistant'"
          )
          .all());
      } catch {
        // older OpenCode: no v2 tables
      }
    } catch (err) {
      if (err && (String(err.code || "").includes("SQLITE_BUSY") || String(err.message || "").includes("SQLITE_BUSY"))) {
        return prevOpencode; // DB locked: keep previous records, retry next cycle
      }
      throw err;
    }
    const records = [];
    const seen = new Set();
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      let data;
      try { data = JSON.parse(r.data); } catch { continue; }
      if (!data || !data.tokens) continue;
      if (data.role !== undefined && data.role !== "assistant") continue;
      const t = data.tokens;
      const cache = t.cache || {};
      records.push({
        tool: "opencode",
        session: r.session_id,
        title: r.title || null,
        project: projectOf(r.directory),
        model: data.modelID || (data.model && data.model.id) || "unknown",
        ts: Number(r.time_created) || 0,
        input: t.input || 0,
        cacheRead: cache.read || 0,
        cacheWrite: cache.write || 0,
        output: t.output || 0,
        reasoning: t.reasoning || 0,
        cost: typeof data.cost === "number" ? data.cost : null,
        sidechain: r.parent_id != null,
      });
    }
    prevOpencode = records;
    return records;
  }

  function collect() {
    const byTool = {};
    for (const [name, fn] of [["claude", collectClaude], ["codex", collectCodex], ["opencode", collectOpencode]]) {
      try {
        byTool[name] = fn();
      } catch (err) {
        console.warn(`warning: ${name} source failed (${err.message}), contributing 0 records`);
        byTool[name] = [];
      }
    }
    const all = [...byTool.claude, ...byTool.codex, ...byTool.opencode];
    all.sort((a, b) => a.ts - b.ts);
    const rows = all.map((r) => FIELDS.map((f) => r[f] ?? null));
    return { generatedAt: Date.now(), fields: FIELDS, rows };
  }

  return { collect };
}

function summarize(payload, name) {
  const ti = payload.fields.indexOf("tool");
  const si = payload.fields.indexOf("session");
  const ii = payload.fields.indexOf("input");
  const cri = payload.fields.indexOf("cacheRead");
  const cwi = payload.fields.indexOf("cacheWrite");
  const oi = payload.fields.indexOf("output");
  const ri = payload.fields.indexOf("reasoning");
  const rows = payload.rows.filter((r) => r[ti] === name);
  const sessions = new Set(rows.map((r) => name + ":" + r[si])).size;
  const total = rows.reduce(
    (a, r) => a + r[ii] + r[cri] + r[cwi] + r[oi] + (name === "opencode" ? r[ri] : 0),
    0
  );
  return `${name}: records=${rows.length} sessions=${sessions} totalTokens=${total}`;
}

const invokedAsMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMain) {
  const collector = createCollector();
  const payload = collector.collect();
  for (const name of ["claude", "codex", "opencode"]) {
    console.log(summarize(payload, name));
  }
  fs.writeFileSync(outFile, `window.USAGE = ${JSON.stringify(payload)};`, "utf8");
  console.log(`wrote ${outFile} (${payload.rows.length} records)`);
}
