#!/usr/bin/env bash
# docker-entrypoint.sh — wait for MongoDB, apply pending migrations, start the app.
#
# Wired into the image via the Dockerfile:
#   ENTRYPOINT ["bash", "docker-entrypoint.sh"]
#   CMD ["node", "server.js"]
# so the final `exec "$@"` runs whatever CMD/command was supplied.
set -euo pipefail

# compose always sets MONGODB_URI; this fallback only covers running the
# image standalone. The app itself requires MONGODB_URI (fail-fast env check).
export MONGODB_URI="${MONGODB_URI:-mongodb://localhost:27017/egyptian_history_rag}"

echo "[entrypoint] Waiting for MongoDB at ${MONGODB_URI} ..."
until node -e '
  const mongoose = require("mongoose");
  mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 2000 })
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
'; do
  echo "[entrypoint] MongoDB not ready — retrying in 2s"
  sleep 2
done

echo "[entrypoint] Running database migrations (npx migrate-mongo up) ..."
npx migrate-mongo up

echo "[entrypoint] Migrations applied. Starting: $*"
exec "$@"
