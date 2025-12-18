# ChittySync v1.1

[![Download Engine](https://img.shields.io/badge/download-engine.tgz-blue?logo=github)](https://github.com/chittyos/chittysync/releases/latest/download/chittyos-engine.tgz)

Authoritative snapshot implementing the ChittySync engine and verifier per canonical directives.

## One-Click Package Download

Download prebuilt tarballs from the latest GitHub Release and install into your project:

- Engine: https://github.com/chittyos/chittysync/releases/latest/download/chittyos-engine.tgz
- Verifier: https://github.com/chittyos/chittysync/releases/latest/download/chittyos-verifier.tgz

Or use the install script (uses pnpm/npm if available):

```bash
curl -fsSL https://raw.githubusercontent.com/chittyos/chittysync/refs/heads/main/scripts/install.sh | bash -s -- engine
curl -fsSL https://raw.githubusercontent.com/chittyos/chittysync/refs/heads/main/scripts/install.sh | bash -s -- verifier
```

## Packages

- `@chittyos/engine` — server runtime
- `@chittyos/verifier` — batch verifier + signer

## Docker

```bash
docker build -t chittysync-engine:1.1 .
docker run --rm -p 3000:3000 \
  -e ENGINE_PUBKEY_HEX=... \
  -e DATABASE_URL=postgres://user:pass@host/db \
  chittysync-engine:1.1
```

## Checkpoint

See `RELEASE_NOTES.md` for the audit-closed v1.1 checkpoint and hash.
