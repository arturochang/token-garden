// Collect token usage from Claude Code, Codex and OpenCode into data.js.
// Usage: node collect.mjs [--json [--group-by=tool|project|workspace|model|tool+model|workspace+model]] [--snapshot[=file]] [--refresh-prices]
// Importable: createCollector() returns { collect() } with an incremental per-file
// cache, so repeated collect() calls only re-parse changed JSONL files.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { costFor, refreshPrices } from "./prices.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(here, "data.js");
const home = os.homedir();

// Normalized record field order (rows are arrays in this order).
// NOTE: workspace/active/estimated appended at end so old snapshots degrade
// gracefully (index.html defaults missing values).
const FIELDS = [
  "tool", "session", "title", "project", "model", "ts",
  "input", "cacheRead", "cacheWrite", "output", "reasoning", "cost", "sidechain",
  "workspace", "active", "estimated",
];

const DRIVE_ROOT_RE = /^[a-zA-Z]:$/;
function projectOf(cwd) {
  if (!cwd) return "unknown";
  const parts = String(cwd).split(/[\\/]/).filter(Boolean);
  const last = parts[parts.length - 1] || "unknown";
  if (DRIVE_ROOT_RE.test(last)) return "unknown"; // bare drive root, no signal
  return last.toLowerCase();
}

