# Serve Vision HR Dashboard

HR Dashboard for Serve Vision Pvt Ltd — hosted on Cloudflare Pages, data stored on GitHub.

## Setup Guide

### Step 1: GitHub Personal Access Token

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Click "Generate new token"
3. Repository access: **Only select repositories** → `Servevisionpivot`
4. Permissions → Repository permissions:
   - **Contents**: Read and write
5. Generate token → **Copy it** (shown only once)

### Step 2: Deploy to Cloudflare Pages

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Pages → Create a project → Connect to Git
3. Select your GitHub account → Select `Servevisionpivot` repo
4. Build settings:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: `/`
5. Click **Save and Deploy**

### Step 3: Set Environment Variables

In Cloudflare Pages → Your project → Settings → Environment variables → Add:

| Variable | Value |
|----------|-------|
| `GITHUB_TOKEN` | Your GitHub token from Step 1 |
| `JWT_SECRET` | Any random string (e.g. `sv_secret_2026_xyz`) |
| `GITHUB_OWNER` | `servevision` |
| `GITHUB_REPO` | `Servevisionpivot` |

Click **Save** → **Redeploy**

### Step 4: Login

- URL: `https://your-project.pages.dev`
- Email: `Payments@servevision.io`
- Password: `Karnal#989630`

## File Structure

```
Servevisionpivot/
├── index.html          ← Login page
├── dashboard.html      ← Main HR Dashboard
├── functions/
│   └── api.js          ← Cloudflare Pages Function (serverless)
├── data/
│   ├── sheets.json     ← Employee sheet registry
│   ├── salary.json     ← Salary configurations
│   └── holiday.json    ← Holiday/leave configs
├── _redirects          ← Cloudflare routing
├── _headers            ← Security headers
└── wrangler.toml       ← Cloudflare config
```

## How It Works

```
Browser → Cloudflare Pages (index.html / dashboard.html)
               ↓ /api/* requests
          Cloudflare Pages Function (functions/api.js)
               ↓ GitHub REST API
          GitHub Repository (data/*.json files)
```

- **Login**: Worker verifies email+password, returns JWT token
- **Data Read**: Worker fetches JSON from GitHub, returns to browser
- **Data Write**: Worker updates JSON file in GitHub via API
- **All data** syncs across any device automatically
