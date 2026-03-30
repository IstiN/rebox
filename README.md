# rebox

Headless **Chromium** service: render a public URL and return **text** (Defuddle + visible text), **screenshot**, or **YouTube transcript**. OpenAPI + Swagger UI included.

## CLI (`rebox`)

Install globally (pulls server dependencies — best for contributors) or use `npx`:

```bash
npm install -g rebox
# or
npx rebox --help
```

Point at your deployment (or local server):

```bash
export REBOX_BASE_URL=https://your-service.run.app
export REBOX_API_KEY=your-key   # if the server uses REBOX_API_KEYS
```

Examples:

```bash
rebox health
rebox ready
rebox docs --open
rebox text https://example.com/ --visible-only
rebox image https://example.com/ -o /tmp/x.png --viewport-only
rebox audio 'https://www.youtube.com/watch?v=VIDEO_ID'
```

Global flags: `-b, --base-url`, `-k, --api-key`, `--header-style bearer|x-api-key`.

From a git clone without publishing:

```bash
npm run cli -- --help          # build + run bin
npm run cli:dev -- --help      # tsx, no build
```

## Server

```bash
npm ci
npm run build
npm start
```

Env: see `src/config.ts` (`REBOX_API_KEYS`, `REBOX_DEFAULT_SETTLE_MS`, etc.).

## License

MIT
