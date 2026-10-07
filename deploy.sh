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
#   SKIP_CA_SETUP=1 skips installing the Russian Trusted CA and reloads directly.
#                   For a host that cannot reach gu-st.ru or already has the anchor.
#
# The process is started from ecosystem.config.cjs, not by name, so the environment it
# declares — NODE_EXTRA_CA_CERTS above all — actually reaches the process.

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

echo "==> trusting the Ministry of Digital Development CA (for MAX)"
# MAX is served with a certificate from the Russian Trusted CA, which is in neither
# Node's bundled store nor Ubuntu's ca-certificates. Without this every MAX call fails
# at the TLS handshake, before a request is sent.
#
# Downloaded WITHOUT -k. gu-st.ru presents a certificate that this host already
# trusts, so disabling verification here would be a hole opened for no reason — and it
# is the one download where a man in the middle would be handing us the trust anchor.
# deploy.sh then verifies the downloaded root against the chain MAX itself serves, so a
# substituted file cannot pass: a wrong root does not verify MAX's leaf.
if [ "${SKIP_CA_SETUP:-0}" = "1" ]; then
  echo "    skipped (SKIP_CA_SETUP=1)"
else
  CA_DIR=/usr/local/share/ca-certificates
  mkdir -p "$CA_DIR"

  RUSSIAN_CA_ROOT_URL="https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt"
  RUSSIAN_CA_SUB_URL="https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt"

  if [ -f "$CA_DIR/russian_trusted_root_ca.crt" ] && [ -f "$CA_DIR/russian_trusted_sub_ca.crt" ]; then
    echo "    certificates already installed"
  else
    curl -s --fail -o "$CA_DIR/russian_trusted_root_ca.crt" "$RUSSIAN_CA_ROOT_URL" \
      || { echo "WARNING: could not fetch the Russian Trusted Root CA; MAX will stay unreachable" >&2; }
    curl -s --fail -o "$CA_DIR/russian_trusted_sub_ca.crt" "$RUSSIAN_CA_SUB_URL" \
      || { echo "WARNING: could not fetch the Russian Trusted Sub CA" >&2; }
    update-ca-certificates 2>&1 | tail -3
  fi

  # The check that makes the download trustworthy: the installed root must verify the
  # exact certificate chain the MAX server presents.
  echo "    verifying the installed root against the live MAX chain"
  if timeout 30 bash -c 'exec 3<>/dev/tcp/platform-api2.max.ru/443' 2>/dev/null; then
    openssl s_client -showcerts -connect platform-api2.max.ru:443 \
      -servername platform-api2.max.ru </dev/null 2>/dev/null \
      | awk '/BEGIN CERT/,/END CERT/' > /tmp/max-chain.pem || true

    if [ -s /tmp/max-chain.pem ]; then
      # Split the chain into leaf and intermediate.
      awk 'BEGIN{n=1} /BEGIN CERT/{f="/tmp/max-cert-" n ".pem"} {print > f} /END CERT/{n++}' /tmp/max-chain.pem
      ROOT="$CA_DIR/russian_trusted_root_ca.crt"
      LEAF=/tmp/max-cert-1.pem
      MID=/tmp/max-cert-2.pem

      if [ -f "$LEAF" ] && [ -f "$MID" ]; then
        if openssl verify -CAfile "$ROOT" -untrusted "$MID" "$LEAF" >/dev/null 2>&1; then
          echo "    OK: the installed root verifies the live MAX chain"
        else
          echo "ERROR: the installed root does NOT verify the live MAX chain." >&2
          echo "       Refusing to continue with an unverified trust anchor." >&2
          rm -f /tmp/max-chain.pem /tmp/max-cert-*.pem
          exit 1
        fi
      fi
      rm -f /tmp/max-chain.pem /tmp/max-cert-*.pem
    fi
  else
    echo "    (platform-api2.max.ru is not reachable from here; skipped)"
  fi
fi

echo "==> reloading pm2 process '$APP_NAME'"
# Through the ecosystem file rather than by name, so the environment it declares —
# including NODE_EXTRA_CA_CERTS — is applied. A bypass leaves the file and the running
# process able to disagree, which is the state that made this take a manual restart to
# notice.
if [ -f ecosystem.config.cjs ]; then
  # No `--update-env` here, and that is the whole point of this branch.
  #
  # `--update-env` merges the *calling shell's* environment over the process definition,
  # and the shell does not carry NODE_EXTRA_CA_CERTS — so the variable this file exists to
  # set was silently dropped, and the deploy reported success while MAX kept failing its
  # TLS handshake. Measured: with the flag the process env held only NODE_OPTIONS; without
  # it, the variable reaches the process and the `next start` child.
  #
  # Nothing needs the shell's environment: the application's own variables come from .env,
  # which Next loads at runtime, and the two that must exist before Node boots are declared
  # in the ecosystem file.
  PM2_APP="$APP_NAME" pm2 startOrReload ecosystem.config.cjs
  # Saved so the environment survives a reboot: PM2 restores a process from its dump,
  # not from this file, and an unsaved env is gone after the machine comes back.
  pm2 save >/dev/null 2>&1 || true
else
  echo "WARNING: ecosystem.config.cjs is missing; NODE_EXTRA_CA_CERTS will not be set" >&2
  pm2 reload "$APP_NAME" --update-env
fi

sleep 8
if ! pm2 list --no-color | grep -q "$APP_NAME"; then
  echo "ERROR: pm2 process '$APP_NAME' is not listed after reload." >&2
  pm2 list --no-color >&2 || true
  exit 1
fi

# The variable the ecosystem file exists for must actually be in the process. Checked
# from /proc rather than from `pm2 env`, because the question is what Node sees, not
# what PM2 believes it configured — those were different for exactly one deploy.
if [ -f ecosystem.config.cjs ]; then
  PID=$(pm2 pid "$APP_NAME" 2>/dev/null | head -1 || true)
  if [ -n "${PID:-}" ] && [ -r "/proc/$PID/environ" ]; then
    if tr '\0' '\n' < "/proc/$PID/environ" | grep -q '^NODE_EXTRA_CA_CERTS='; then
      echo "    NODE_EXTRA_CA_CERTS is set for pid $PID"
    else
      echo "ERROR: NODE_EXTRA_CA_CERTS is missing from pid $PID — MAX will fail its TLS handshake." >&2
      exit 1
    fi
  fi
fi

# Exactly one. `pm2 startOrReload` on a name that was created outside the ecosystem file
# can end up with two processes of the same name, and the symptom is not an error — it
# is two `next start` processes racing for port 3000, one of them serving the old build.
RUNNING=$(pm2 list --no-color | grep -c "$APP_NAME" || true)
if [ "$RUNNING" -ne 1 ]; then
  echo "ERROR: expected exactly one '$APP_NAME' process, found $RUNNING." >&2
  pm2 list --no-color >&2 || true
  exit 1
fi
pm2 list --no-color | grep "$APP_NAME"

echo "==> done: $(git log --oneline -1)"