// Roll git worktrees into the parent repo. Caveats (same as tokscale):
// string-identity only — a renamed checkout or nested repo resolves to its
// own root; submodules resolve to the submodule root, not the superproject.
const workspaceCache = new Map();
function resolveWorkspace(cwd) {
  const project = projectOf(cwd);
  if (!cwd) return { project, workspace: "unknown" };
  if (workspaceCache.has(String(cwd))) return workspaceCache.get(String(cwd));
  let out = { project, workspace: project };
  try {
    let dir = path.resolve(String(cwd));
    for (let i = 0; i < 12; i++) {
      const gitPath = path.join(dir, ".git");
      let st = null;
      try { st = fs.statSync(gitPath); } catch { st = null; }
      if (st) {
        if (st.isDirectory()) {
          out = { project, workspace: projectOf(dir) };
        } else if (st.isFile()) {
          const text = fs.readFileSync(gitPath, "utf8").trim();
          const m = text.match(/^gitdir:\s*(.+)$/);
          const gitdir = m ? path.resolve(dir, m[1].trim()) : "";
          const norm = gitdir.replace(/\\/g, "/");
          const idx = norm.toLowerCase().lastIndexOf("/.git/worktrees/");
          if (idx > 0) {
            out = { project, workspace: projectOf(norm.slice(0, idx)) };
          } else {
            out = { project, workspace: projectOf(dir) };
          }
        }
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* keep default */ }
  workspaceCache.set(String(cwd), out);
  return out;
}

function estimateTokens(text) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (!compact) return 0;
  const cjk = (compact.match(/[\u3400-\u9fff]/g) || []).length;
  return Math.max(1, Math.ceil(cjk * 0.8 + Math.max(compact.length - cjk, 0) / 4));
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((e) => {
      if (typeof e === "string") return e;
      return e?.text || e?.input_text || "";
    })
    .filter(Boolean)
    .join(" ");
}

function stripLeadTags(s) {
  return String(s || "").replace(/^(<[^>\n]{1,40}>\s*)+/, "").trim();
}

function isLowValueTitle(v) {
  const t = stripLeadTags(v);
  const lower = t.toLowerCase();
  if (!t || t.length < 8 || lower.startsWith("<environment_context>") ||
    lower.includes("# agents.md instructions") || lower.includes("<cwd>")) return true;
  // IDE/UI chrome, not the user's words: fall through to the next candidate.
  return /^(the user (selected|opened|clicked|closed|ran|typed|pasted)|caveat:|<(command|terminal|shell|selection))[^a-z0-9]*/i.test(t) ||
    /^\/[a-z][\w-]*/i.test(t); // slash-commands (/clear, /init, …)
}

function cleanTitle(v, max = 120) {
  const t = stripLeadTags(String(v || "").replace(/\s+/g, " "));
  if (!t || isLowValueTitle(t)) return "";
  return t.slice(0, max);
}

// ---- Codex accounting (ports usage-accounting.js v19 semantics) ----
const codexNum = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const codexScalar = (v) =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";
const CODEX_KEYS = ["input", "cached", "cacheWrite", "output", "total", "reasoning"];

function codexTokens(raw) {
  const input = codexNum(raw.input_tokens ?? raw.prompt_tokens ?? raw.input);
  const output = codexNum(raw.output_tokens ?? raw.completion_tokens ?? raw.output);
  return {
    input,
    cached: codexNum(raw.cached_input_tokens ?? raw.cached_tokens ?? raw.cache_read_input_tokens),
    cacheWrite: codexNum(raw.cache_write_input_tokens ?? raw.cache_creation_input_tokens),
    output,
    total: codexNum(raw.total_tokens ?? raw.tokens ?? input + output),
    reasoning: codexNum(raw.reasoning_output_tokens ?? raw.reasoning_tokens),
  };
}
const codexEqual = (a, b) => CODEX_KEYS.every((k) => a[k] === b[k]);
const codexNonzero = (t) => CODEX_KEYS.some((k) => t[k] > 0);
const codexDiff = (a, b) =>
  Object.fromEntries(CODEX_KEYS.map((k) => [k, Math.max(0, a[k] - b[k])]));
const codexSum = (items) =>
  Object.fromEntries(CODEX_KEYS.map((k) => [k, items.reduce((t, it) => t + it.tokens[k], 0)]));

function codexMaybeUsage(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  if (o.type === "token_count_record" || o.type === "token_usage_record") return true;
  if (o.type === "event_msg" && o.payload && typeof o.payload === "object") {
    return o.payload.type === "token_count";
  }
  return (
    "total_token_usage" in o ||
    "last_token_usage" in o ||
    "token_usage" in o ||
    (typeof o.usage === "object" && o.usage !== null)
  );
}
function codexExtract(item) {
  if (!codexMaybeUsage(item)) return null;
  const payload = item.payload && typeof item.payload === "object" ? item.payload : item;
  const info = payload.info && typeof payload.info === "object" ? payload.info : payload;
  const isRequest = item.type === "token_count_record" || item.type === "token_usage_record";
  const raw = isRequest
    ? payload.usage
    : info.total_token_usage || info.usage || info.token_usage || info;
  if (!raw || typeof raw !== "object") return null;
  const last = !isRequest && (info.last_token_usage || payload.last_token_usage);
  const cumulative = !isRequest && info.total_token_usage ? codexTokens(info.total_token_usage) : null;
  const value = codexTokens(raw);
  const lastTokens = last && typeof last === "object" ? codexTokens(last) : null;
  if (!codexNonzero(value) && !codexNonzero(lastTokens || value)) return null;
  return {
    kind: isRequest ? "request" : cumulative || lastTokens ? "count" : "generic",
    tokens: value,
    cumulative,
    lastTokens,
    requestId: codexScalar(payload.response_id || payload.request_id || payload.requestId),
    sessionId: codexScalar(payload.session_id || payload.thread_id),
    turnId: codexScalar(payload.turn_id || payload.turnId),
  };
}

function createCodexTracker() {
  const sessions = new Map();
  function select(usage, context = {}) {
    if (!usage) return null;
    if (usage.kind === "generic") return usage.tokens;
    const sessionId = usage.sessionId || codexScalar(context.sessionId);
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, { previous: null, pending: [], ids: new Set() });
    }
    const session = sessions.get(sessionId);
    const turnId = usage.turnId || codexScalar(context.turnId);
    const requestId = usage.requestId;
    const duplicateId = requestId && session.ids.has(requestId);
    if (requestId) session.ids.add(requestId);
    if (usage.kind === "request") {
      if (duplicateId) return null;
      session.pending.push({ tokens: usage.tokens, turnId, requestId });
      return usage.tokens;
    }
    const previous = session.previous;
    const cumulative = usage.cumulative;
    if (cumulative && previous && codexEqual(cumulative, previous)) return null;
    const reset = cumulative && previous && cumulative.total < previous.total;
    const delta = cumulative && previous && !reset ? codexDiff(cumulative, previous) : cumulative;
    if (cumulative) session.previous = cumulative;
    const selected =
      usage.lastTokens && codexNonzero(usage.lastTokens)
        ? usage.lastTokens
        : delta || usage.tokens;
    const pending = session.pending;
    session.pending = [];
    if (duplicateId) return null;
    const compatible = pending.filter(
      (e) =>
        (!turnId || !e.turnId || e.turnId === turnId) &&
        (!requestId || !e.requestId || e.requestId === requestId)
    );
    if (compatible.some((e) => codexEqual(e.tokens, selected))) return null;
    if (!usage.lastTokens && compatible.length) {
      const covered = codexSum(compatible);
      if (CODEX_KEYS.every((k) => covered[k] <= selected[k])) {
        const remaining = codexDiff(selected, covered);
        return codexNonzero(remaining) ? remaining : null;
      }
    }
    return codexNonzero(selected) ? selected : null;
  }
  return { select };
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

