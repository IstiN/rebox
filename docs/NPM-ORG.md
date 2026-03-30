# npm organization `@rebox.me` and publishing

This package is published as **`@rebox.me/rebox`**. The CLI command on disk stays **`rebox`** (see `bin` in `package.json`).

## Recommended: Trusted Publishing (no token, no OTP)

GitHub Actions can publish with **OpenID Connect** so you do **not** need `NPM_TOKEN` and you avoid **`EOTP`** (2FA prompts) for CI.

### One-time setup on npmjs.com

1. Open **[npmjs.com/package/@rebox.me/rebox/access](https://www.npmjs.com/package/@rebox.me/rebox/access)** (or **Package → Settings → Trusted publishing**).
2. Add **GitHub Actions** as trusted publisher:
   - **Repository:** must match `package.json` → **`IstiN/rebox`** (owner + name exactly).
   - **Workflow filename:** **`publish-npm.yml`** (exactly — same file as [`.github/workflows/publish-npm.yml`](../.github/workflows/publish-npm.yml), including `.yml`).
3. Save. npm does not validate until the next publish.

### What the repo already does

The workflow sets **`permissions: id-token: write`**, uses **Node 22** and **npm ≥ 11.5.1** (required by [npm Trusted publishers](https://docs.npmjs.com/trusted-publishers)), and runs **`npm publish`** **without** `NODE_AUTH_TOKEN`.

### After OIDC works

- **Delete** the **`NPM_TOKEN`** repository secret if you added one earlier. A leftover token can still be picked up and cause **`EOTP`** in some setups.
- Re-run **Actions → Publish to npm** (or publish a GitHub Release).

### If publish says ENEEDAUTH / OIDC failed

- Workflow name on npm must match **`publish-npm.yml`** (case-sensitive).
- **`repository.url`** in `package.json` must be **`https://github.com/IstiN/rebox.git`** (or the same repo URL npm expects).
- Only **GitHub-hosted** runners are supported (not self-hosted).

---

## Legacy: publish token (often hits `EOTP` with 2FA)

If you are **not** using Trusted Publishing, you need a token in **`NPM_TOKEN`**. Classic tokens frequently trigger **`EOTP`** when the account has 2FA. Prefer **granular** “Automation”-style tokens or switch to OIDC above.

## 1. Organization

Use the npm org **`rebox.me`** (scope **`@rebox.me`**). If you create another org, set in `package.json`:

```json
"name": "@your-scope/rebox"
```

### If you get **HTTP 400** (or the form fails) on org creation

npm’s site often returns **400 Bad Request** without a clear message. Try this order:

1. **Confirm your email** on the npm account (avatar → **Account** → email must be **verified**).
2. **Turn off VPN / ad blockers** for `npmjs.com` and try again, or another browser / incognito.
3. **Name conflict:** pick another org name, then set `"name": "@your-scope/rebox"` in `package.json`.
4. **Billing / region:** if you picked a **paid** plan by mistake, fix payment or choose **Unlimited public packages** (free).
5. Still failing: [npm status](https://status.npmjs.org/) and [npm support](https://www.npmjs.com/support) (or [GitHub npm/feedback](https://github.com/npm/feedback)).

**You do not need an org** to publish: use your **personal scope** instead (same token flow):

- Pick your npm **username** (e.g. `istiN`) → package name **`@istiN/rebox`**.
- Update `"name"` in `package.json`, then `npm publish --access public`.

## 2. Link the GitHub repo (optional)

Under **Organization → Packages** you can connect GitHub for visibility; not required for `npm publish`.

## 3. Create a token for GitHub Actions (legacy only)

Prefer **Trusted Publishing** (top of this doc). If you still use a token:

npm recommends **granular tokens** for CI.

### Option A — Granular access token (preferred)

1. Avatar → **Access tokens** → **Generate new token** → **Granular access token**.
2. Name: e.g. `github-actions-rebox`.
3. Expiration: your policy (e.g. 1 year) or rotate regularly.
4. **Packages and scopes**
   - **Permissions:** **Read and write**.
   - **Packages:** restrict to **`@rebox.me/rebox`** only (safer than “all packages”).
5. Generate and **copy the token once** (it will not be shown again).

### Option B — Classic “Automation” token

1. **Access tokens** → **Generate new token** → **Classic token**.
2. Type: **Automation** (for CI/CD).
3. Copy the token.

Classic tokens have broad access to everything your user can publish; prefer granular when possible.

## 4. Put the token in GitHub (legacy only)

Only if you are **not** using OIDC trusted publishing:

- Name: **`NPM_TOKEN`**
- Value: the token string

The current **Publish to npm** workflow is **OIDC-first** and does **not** pass `NPM_TOKEN` to `npm publish`.

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
npm install -g @rebox.me/rebox
rebox --help
# or
npx @rebox.me/rebox --help
```

## Troubleshooting

| Error | What to do |
|-------|------------|
| `404 Not Found` on `PUT .../@scope%2fpackage` | Often **wrong scope in `package.json`** (e.g. old `@rebox/rebox`) or CI ran an **old commit**. On GitHub: **Actions → workflow → Re-run** only after **main** has `"name": "@rebox.me/rebox"`. Also: token must allow **write** to that exact package (granular token) or your user must be in org **`rebox.me`** with publish rights. |
| `403 Forbidden` / not allowed to publish | Your npm user must be in org **`@rebox.me`** with permission to publish; token must include **write** for **`@rebox.me/rebox`**. |
| `402 Payment Required` | Scoped **private** package without paid org — use `--access public` or org with private seats. |
| `EOTP` / “requires a one-time password” in CI | Your npm account has **2FA** enabled and the token in **`NPM_TOKEN`** is not exempt. Use a **granular access token** with **Read and write** on **`@rebox.me/rebox`** only (see §3 Option A), or an **Automation** classic token — those publish from CI without an OTP. Replace the GitHub secret and re-run the workflow. |
| Name already exists | Bump `version` in `package.json` or unpublish within 72h window (npm policy). |

Official docs: [Creating and viewing access tokens](https://docs.npmjs.com/creating-and-viewing-access-tokens), [Scoped packages](https://docs.npmjs.com/about-scopes).
