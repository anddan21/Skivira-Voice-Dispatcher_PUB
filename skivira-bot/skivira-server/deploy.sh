#!/usr/bin/env bash
set -euo pipefail

cd /var/www/skivira/skivira-server

# Install dependencies strictly according to package-lock
if npm ci --omit=dev; then
  echo "npm ci --omit=dev OK"
else
  echo "npm ci --omit=dev is not supported by this version of npm, trying --only=production"
  npm ci --only=production
fi

# Restart application and load .env
pm2 restart skivira-app --update-env
echo "Done."
