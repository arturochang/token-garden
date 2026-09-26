# Security policy

Token Garden reads private coding-agent logs, so its security boundary is
deliberately small: a loopback-only HTTP server and a static page.

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/arturochang/token-garden/security/advisories/new)
rather than a public issue. Do not attach real session logs, prompts, or usage
exports; a synthetic reproduction is enough.

## Threat model

In scope:

- Another website open in the same browser reading or modifying local data
  (DNS rebinding, CSRF, cross-origin reads).
- Log-derived text (titles, paths, model names) executing as markup or script
  in the dashboard.
- Path traversal through the static `/crews/` and `/i18n/` routes.
- Collectors modifying source logs or databases (they must be read-only).
- Private data reaching the repository or the anonymized snapshot export.

Out of scope:

- Other local users or processes on the same machine; loopback is not an
  authentication boundary.
- Crew scripts placed in `crews/` or `crews/private/`. Installing one is an
  explicit decision to run that code, so review it first.
- Exposing the server beyond `127.0.0.1`, which is unsupported.

## Built-in defenses

- The server binds to `127.0.0.1` and rejects any `Host` header other than
  `127.0.0.1:<port>` or `localhost:<port>`.
- Requests carrying a foreign `Origin` are rejected, and preference writes
  require `Content-Type: application/json`, a size limit, and an allowlist of keys.
- The page is served with a Content Security Policy (`connect-src 'self'`,
  `frame-ancestors 'none'`), `nosniff`, and `no-referrer`.
- Static routes accept only flat `[A-Za-z0-9._+-]+.js` names.
- The only outbound request from Node is the public LiteLLM price table, which
  sends no local data. `TOKEN_GARDEN_OFFLINE=1` disables it.
