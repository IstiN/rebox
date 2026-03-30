# rebox

Headless **Chromium** service: open a public URL and return **text** (Defuddle + visible text), **PNG/WebP screenshot**, or **YouTube transcript**. Ships with **OpenAPI** and **Swagger UI** (`/docs`).

**Deploy & secrets:** see [docs/SECRETS-AND-DEPLOY.md](docs/SECRETS-AND-DEPLOY.md).

---

## HTTP API

**Base URL (example):** `https://rebox-80693608388.europe-west1.run.app`  
Replace with your own Cloud Run URL when self-hosting.

### Auth (when `REBOX_API_KEYS` is set)

Send **one** of:

- `X-API-Key: <key>`
- `Authorization: Bearer <key>`

Public without key: `GET /health`, `GET /ready`, `GET /docs` (and static assets under `/docs`).

### Recommended: plain URL (no `encodeURIComponent` in the path)

| Action | Method | Path | Body / query |
|--------|--------|------|----------------|
| Text + article JSON | `POST` | `/rebox/text` | JSON `{"url":"https://…","timeout_ms":60000,"settle_ms":2000}` |
| Screenshot file | `POST` | `/rebox/image` | JSON `{"url":"https://…","format":"png","fullPage":"true"}` — response is raw image bytes |
| YouTube transcript | `POST` | `/rebox/audio` | JSON `{"url":"https://www.youtube.com/watch?v=…"}` |

`GET` with `?url=` is also supported; encode the **value** once if the URL contains `?`, `&`, or `#`.

### Legacy path style

`GET|POST /rebox/<encodeURIComponent(url)>/text|image|audio` — same behaviour, URL as a single path segment.

### Discovery

- `GET /` — route map (may require auth if keys are enabled)
- `GET /docs` — Swagger UI
- `GET /docs/json` — OpenAPI document

### curl example

```bash
export BASE=https://rebox-80693608388.europe-west1.run.app
export KEY=your-api-key

curl -sS -X POST "$BASE/rebox/text" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/","timeout_ms":30000,"settle_ms":0}'
```

---

## CLI (`rebox` binary)

Install (includes server dependencies; large install) or use `npx`:

```bash
npm install -g rebox
npx rebox --help
```

Point at your deployment:

```bash
export REBOX_BASE_URL=https://rebox-80693608388.europe-west1.run.app
export REBOX_API_KEY=your-api-key
```

**Shorthand** (same as `rebox text <url>`):

```bash
rebox https://example.com/
```

**Commands:** `health`, `ready`, `info`, `docs [--open]`, `openapi [-o file]`, `text <url>`, `image <url> -o out.png`, `audio <url>`.

**Flags:** `-b/--base-url`, `-k/--api-key`, `--header-style bearer|x-api-key`.

From a git clone:

```bash
npm run cli -- --help          # build + run bin
npm run cli:dev -- --help      # tsx, no build
```

---

## Run the server locally

```bash
npm ci
npm run build
npm start
```

Environment variables: see `src/config.ts` (`REBOX_API_KEYS`, `REBOX_DEFAULT_SETTLE_MS`, `PORT`, `HOST`, …).

---

## CI workflows (GitHub Actions)

| Workflow | Purpose |
|----------|---------|
| [Deploy to Cloud Run](.github/workflows/deploy-cloud-run.yml) | Build image, push Artifact Registry, deploy `rebox` |
| [Publish to npm](.github/workflows/publish-npm.yml) | `npm publish` (manual or on **Release**) |

Secrets are documented in [docs/SECRETS-AND-DEPLOY.md](docs/SECRETS-AND-DEPLOY.md).

---

## License

MIT
