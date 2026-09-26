// Price estimates (USD per 1M tokens). Hardcoded table is the fallback;
// a LiteLLM snapshot is layered on top (refreshed hourly by the server, and
// kept when stale or offline). Not exact.
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
let liveFetchedAt = null;
// The cache file is ~0.5 MB. Remember failed/stale loads so hot paths
// (costFor runs once per parsed record) never re-read it more than once a minute.
let lastLoadAttempt = 0;
const RELOAD_MS = 60_000;

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

// A stale snapshot is still better than the coarse built-in table, so it is
// used until a refresh replaces it; priceMeta() reports its age to the UI.
export function loadCachedPrices() {
  if (livePrices) return livePrices;
  const now = Date.now();
  if (now - lastLoadAttempt < RELOAD_MS) return null;
  lastLoadAttempt = now;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return null;
  }
  if (!raw || !raw.prices || typeof raw.prices !== "object" || Array.isArray(raw.prices)) return null;
  livePrices = raw.prices;
  liveFetchedAt = typeof raw.fetchedAt === "number" ? raw.fetchedAt : null;
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

// Provenance + freshness for the UI's price tooltips: whether the merged
// table currently has a live LiteLLM layer, and how old that snapshot is.
export function priceMeta() {
  const live = !!loadCachedPrices();
  return { live, fetchedAt: live ? liveFetchedAt : null };
}

export const pricesOffline = () => /^(1|true|yes)$/i.test(process.env.TOKEN_GARDEN_OFFLINE || "");

// Background refresh: never throws, never blocks collect(). This is the only
// network request Token Garden's Node side makes; it sends no local data.
export async function refreshPrices({ force = false } = {}) {
  if (pricesOffline()) return false;
  try {
    const st = fs.existsSync(CACHE_FILE) ? fs.statSync(CACHE_FILE) : null;
    if (!force && st && Date.now() - st.mtimeMs < TTL_MS) {
      loadCachedPrices();
      return false;
    }
    const res = await fetch(LITELLM_URL, { signal: AbortSignal.timeout(15000), redirect: "error" });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data || typeof data !== "object") return false;
    const prices = {};
    for (const [name, entry] of Object.entries(data)) {
      if (!entry || typeof entry !== "object") continue;
      const p = toPerMillion(entry);
      if (p) prices[String(name).toLowerCase()] = p;
    }
    if (!Object.keys(prices).length) return false;
    const fetchedAt = Date.now();
    const tmp = `${CACHE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ fetchedAt, prices }), "utf8");
    fs.renameSync(tmp, CACHE_FILE);
    livePrices = prices;
    liveFetchedAt = fetchedAt;
    return true;
  } catch {
    return false;
  }
}

// Long-lived processes (serve.mjs) call this once; collect() itself stays
// synchronous and always has the hardcoded fallback.
export function startPriceRefresh() {
  if (pricesOffline()) return;
  refreshPrices();
  setInterval(refreshPrices, TTL_MS).unref?.();
}

let lookupCache = { table: null, exact: null, prefixes: null, memo: new Map() };

function getLookup() {
  const table = priceTable();
  if (lookupCache.table !== table) {
    const live = loadCachedPrices();
    const exact = new Map();
    const prefixes = [];
    for (const key of Object.keys(table)) {
      const lower = String(key).toLowerCase();
      // A live-cache entry wins the merge (see priceTable), so its presence
      // there — not just in the hardcoded PRICES — decides provenance.
      const fromLive = !!(live && Object.prototype.hasOwnProperty.call(live, lower));
      exact.set(lower, { price: table[key], live: fromLive });
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
  memo.set(m, hit ? hit.price : null);
  return hit ? hit.price : null;
}

// Same lookup as priceFor, but returns provenance too — for UI tooltips that
// need to say "live" vs "built-in estimate" rather than just the numbers.
export function priceInfoFor(model) {
  if (!model) return null;
  const m = String(model).toLowerCase();
  const { exact, prefixes } = getLookup();
  let hit = exact.get(m) || null;
  let matchedKey = hit ? m : null;
  if (!hit) {
    for (const p of prefixes) {
      if (m.startsWith(p)) { hit = exact.get(p); matchedKey = p; break; }
    }
  }
  if (!hit) return null;
  return { price: hit.price, live: hit.live, matchedKey };
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