function activeOf(tool, { input = 0, output = 0, reasoning = 0 }) {
  return input + output + (tool === "opencode" ? reasoning : 0);
}

// Parse one Claude JSONL file. Dedupe across files happens later, so each
// record carries its internal _key (left out of FIELDS).
function parseClaudeFile(file) {
  const records = [];
  let title = "";
  for (const line of readLines(file)) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!title) {
      const msg = o.message || o;
      if (o.type === "human" || msg?.role === "user") {
        title = cleanTitle(textFromContent(msg.content ?? o.content)) || title;
      }
    }
    if (o.type !== "assistant" || !o.message || !o.message.usage) continue;
    if (o.message.model === "<synthetic>") continue;
    const key = String(o.message.id) + ":" + String(o.requestId);
    const u = o.message.usage;
    const model = o.message.model || "unknown";
    const input = u.input_tokens || 0;
    const cacheWrite = u.cache_creation_input_tokens || 0;
    const cacheRead = u.cache_read_input_tokens || 0;
    const output = u.output_tokens || 0;
    const cwd = o.cwd || null;
    const { project, workspace } = resolveWorkspace(cwd);
    records.push({
      tool: "claude",
      session: o.sessionId || path.basename(file, ".jsonl"),
      title: title || null,
      project,
      workspace,
      model,
      ts: o.timestamp ? Date.parse(o.timestamp) : 0,
      input, cacheRead, cacheWrite, output,
      reasoning: 0,
      cost: costFor(model, { input, cacheRead, cacheWrite, output }),
      sidechain: o.isSidechain === true,
      active: activeOf("claude", { input, output }),
      estimated: 0,
      _key: key,
    });
  }
  if (title) for (const r of records) r.title ||= title;
  return records;
}

