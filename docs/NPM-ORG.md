# npm organization `@rebox` and publish token

This package is published as **`@rebox/rebox`**. The CLI command stays **`rebox`** (see `bin` in `package.json`).

## 1. Create the npm org

1. Sign in at [https://www.npmjs.com](https://www.npmjs.com).
2. Open **[Create an organization](https://www.npmjs.com/org/create)** (or: avatar → **Add an organization**).
3. Choose org name **`rebox`** (npm will show `@rebox` as the scope).
   - If the name is taken, pick another org name and change `package.json` → `"name": "@your-scope/rebox"`.
4. Plan: **Unlimited public packages** is enough for an open-source CLI; paid plans are for private packages.

Add any teammates under **Organization → Members** with **Developer** (can publish) or **Owner**.

### If you get **HTTP 400** (or the form fails) on org creation

npm’s site often returns **400 Bad Request** without a clear message. Try this order:

1. **Confirm your email** on the npm account (avatar → **Account** → email must be **verified**).
2. **Turn off VPN / ad blockers** for `npmjs.com` and try again, or another browser / incognito.
3. **Name conflict:** the string `rebox` may already be an **npm username**, **organization**, or **reserved**. Try another org name (e.g. `rebox-dev`, `reboxjs`, `getrebox`), then set in `package.json`:
   ```json
   "name": "@your-org-name/rebox"
   ```
4. **Billing / region:** if you picked a **paid** plan by mistake, fix payment or choose **Unlimited public packages** (free).
5. Still failing: [npm status](https://status.npmjs.org/) and [npm support](https://www.npmjs.com/support) (or [GitHub npm/feedback](https://github.com/npm/feedback)).

**You do not need an org** to publish: use your **personal scope** instead (same token flow):

- Pick your npm **username** (e.g. `istiN`) → package name **`@istiN/rebox`**.
- Update `"name"` in `package.json`, then `npm publish --access public`.

## 2. Link the GitHub repo (optional)

Under **Organization → Packages** you can connect GitHub for visibility; not required for `npm publish`.

## 3. Create a token for GitHub Actions

npm recommends **granular tokens** for CI.

### Option A — Granular access token (preferred)

1. Avatar → **Access tokens** → **Generate new token** → **Granular access token**.
2. Name: e.g. `github-actions-rebox`.
3. Expiration: your policy (e.g. 1 year) or rotate regularly.
4. **Packages and scopes**
   - **Permissions:** **Read and write**.
   - **Packages:** restrict to **`@rebox/rebox`** only (safer than “all packages”).
5. Generate and **copy the token once** (it will not be shown again).

### Option B — Classic “Automation” token

1. **Access tokens** → **Generate new token** → **Classic token**.
2. Type: **Automation** (for CI/CD).
3. Copy the token.

Classic tokens have broad access to everything your user can publish; prefer granular when possible.

## 4. Put the token in GitHub

Repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

- Name: **`NPM_TOKEN`**
- Value: the token string

The workflow [`.github/workflows/publish-npm.yml`](../.github/workflows/publish-npm.yml) uses `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` with `registry-url: https://registry.npmjs.org`.

## 5. First publish (local, once)

The **first** publish of a scoped package must usually be **public** (unless you pay for private):

```bash
npm login
npm whoami
npm publish --access public
```

After that, GitHub Actions can publish new versions (bump `version` in `package.json` or use `npm version patch` on a branch you merge).

## 6. Install for users

```bash
npm install -g @rebox/rebox
rebox --help
# or
npx @rebox/rebox --help
```

## Troubleshooting

| Error | What to do |
|-------|------------|
| `403 Forbidden` / not allowed to publish | Your npm user must be in org **`@rebox`** with permission to publish; token must include **write** for `@rebox/rebox`. |
| `402 Payment Required` | Scoped **private** package without paid org — use `--access public` or org with private seats. |
| Name already exists | Bump `version` in `package.json` or unpublish within 72h window (npm policy). |

Official docs: [Creating and viewing access tokens](https://docs.npmjs.com/creating-and-viewing-access-tokens), [Scoped packages](https://docs.npmjs.com/about-scopes).
