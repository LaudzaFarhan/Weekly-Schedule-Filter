# Deployment Guide

How to push this web app to GitHub and ship it to production.

---

## 1. Prerequisites

Install once on your machine:

- [Git](https://git-scm.com/downloads)
- [Node.js 20+](https://nodejs.org/) (matches the GitHub Actions runner)
- A GitHub account with push access to [`LaudzaFarhan/Weekly-Schedule-Filter`](https://github.com/LaudzaFarhan/Weekly-Schedule-Filter)

Verify:

```bash
git --version
node --version
npm --version
```

---

## 2. One-Time Setup

If this is a fresh clone:

```bash
git clone https://github.com/LaudzaFarhan/Weekly-Schedule-Filter.git
cd Weekly-Schedule-Filter
npm install
```

Configure your git identity (only needed once per machine):

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

### Environment variables

Copy `.env.local` from a teammate (it is intentionally gitignored). The required keys live in `.env` for non-secret defaults and `.env.local` for secrets:

| Key                                       | Used by                              |
| ----------------------------------------- | ------------------------------------ |
| `NEXT_PUBLIC_DEFAULT_SHEET_URL`           | Default branch sheet URL fallback    |
| `NEXT_PUBLIC_FIREBASE_*`                  | Firebase Auth + Firestore client SDK |
| `GOOGLE_SERVICE_ACCOUNT_*` / `SHEETS_*`   | Server-side Google Sheets API access |

> Never commit `.env.local`. Double-check `git status` before each commit.

---

## 3. Daily Workflow — Push Changes to GitHub

From the project root:

```bash
# 1. Pull the latest main so you don't push on top of stale code
git pull origin main

# 2. See what's changed
git status
git diff

# 3. Stage only the files you intend to push
git add src/views/WorkloadPage.jsx DEPLOYMENT.md

# 4. Commit with a clear message
git commit -m "fix(workload): filter instructors by profile location"

# 5. Push to the main branch on GitHub
git push origin main
```

### Commit message style

Match the existing log:

- `fix: short description`
- `feat: short description`
- `docs: short description`
- `chore: short description`

Example commits already in the repo:

```
fix: treat student as absent if Lesson Arrange Date is '-'
feat: post-sync diff toast and disable-branch support
feat: UI redesign - dark sidebar, new header layout
```

---

## 4. Working on a Branch (Recommended for Larger Changes)

Direct pushes to `main` trigger a production deploy. For anything bigger than a small fix, use a feature branch and a pull request:

```bash
git checkout -b fix/workload-profile-filter
# ...edit files...
git add -A
git commit -m "fix(workload): filter by profile location"
git push -u origin fix/workload-profile-filter
```

Then open a PR on GitHub. Once approved, merge into `main` to deploy.

---

## 5. Automated Deployment (GitHub Actions)

Pushing to `main` runs `.github/workflows/deploy.yml`, which:

1. Checks out the code
2. Installs dependencies with `npm ci`
3. Runs `npm run build`
4. Uploads `./dist` to GitHub Pages
5. Publishes the site to GitHub Pages

Watch the run live: **Repo → Actions → Deploy static content to Pages**.

If the workflow fails:

- Click the failed step to read the logs
- Most failures are `build` errors — reproduce locally with `npm run build`
- Fix, commit, push again

> The workflow runs on Node 20. If your local Node is on a different major version and the build differs, install Node 20 to match.

---

## 6. Local Verification Before You Push

Run these locally to avoid red builds in CI:

```bash
# Lint
npm run lint

# Build (catches Next.js build errors)
npm run build

# Optional: smoke-test the production build
npm run start
```

Open <http://localhost:3000> and click through the pages you changed.

---

## 7. Firebase (Firestore Rules + Indexes)

The app uses Firestore for instructor profiles and workload snapshots. The schema is committed in:

- `firestore.rules`
- `firestore.indexes.json`

To deploy rule or index changes, install the Firebase CLI once:

```bash
npm install -g firebase-tools
firebase login
```

Then from the project root:

```bash
# Deploy Firestore rules
firebase deploy --only firestore:rules

# Deploy Firestore indexes
firebase deploy --only firestore:indexes
```

Firebase project ID lives in `.firebaserc`.

---

## 8. Quick Troubleshooting

| Symptom                                      | Fix                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| `git push` rejected (non-fast-forward)       | Run `git pull --rebase origin main`, resolve conflicts, push again             |
| `npm ci` fails locally                       | Delete `node_modules` and `package-lock.json`, run `npm install`               |
| Build fails on CI but passes locally         | Match Node version (`nvm use 20`) and re-run `npm ci && npm run build`         |
| GitHub Pages still shows old content         | Check **Actions** tab — the deploy may still be running or queued              |
| Firestore "permission-denied" after deploy   | Re-deploy `firestore.rules` (`firebase deploy --only firestore:rules`)         |
| Secret accidentally committed                | Rotate the secret, then remove the file with `git rm --cached <file>` + force push (ask the team first) |

---

## 9. Safety Checklist Before Pushing

- [ ] `git status` shows only the files I intend to commit
- [ ] No `.env.local`, no API keys, no service-account JSON staged
- [ ] `npm run build` passes locally
- [ ] Commit message describes the *why*, not just the *what*
- [ ] Pulled latest `main` before pushing

---

That's the whole pipeline. Edit → commit → push → GitHub Actions deploys.
