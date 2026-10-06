#!/usr/bin/env bash
#
# Deploys this project on the VPS: fetch, install, generate, migrate, build, reload.
#
# Why this file exists at all
# --------------------------
# The procedure used to live only in whoever ran it, and the step that mattered —
# regenerating the Prisma client — was the one that got forgotten. The symptom is
# nasty and was seen here: `src/generated/prisma` is gitignored, so `git reset --hard`
# cannot restore it and `git pull` never touches it. After a schema change the checked
# out code asks for models the generated client has never heard of, and the build
# fails with
#
#   error TS2339: Property 'forumTopic' does not exist on type 'PrismaClient<…>'
#
# which reads like a broken schema rather than a missing generated file.
#
# Order, and why this order
# ------------------------
#   npm ci            installs dependencies; its postinstall runs `prisma generate`
#   prisma generate   run explicitly anyway, and this is the step that matters
#   prisma migrate    applies schema changes to the database
#   npm run build     regenerates once more, then builds
#   pm2 reload        restarts the app on the new build
#
# The explicit `prisma generate` is not redundant with postinstall. postinstall only
# runs when dependencies are actually installed; on a redeploy where `npm ci` is
# skipped — or fails partway — nothing regenerates the client and the build is the
# first thing to notice. `npm run build` generating too means the app cannot be built
# from a checkout with a stale or missing client by any route.
#
# `prisma generate` needs no database, so it runs before `migrate deploy` on purpose:
# a missing DATABASE_URL should not be able to block regenerating a client that does
# not depend on one.
#
# Usage: bash deploy.sh [--skip-pull]
#   PM2_APP  overrides the process name (default: uartnews)
#   PM2_SKIP_PULL=1 is the same as --skip-pull

set -euo pipefail

APP_NAME="${PM2_APP:-uartnews}"
NODE_OPTIONS_VALUE="${NODE_OPTIONS:---max-old-space-size=512}"
SKIP_PULL=0

for argument in "$@"; do
  case "$argument" in
    --skip-pull) SKIP_PULL=1 ;;
    *) echo "unknown argument: $argument" >&2; exit 2 ;;
  esac
done

if [ "$SKIP_PULL" -eq 1 ] || [ "${PM2_SKIP_PULL:-0}" = "1" ]; then
  echo "==> pull skipped, deploying the working tree as it is"
else
  echo "==> fetching origin/main"
  git fetch --depth 1 origin main
  # --hard on purpose: a half-applied merge in production is worse than losing local
  # edits, and the editor changes nothing here.
  git reset --hard origin/main
fi
echo "    $(git log --oneline -1)"

echo "==> installing dependencies"
# `npm ci` wipes node_modules and reinstalls from the lockfile. It also runs
# postinstall, which is `prisma generate` — but see below for why that is not enough.
npm ci --no-audit --no-fund

echo "==> generating the Prisma client"
npx prisma generate
# Fail here rather than inside the build. A missing client otherwise surfaces as a
# TypeScript error about a model that plainly does exist in the schema, which sends
# you looking in the wrong file.
if [ ! -d src/generated/prisma ]; then
  echo "ERROR: src/generated/prisma is still missing after generate." >&2
  exit 1
fi

echo "==> applying migrations"
npx prisma migrate deploy

echo "==> building (NODE_OPTIONS=$NODE_OPTIONS_VALUE)"
NODE_OPTIONS="$NODE_OPTIONS_VALUE" npm run build

echo "==> reloading pm2 process '$APP_NAME'"
pm2 reload "$APP_NAME" --update-env

sleep 8
if ! pm2 list --no-color | grep -q "$APP_NAME"; then
  echo "ERROR: pm2 process '$APP_NAME' is not listed after reload." >&2
  pm2 list --no-color >&2 || true
  exit 1
fi
pm2 list --no-color | grep "$APP_NAME"

echo "==> done: $(git log --oneline -1)"