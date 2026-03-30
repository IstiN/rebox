# rebox

**Headless Chromium as an API and CLI** — open almost any public **https** URL and get **clean article text** (Defuddle), a **full-page or viewport screenshot** (PNG/WebP), or a **YouTube transcript**. Ships with **OpenAPI 3** and **Swagger UI** at `/docs`.

[![npm](https://img.shields.io/npm/v/@rebox.me/rebox?label=npm&logo=npm)](https://www.npmjs.com/package/@rebox.me/rebox)
[![Node](https://img.shields.io/node/v/@rebox.me/rebox)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Highlights

| Capability | What you get |
|------------|----------------|
| **Plain URL API** | `POST /rebox/text`, `/rebox/image`, `/rebox/audio` with JSON `{ "url": "https://…" }` — no `encodeURIComponent` in the path |
| **CLI** | `rebox <url>` picks **text** vs **YouTube transcript** automatically; can **start a local server** when `127.0.0.1:3000` is free |
| **Screenshots** | Full-page capture with an optional **scroll pass** so lazy sections (e.g. long comment threads) expand first — tuned via `scroll_full_page` and `REBOX_FULL_PAGE_SCROLL_MAX_MS` |
| **Safety** | SSRF checks on every target URL |

---

## Install the CLI (`@rebox.me/rebox`)

```bash
npm install -g @rebox.me/rebox
rebox --help
```

Or without installing:

```bash
npx @rebox.me/rebox --help
```

**npm org:** [`@rebox.me`](https://www.npmjs.com/org/rebox.me) — publishing and tokens: [docs/NPM-ORG.md](docs/NPM-ORG.md).

---

## CLI quick reference

Point at your server (Cloud Run or local):

```bash
export REBOX_BASE_URL=https://your-service.run.app   # optional; default http://127.0.0.1:3000
export REBOX_API_KEY=your-key                        # if the server uses REBOX_API_KEYS
```

| Invocation | Behaviour |
|------------|-----------|
| `rebox https://example.com/page` | Article-style **text** to stdout (markdown when available) |
| `rebox https://www.youtube.com/watch?v=…` | **Transcript** lines to stdout |
| `rebox text <url> --json` | Full JSON from `/rebox/text` |
| `rebox image <url> -o out.png` | Screenshot; **`--no-scroll`** skips lazy-load scrolling |
| `rebox audio <url> --json` | Raw transcript JSON |

**Useful flags:** `-b` / `--base-url`, `-k` / `--api-key`, `--header-style bearer|x-api-key`, `--no-auto-server` (never spawn a local server — use when you already run `npm start` elsewhere). Example with a custom port: `PORT=3847 npm start` in one shell, then `REBOX_BASE_URL=http://127.0.0.1:3847 rebox …`.

From a git clone:

```bash
npm ci && npm run build && npm link    # makes `rebox` available globally
npm run cli:dev -- --help              # tsx, no separate build step
```

---

## HTTP API (summary)

When **`REBOX_API_KEYS`** is set, send **`X-API-Key`** or **`Authorization: Bearer <key>`** on protected routes. **`/health`**, **`/ready`**, and **`/docs`** stay usable without a key.

| Endpoint | Role |
|----------|------|
| `POST /rebox/text` | Article + `visibleText` (+ timings) |
| `POST /rebox/image` | Raw **PNG** or **WebP** bytes (`fullPage`, `scroll_full_page`, `format`, …) |
| `POST /rebox/audio` | YouTube captions as JSON |
| `GET /docs` | Swagger UI |
| `GET /docs/json` | OpenAPI document |

**Legacy:** `GET|POST /rebox/<encodeURIComponent(url)>/text|image|audio` — same behaviour.

Example:

```bash
BASE=https://your-service.run.app
KEY=your-api-key

curl -sS -X POST "$BASE/rebox/text" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/","timeout_ms":60000}'
```

Full contract: [openapi.yaml](openapi.yaml).

---

## Run the server locally

```bash
npm ci
npm run build
npm start
```

Important environment variables (see `src/config.ts`): `PORT`, `HOST`, `REBOX_API_KEYS`, `REBOX_DEFAULT_SETTLE_MS`, `MAX_SCREENSHOT_BYTES`, `REBOX_FULL_PAGE_SCROLL_MAX_MS`, …

---

## Docker

```bash
docker build -t rebox .
docker run --rm -p 3000:3000 -e NODE_ENV=production rebox
```

---

## GitHub Actions

| Workflow | When | Purpose |
|----------|------|---------|
| [CI](.github/workflows/ci.yml) | Push / PR to `main` | `npm ci`, `build`, unit tests |
| [Deploy to Cloud Run](.github/workflows/deploy-cloud-run.yml) | Push to `main` or manual | Build image → Artifact Registry → deploy **`rebox`** (`europe-west1`) |
| [Publish to npm](.github/workflows/publish-npm.yml) | Release published or manual | Publishes **`@rebox.me/rebox`** |

Secrets and one-time GCP setup: **[docs/SECRETS-AND-DEPLOY.md](docs/SECRETS-AND-DEPLOY.md)**.

Publishing **`@rebox.me/rebox`** from Actions needs a token that does not require a browser OTP (granular or Automation token — see **[docs/NPM-ORG.md](docs/NPM-ORG.md)**).

---

## License

MIT