// Parse one Codex rollout file: token_usage_record payloads are per-request
// increments; event_msg/token_count uses last_token_usage preferred with
// cumulative-total diff fallback and requestId/turn reconciliation.
function parseCodexFile(file) {
  const records = [];
  const tracker = createCodexTracker();
  const meta = { sessionId: "", cwd: "", model: "", title: "", turnId: "" };
  const seen = new Set();
  let fullText = "";
  let hasLines = false;

  function pushSelected(selected, ts, lineNumber) {
    const input = Math.max(0, selected.input - selected.cached);
    const m = meta.model || "unknown";
    const { project, workspace } = resolveWorkspace(meta.cwd);
    const id = crypto
      .createHash("sha1")
      .update([file, lineNumber, meta.sessionId, ts, selected.input, selected.cached, selected.output, selected.total].join("|"))
      .digest("hex");
    if (seen.has(id)) return;
    seen.add(id);
    records.push({
      tool: "codex",
      session: meta.sessionId || path.basename(file, ".jsonl"),
      title: meta.title || null,
      project,
      workspace,
      model: m,
      ts,
      input,
      cacheRead: selected.cached,
      cacheWrite: selected.cacheWrite,
      output: selected.output,
      reasoning: selected.reasoning,
      cost: costFor(m, { input, cacheRead: selected.cached, cacheWrite: selected.cacheWrite, output: selected.output }),
      sidechain: false,
      active: activeOf("codex", { input, output: selected.output }),
      estimated: 0,
    });
  }

  // Targeted descent: usage always lives at the top level, payload, or
  // payload.info. Full-tree walks turned a ~8s collect into ~100s, so plain
  // sub-objects (message content trees etc.) are never entered; arrays are
  // descended one level for wrapped formats.
  function visit(item, lineNumber, depth = 0) {
    if (!item || typeof item !== "object" || depth > 2) return;
    const payload = item.payload && typeof item.payload === "object" ? item.payload : item;
    if (item.type === "session_meta" || item.type === "turn_context" || payload.model_provider || payload.thread_source || payload.model) {
      meta.sessionId = String(payload.id || payload.session_id || meta.sessionId || "");
      meta.cwd = String(payload.cwd || meta.cwd || "");
      meta.model = String(payload.model || payload.model_name || meta.model || "");
      meta.turnId = String(payload.turn_id || payload.turnId || meta.turnId || "");
    }
    if (!meta.title) {
      const userText =
        (item.type === "response_item" && payload?.role === "user" ? textFromContent(payload.content) : "") ||
        (payload?.role === "user" || item.role === "user"
          ? textFromContent(payload.content ?? item.content)
          : "");
      if (userText) meta.title = cleanTitle(userText) || "";
    }
    const usage = codexExtract(item);
    if (usage) {
      const ts = item.timestamp || payload.timestamp ? Date.parse(item.timestamp || payload.timestamp) : 0;
      const selected = tracker.select(usage, {
        sessionId: usage.sessionId || meta.sessionId || path.basename(file),
        turnId: usage.turnId || meta.turnId,
      });
      if (selected) pushSelected(selected, ts, lineNumber);
      return;
    }
    if (depth === 0 && payload !== item) visit(payload, lineNumber, 1);
    if (depth <= 1 && payload.info && typeof payload.info === "object" && payload.info !== payload) {
      visit(payload.info, lineNumber, depth + 1);
    }
    if (depth === 0) {
      for (const value of Object.values(item)) {
        if (Array.isArray(value)) {
          for (const c of value) visit(c, lineNumber, 1);
        }
      }
    }
  }

  const text = fs.readFileSync(file, "utf8");
  fullText = text;
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    hasLines = true;
    let o;
    try { o = JSON.parse(line); } catch { return; }
    visit(o, i + 1);
  });
  for (const r of records) r.title ||= meta.title || null;

  // Estimated fallback: no usage fields anywhere — count text length once,
  // explicitly labeled, instead of silently dropping the file.
  if (!records.length && hasLines) {
    const est = estimateTokens(fullText);
    if (est > 0) {
      const { project, workspace } = resolveWorkspace(meta.cwd);
      let mtime = 0;
      try { mtime = Date.parse(fs.statSync(file).mtime.toISOString()); } catch { mtime = 0; }
      records.push({
        tool: "codex",
        session: meta.sessionId || path.basename(file, ".jsonl"),
        title: meta.title || null,
        project,
        workspace,
        model: meta.model || "unknown",
        ts: mtime,
        input: est,
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        reasoning: 0,
        cost: null,
        sidechain: false,
        active: est,
        estimated: 1,
      });
    }
  }
  return records;
}

