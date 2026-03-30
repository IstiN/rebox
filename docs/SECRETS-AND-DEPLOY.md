# Secrets, GitHub, Cloud Run, and npm

This project **never commits** real keys. Use the local `secrets/` folder (see `secrets/.gitignore`) on your machine only.

## Files on your disk (after setup)

| Local file | What it is | Where to paste in GitHub |
|------------|------------|---------------------------|
| `secrets/gcp_sa_key.json` | Service account JSON for CI | Repository secret **`GCP_SA_KEY`** — paste the **entire JSON** as one secret value |
| `secrets/rebox_api_key.txt` | One-line hex API key for the app | Repository secret **`REBOX_API_KEYS`** (optional but recommended) |

Also set repository secret **`GCP_PROJECT_ID`** to: `ai-native-478811`.

### npm publishing

Package name: **`@rebox/rebox`**. Create an npm token and org: **[docs/NPM-ORG.md](NPM-ORG.md)**. Add **`NPM_TOKEN`** in GitHub Actions secrets. Use workflow **Publish to npm** (manual or on release).

---

## One-time: generate files locally

If you do not have `secrets/gcp_sa_key.json` yet, use gcloud (project owners only):

```bash
# Create a dedicated deploy service account (once)
gcloud iam service-accounts create rebox-github-deploy \
  --project=ai-native-478811 \
  --display-name="rebox GitHub Actions deploy"

SA="rebox-github-deploy@ai-native-478811.iam.gserviceaccount.com"
PROJECT=ai-native-478811
NUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
RUNTIME_SA="${NUM}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA}" --role="roles/run.admin"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA}" --role="roles/artifactregistry.writer"
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --project="$PROJECT" \
  --member="serviceAccount:${SA}" \
  --role="roles/iam.serviceAccountUser"

mkdir -p secrets
gcloud iam service-accounts keys create secrets/gcp_sa_key.json --iam-account="$SA" --project="$PROJECT"
```

Generate a new **`REBOX_API_KEYS`** value (any secure random string; hex is fine):

```bash
mkdir -p secrets
npm run generate-api-key > secrets/rebox_api_key.txt
```

(or: `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex')+'\\n')"` → `secrets/rebox_api_key.txt`)

Apply it to Cloud Run:

```bash
KEY=$(tr -d '\n' < secrets/rebox_api_key.txt)
gcloud run deploy rebox \
  --image europe-west1-docker.pkg.dev/ai-native-478811/rebox-docker/rebox:latest \
  --region europe-west1 \
  --project ai-native-478811 \
  --platform managed \
  --allow-unauthenticated \
  --memory 4Gi --cpu 2 --timeout 300 --concurrency 1 --max-instances 1 --port 3000 \
  --set-env-vars "NODE_ENV=production,HOST=0.0.0.0,REBOX_API_KEYS=${KEY}"
```

---

## Read keys without opening files (optional)

**Cloud Run** (current deployed value):

```bash
gcloud run services describe rebox \
  --region=europe-west1 \
  --project=ai-native-478811 \
  --format=json | jq -r '.spec.template.spec.containers[0].env[] | select(.name=="REBOX_API_KEYS") | .value'
```

**GitHub**: Repository → **Settings** → **Secrets and variables** → **Actions** — values are write-only; to rotate, add a new secret value and redeploy.

---

## Workflows

| Workflow | Trigger | Needs |
|----------|---------|--------|
| **Deploy to Cloud Run** | Push to `main`, or manual | `GCP_SA_KEY`, `GCP_PROJECT_ID`, optional `REBOX_API_KEYS` |
| **Publish to npm** | Manual, or GitHub Release published | `NPM_TOKEN` |

---

## Security checklist

- [ ] `secrets/gcp_sa_key.json` and `secrets/rebox_api_key.txt` are **not** in `git status`
- [ ] Old SA keys deleted in [GCP IAM](https://console.cloud.google.com/iam-admin/serviceaccounts) if you rotate
- [ ] `REBOX_API_KEYS` never pasted into README, issues, or commits

---

## Production URL

`https://rebox-80693608388.europe-west1.run.app`

Swagger UI: `/docs` · OpenAPI JSON: `/docs/json`
