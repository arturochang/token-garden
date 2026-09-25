// Price estimates (USD per 1M tokens). Hardcoded table is the fallback;
// a LiteLLM snapshot is layered on top when fresh (1h TTL). Not exact.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(here, "prices-cache.json");
const TTL_MS = 3600_000;
const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

export const PRICES = {
  "claude-opus-5": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-opus-4": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-sonnet": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-fable": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
};

// Merged live table: LiteLLM cache wins on exact/prefix match, fallback below.
let livePrices = null;

function toPerMillion(entry) {
  const perTok = (v) => (typeof v === "number" && v > 0 ? v * 1_000_000 : 0);
  const input = perTok(entry.input_cost_per_token);
  const output = perTok(entry.output_cost_per_token);
  const cacheRead = perTok(
    entry.cache_read_input_token_cost ?? entry.cached_token_cost
  );
  const cacheWrite = perTok(entry.cache_creation_input_token_cost);
  if (!input && !output) return null;
  return { input, output, cacheRead, cacheWrite };
}

export function loadCachedPrices() {
  if (livePrices) return livePrices;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return null;
  }
  if (!raw || !raw.prices || typeof raw.prices !== "object") return null;
  if (Date.now() - (raw.fetchedAt || 0) > TTL_MS) return null;
  livePrices = raw.prices;
  return livePrices;
}

let mergedCache = { live: undefined, table: PRICES };

export function priceTable() {
  const cached = loadCachedPrices();
  if (mergedCache.live !== cached) {
    mergedCache = { live: cached, table: cached ? { ...PRICES, ...cached } : PRICES };
  }
  return mergedCache.table;
}

// Background refresh: never throws, never blocks collect().
export async function refreshPrices() {
  try {
    const st = fs.existsSync(CACHE_FILE)
      ? fs.statSync(CACHE_FILE)
      : null;
    if (st && Date.now() - st.mtimeMs < TTL_MS) {
      loadCachedPrices();
      return false;
    }
    const res = await fetch(LITELLM_URL, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return false;
    const data = await res.json();
    const prices = {};
    for (const [name, entry] of Object.entries(data)) {
      if (!entry || typeof entry !== "object") continue;
      const p = toPerMillion(entry);
      if (p) prices[String(name).toLowerCase()] = p;
    }
    if (!Object.keys(prices).length) return false;
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify({ fetchedAt: Date.now(), prices }, null, 1),
      "utf8"
    );
    livePrices = prices;
    return true;
  } catch {
    return false;
  }
}
// Kick off a refresh on import in long-lived processes; collect() itself
// stays synchronous and always has the hardcoded fallback.
if (process.argv[1] && String(process.argv[1]).endsWith("serve.mjs")) {
  refreshPrices();
  setInterval(refreshPrices, TTL_MS).unref?.();
}

let lookupCache = { table: null, exact: null, prefixes: null, memo: new Map() };

function getLookup() {
  const table = priceTable();
  if (lookupCache.table !== table) {
    const exact = new Map();
    const prefixes = [];
    for (const key of Object.keys(table)) {
      const lower = String(key).toLowerCase();
      exact.set(lower, table[key]);
      prefixes.push(lower);
    }
    prefixes.sort((a, b) => b.length - a.length); // longest first
    lookupCache = { table, exact, prefixes, memo: new Map() };
  }
  return lookupCache;
}

export function priceFor(model) {
  if (!model) return null;
  const m = String(model).toLowerCase();
  const { exact, prefixes, memo } = getLookup();
  if (memo.has(m)) return memo.get(m);
  let hit = exact.get(m) || null;
  if (!hit) {
    for (const p of prefixes) {
      if (m.startsWith(p)) { hit = exact.get(p); break; }
    }
  }
  if (memo.size > 5000) memo.clear();
  memo.set(m, hit || null);
  return hit || null;
}

// Cost for one record's token counts. Reasoning is billed as output only when
// the tool counts it separately (OpenCode); Claude/Codex callers pass 0.
export function costFor(model, { input = 0, cacheRead = 0, cacheWrite = 0, output = 0, reasoning = 0 }) {
  const p = priceFor(model);
  if (!p) return null;
  const M = 1_000_000;
  return (
    ((input * p.input + output * p.output + cacheRead * p.cacheRead + cacheWrite * p.cacheWrite) / M) +
    ((reasoning * p.output) / M)
  );
}
