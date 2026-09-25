// POC price estimates (USD per 1M tokens). Not exact.
export const PRICES = {
  "claude-opus-5": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-opus-4": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-sonnet": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-fable": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
};

export function priceFor(model) {
  if (!model) return null;
  let best = null;
  for (const prefix of Object.keys(PRICES)) {
    if (model.startsWith(prefix) && (best === null || prefix.length > best.length)) {
      best = prefix;
    }
  }
  return best ? PRICES[best] : null;
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
