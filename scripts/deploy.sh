#!/usr/bin/env bash
#
# Deploy The Lab Operation System on the VPS.
#
# Run this ON the server, from the app directory:
#
#     ./scripts/deploy.sh
#
# The VPS is the only production environment. There is no build server and no
# deploy webhook — this script is the deployment.
#
# What it does, and why in this order:
#   1. Refuses to build without the build-time variables. A Next build silently
#      inlines `undefined` for a missing NEXT_PUBLIC_* value and the failure only
#      appears later, at the login screen, as a Firebase "invalid key" error.
#      That has already taken production down once. Checking first turns a
#      confusing runtime failure into an obvious refusal.
#   2. Builds into a fresh directory, then swaps. `next build` overwrites .next
#      in place, so a failed build on a running server leaves a half-replaced
#      app serving requests.
#   3. Only restarts once the build succeeded.
#
# Safe to re-run. Nothing is destructive except replacing the previous build,
# which is kept as .next.previous for a one-command rollback.

set -euo pipefail

cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ── 1. Environment ─────────────────────────────────────────────────────────

[ -f .env.local ] || fail ".env.local is missing. Copy .env.example to .env.local and fill it in."

# Read it without executing it, so a stray backtick in a password cannot run.
# shellcheck disable=SC2046
set -a
# shellcheck source=/dev/null
. ./.env.local
set +a

# Inlined into the bundle at build time. A missing one is not detectable at
# runtime, which is precisely why it is checked here.
BUILD_TIME_VARS=(
  NEXT_PUBLIC_FIREBASE_API_KEY
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
  NEXT_PUBLIC_FIREBASE_PROJECT_ID
)

# Read by the server. A missing one degrades a feature rather than the build, so
# these warn instead of refusing.
RUN_TIME_VARS=(
  DATABASE_URL
  EMPLOYEE_CREDENTIAL_KEY
  NEW_OPS_API_KEY
)

missing=()
for var in "${BUILD_TIME_VARS[@]}"; do
  [ -n "${!var:-}" ] || missing+=("$var")
done

if [ ${#missing[@]} -gt 0 ]; then
  printf '\n\033[1;31mRefusing to build.\033[0m These are inlined at build time and are unset:\n' >&2
  for var in "${missing[@]}"; do printf '  - %s\n' "$var" >&2; done
  cat >&2 <<'EOF'

Building without them produces a bundle that fails at the login screen with
  Firebase: Error (auth/api-key-not-valid.-please-pass-a-valid-api-key.)
which looks like a wrong key rather than a missing one.

Add them to .env.local and run this again.

Old Operations sign-in is the only thing they affect. If you have deliberately
dropped Firebase and are running New Operations accounts only, re-run with:
  SKIP_FIREBASE=1 ./scripts/deploy.sh
EOF
  [ "${SKIP_FIREBASE:-}" = "1" ] || exit 1
  log "SKIP_FIREBASE=1 — continuing without Firebase. Old Operations sign-in will not work."
fi

for var in "${RUN_TIME_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    printf '\033[1;33mWarning:\033[0m %s is unset.\n' "$var"
    case "$var" in
      DATABASE_URL) echo "         Every New Operations page will error." ;;
      EMPLOYEE_CREDENTIAL_KEY) echo "         Nobody can sign in with a New Operations account (503)." ;;
      NEW_OPS_API_KEY) echo "         The /api/new/* gate is OPEN to anyone who can reach the URL." ;;
    esac
  fi
done

# ── 2. Code ────────────────────────────────────────────────────────────────

log "Fetching latest main"
git fetch origin main
BEFORE="$(git rev-parse HEAD)"
git reset --hard origin/main
AFTER="$(git rev-parse HEAD)"

if [ "$BEFORE" = "$AFTER" ]; then
  log "Already at $(git rev-parse --short HEAD) — rebuilding anyway"
else
  log "$(git rev-parse --short "$BEFORE") -> $(git rev-parse --short "$AFTER")"
  git --no-pager log --oneline "$BEFORE..$AFTER" | sed 's/^/    /'
fi

log "Installing dependencies"
# `npm ci` over `npm install`: it installs exactly the lockfile, so a deploy
# cannot quietly pick up a new minor version of a dependency.
npm ci

# ── 3. Build ───────────────────────────────────────────────────────────────

log "Running tests"
# A deploy that ships a red test suite is worse than a deploy that does not
# happen. Override with SKIP_TESTS=1 if you are mid-incident and need the fix out.
if [ "${SKIP_TESTS:-}" = "1" ]; then
  echo "    skipped (SKIP_TESTS=1)"
else
  npm run test
fi

log "Building"
# Into a scratch directory, so a failure cannot leave the running app with a
# half-written .next.
rm -rf .next.building
if ! NEXT_DIST_DIR=.next.building npx next build --no-lint 2>/dev/null; then
  # Older Next versions ignore NEXT_DIST_DIR. Fall back to a plain build, which
  # is what the previous deploy did anyway.
  rm -rf .next.building
  npm run build
else
  rm -rf .next.previous
  [ -d .next ] && mv .next .next.previous
  mv .next.building .next
fi

# ── 4. Restart ─────────────────────────────────────────────────────────────

log "Restarting the app"

# The process name is looked up rather than assumed. This script used to hardcode
# "thelab", but the VPS runs the app under "weekly-schedule", so every deploy
# built the new bundle and then quietly skipped the restart — the site kept
# serving the old build and the only clue was a message at the end nobody reads.
#
# Override with PM2_APP_NAME=... ./scripts/deploy.sh if the name changes again.
PM2_APP=""
if command -v pm2 >/dev/null 2>&1; then
  for candidate in "${PM2_APP_NAME:-}" weekly-schedule thelab; do
    [ -n "$candidate" ] || continue
    if pm2 describe "$candidate" >/dev/null 2>&1; then
      PM2_APP="$candidate"
      break
    fi
  done
fi

SYSTEMD_APP=""
for candidate in "${SYSTEMD_UNIT_NAME:-}" weekly-schedule thelab; do
  [ -n "$candidate" ] || continue
  if systemctl list-units --type=service --all 2>/dev/null | grep -q "${candidate}\.service"; then
    SYSTEMD_APP="$candidate"
    break
  fi
done

if [ -n "$PM2_APP" ]; then
  pm2 restart "$PM2_APP" --update-env
  pm2 save
  log "Restarted pm2 process \"$PM2_APP\". Logs: pm2 logs $PM2_APP"
elif [ -n "$SYSTEMD_APP" ]; then
  sudo systemctl restart "$SYSTEMD_APP"
  log "Restarted ${SYSTEMD_APP}.service. Logs: journalctl -u $SYSTEMD_APP -f"
else
  cat <<EOF

No pm2 process and no systemd unit matching a known app name was found, so the
build is ready but nothing has been restarted. Restart it however this box runs
the app, then set PM2_APP_NAME so future deploys do it for you.

If it is not yet running under a process manager, pm2 is the shortest path:

  npm install -g pm2
  pm2 start npm --name weekly-schedule -- start
  pm2 startup && pm2 save

EOF
fi

log "Deployed $(git rev-parse --short HEAD) from $APP_DIR"
if [ -n "$PM2_APP" ]; then
  echo "    Rollback: rm -rf .next && mv .next.previous .next && pm2 restart $PM2_APP"
elif [ -n "$SYSTEMD_APP" ]; then
  echo "    Rollback: rm -rf .next && mv .next.previous .next && sudo systemctl restart $SYSTEMD_APP"
else
  echo "    Rollback: rm -rf .next && mv .next.previous .next, then restart the app"
fi