// Refresh the per-file cache: re-parse only files that are new or whose mtime
// or size changed. Drops files that no longer exist. Returns all cached
// records in walk order. onMiss fires per re-parsed file (used to mark the
// disk cache dirty).
function refreshCache(cache, files, parse, onMiss) {
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
      if (onMiss) onMiss();
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

export function createCollector(opts = {}) {
  const claudeCache = new Map(); // path -> { mtimeMs, size, records }
  const codexCache = new Map();
  let db = null; // single readOnly DatabaseSync for the life of the process
  let dbFailed = false;
  let prevOpencode = [];

  // Disk cache: warm starts stat files (fast) and re-parse only changed ones.
  // Bump CACHE_VERSION whenever record shape or parsers change.
  const CACHE_VERSION = 3;
  const cacheFile = opts.cacheFile ?? process.env.USAGE_CACHE ?? path.join(here, ".usage-cache.json");
  let cacheDirty = false;
  let lastSave = 0;
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (raw && raw.version === CACHE_VERSION && raw.files) {
      for (const [k, v] of Object.entries(raw.files.claude || {})) claudeCache.set(k, v);
      for (const [k, v] of Object.entries(raw.files.codex || {})) codexCache.set(k, v);
    }
  } catch { /* cold start */ }
  const markDirty = () => { cacheDirty = true; };
  function flushCache(force = false) {
    if (!cacheDirty) return false;
    const now = Date.now();
    if (!force && now - lastSave < 60_000) return false; // at most 1 write/min
    try {
      fs.writeFileSync(
        cacheFile,
        JSON.stringify({
          version: CACHE_VERSION,
          savedAt: new Date().toISOString(),
          files: {
            claude: Object.fromEntries(claudeCache),
            codex: Object.fromEntries(codexCache),
          },
        }),
        "utf8"
      );
    } catch {
      return false;
    }
    cacheDirty = false;
    lastSave = now;
    return true;
  }

  function collectClaude() {
    const root = path.join(home, ".claude", "projects");
    const files = walkJsonl(root, (name) => name.endsWith(".jsonl"));
    const cached = refreshCache(claudeCache, files, parseClaudeFile, markDirty);
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
    return refreshCache(codexCache, files, parseCodexFile, markDirty);
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
      const input = t.input || 0;
      const output = t.output || 0;
      const reasoning = t.reasoning || 0;
      const { project, workspace } = resolveWorkspace(r.directory);
      records.push({
        tool: "opencode",
        session: r.session_id,
        title: r.title || null,
        project,
        workspace,
        model: data.modelID || (data.model && data.model.id) || "unknown",
        ts: Number(r.time_created) || 0,
        input,
        cacheRead: cache.read || 0,
        cacheWrite: cache.write || 0,
        output,
        reasoning,
        cost: typeof data.cost === "number" ? data.cost : null,
        sidechain: r.parent_id != null,
        active: activeOf("opencode", { input, output, reasoning }),
        estimated: 0,
      });
    }
    prevOpencode = records;
    return records;
  }

  function collect() {
    const byTool = {};
    const prof = process.env.COLLECT_PROFILE ? {} : null;
    const only = process.env.COLLECT_ONLY || "";
    for (const [name, fn] of [["claude", collectClaude], ["codex", collectCodex], ["opencode", collectOpencode]]) {
      try {
        if (only && only !== name) { byTool[name] = []; continue; }
        const t0 = prof ? Date.now() : 0;
        byTool[name] = fn();
        if (prof) prof[name] = Date.now() - t0;
      } catch (err) {
        console.warn(`warning: ${name} source failed (${err.message}), contributing 0 records`);
        byTool[name] = [];
      }
    }
    if (prof) console.error(`profile: ${JSON.stringify(prof)}`);
    const all = [...byTool.claude, ...byTool.codex, ...byTool.opencode];
    all.sort((a, b) => a.ts - b.ts);
    const rows = all.map((r) => FIELDS.map((f) => r[f] ?? null));
    flushCache(); // best-effort, throttled; serve also flushes on exit
    return { generatedAt: Date.now(), fields: FIELDS, rows };
  }

  return { collect, flush: () => flushCache(true) };
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

function expandPayload(payload) {
  return payload.rows.map((r) => {
    const o = {};
    payload.fields.forEach((f, i) => (o[f] = r[i]));
    o.workspace ??= o.project ?? "unknown";
    o.active ??= (o.input || 0) + (o.output || 0) + (o.tool === "opencode" ? o.reasoning || 0 : 0);
    o.estimated ??= 0;
    return o;
  });
}

const GROUP_KEYS = ["tool", "project", "workspace", "model", "tool+model", "workspace+model"];
function groupKeyOf(r, groupBy) {
  switch (groupBy) {
    case "tool": return r.tool;
    case "project": return r.project;
    case "workspace": return r.workspace;
    case "model": return r.model;
    case "tool+model": return `${r.tool}:${r.model}`;
    case "workspace+model": return `${r.workspace}:${r.model}`;
    default: return r.model;
  }
}

