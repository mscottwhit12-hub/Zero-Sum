#!/bin/sh
# Make the mounted folders writable for the unprivileged 'node' user, then drop root.
set -e
mkdir -p "${DATA_DIR:-/data}" "${MEDIA_DIR:-/media}"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "${DATA_DIR:-/data}" "${MEDIA_DIR:-/media}"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
