/**
 * PM2 process definition.
 *
 * This file exists for one variable. `NODE_EXTRA_CA_CERTS` is read by Node while it
 * bootstraps, long before the application runs, so it cannot come from `.env` — by the
 * time Next loads that file the TLS trust store is already fixed for the life of the
 * process.
 *
 * It is needed because MAX's API is served with a certificate issued by the Russian
 * Trusted CA of the Ministry of Digital Development, which is in neither Node's bundled
 * trust store nor Ubuntu's `ca-certificates`. Measured on the production host before
 * this was added: every call to platform-api2.max.ru failed with
 * `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, before a request was sent.
 *
 * The trust anchor was not taken on faith. The certificate published at
 * gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt was downloaded without
 * `-k` and verified against the chain the MAX server itself presents:
 *
 *   openssl verify -CAfile root.pem -untrusted <intermediate from MAX> <leaf from MAX>
 *   -> OK
 *
 * A wrong or substituted root cannot satisfy that check. The file is installed into
 * /usr/local/share/ca-certificates by deploy.sh and folded into the system bundle by
 * update-ca-certificates; this variable points Node at that bundle.
 *
 * `env` is deliberately minimal: without an ecosystem file PM2 captured only
 * NODE_OPTIONS, and adding variables here must not silently drop the ones that were
 * already in effect (see the NODE_OPTIONS value, which is the app's memory ceiling and
 * is not a default worth changing by accident).
 */

const APP_NAME = process.env.PM2_APP || "uartnews";

module.exports = {
  apps: [
    {
      name: APP_NAME,
      cwd: "/var/www/uartnews",
      // The absolute path, not "npm": this is the exact command the running process was
      // created with, and PM2 resolves a bare "npm" through its own logic rather than
      // the shell's PATH.
      script: "/usr/bin/npm",
      args: "start",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        // The memory ceiling the process already ran under; PM2 had it in its dump.
        NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=384",
        // The system bundle after update-ca-certificates, which includes the
        // Russian Trusted CA alongside the distribution's own authorities.
        NODE_EXTRA_CA_CERTS: "/etc/ssl/certs/ca-certificates.crt",
      },
    },
  ],
};