export function aggregateGroups(payload, groupBy = "model") {
  if (!GROUP_KEYS.includes(groupBy)) groupBy = "model";
  const recs = expandPayload(payload);
  const groups = new Map();
  for (const r of recs) {
    const key = groupKeyOf(r, groupBy);
    if (!groups.has(key)) {
      groups.set(key, {
        key, groupBy, records: 0, sessions: new Set(),
        total: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0,
        reasoning: 0, active: 0, estimated: 0, cost: 0, costRecords: 0,
      });
    }
    const g = groups.get(key);
    g.records++;
    g.sessions.add(r.tool + ":" + r.session);
    g.total += totalOf(r);
    g.input += r.input || 0; g.cacheRead += r.cacheRead || 0;
    g.cacheWrite += r.cacheWrite || 0; g.output += r.output || 0;
    g.reasoning += r.reasoning || 0; g.active += r.active || 0;
    g.estimated += r.estimated ? 1 : 0;
    if (r.cost != null) { g.cost += r.cost; g.costRecords++; }
  }
  return [...groups.values()]
    .map((g) => ({ ...g, sessions: g.sessions.size, cost: g.costRecords ? g.cost : null }))
    .sort((a, b) => b.total - a.total);
}

export function anonymizePayload(payload) {
  const recs = expandPayload(payload);
  const rows = recs.map((r) => {
    const session = crypto.createHash("sha256").update(r.tool + ":" + r.session).digest("hex").slice(0, 16);
    const o = {
      ...r,
      session,
      title: null, // prompts stay local
    };
    delete o._key;
    return FIELDS.map((f) => o[f] ?? null);
  });
  return { generatedAt: payload.generatedAt, fields: FIELDS, rows, anonymized: true };
}

const invokedAsMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMain) {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const p = `--${name}=`;
    const hit = args.find((a) => a.startsWith(p));
    if (hit) return hit.slice(p.length);
    const i = args.indexOf(`--${name}`);
    if (i !== -1 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1];
    return null;
  };
  const has = (name) => args.includes(`--${name}`);
  if (has("help") || has("h")) {
    console.log("Usage: node collect.mjs [--json [--group-by=...] [--out=file]] [--snapshot[=file]] [--refresh-prices]");
    console.log(`  group-by: ${GROUP_KEYS.join("|")}`);
    console.log("  NOTE (Windows): PowerShell `>` writes UTF-16; prefer --out=file for clean UTF-8 JSON.");
    process.exit(0);
  }
  const main = async () => {
    if (has("refresh-prices")) {
      const ok = await refreshPrices();
      console.error(`prices: refresh ${ok ? "ok" : "kept fallback"}`);
    }
    const collector = createCollector();
    const payload = collector.collect();
    const snap = getArg("snapshot") ?? (has("snapshot") ? "snapshot.json" : null);
    if (snap) {
      const file = snap.endsWith(".json") ? snap : `${snap}.json`;
      fs.writeFileSync(path.resolve(file), JSON.stringify(anonymizePayload(payload)), "utf8");
      console.error(`wrote ${file} (${payload.rows.length} records, anonymized)`);
    }
    if (has("json")) {
      const groupBy = getArg("group-by") || getArg("group") || "model";
      const out = { generatedAt: payload.generatedAt, fields: payload.fields, groupBy, groups: aggregateGroups(payload, groupBy) };
      const text = JSON.stringify(out);
      const dest = getArg("out");
      if (dest) fs.writeFileSync(path.resolve(dest), text, "utf8");
      else process.stdout.write(text + "\n");
    } else {
      for (const name of ["claude", "codex", "opencode"]) {
        console.log(summarize(payload, name));
      }
      fs.writeFileSync(outFile, `window.USAGE = ${JSON.stringify(payload)};`, "utf8");
      console.log(`wrote ${outFile} (${payload.rows.length} records)`);
    }
  };
  main();
}
