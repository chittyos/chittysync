#!/usr/bin/env bash
set -euo pipefail

PKG="${1:-engine}"
ASSET="chittyos-${PKG}.tgz"
URL="https://github.com/chittyos/chittysync/releases/latest/download/${ASSET}"

TMPDIR=$(mktemp -d)
trap 'rm -rf "${TMPDIR}"' EXIT

echo "Downloading ${ASSET} from ${URL} ..."
curl -fsSL "${URL}" -o "${TMPDIR}/${ASSET}"

echo "Installing package from tarball (npm local install)..."
if command -v pnpm >/dev/null 2>&1; then
  pnpm add "${TMPDIR}/${ASSET}"
elif command -v npm >/dev/null 2>&1; then
  npm install "${TMPDIR}/${ASSET}"
else
  echo "Neither pnpm nor npm found. Please install one and rerun." >&2
  exit 1
fi

echo "Done. You can now import @chittyos/${PKG}."

