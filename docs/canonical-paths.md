# Canonical Path Mapping

This repository’s authoritative source lives at:

- https://github.com/chittyos/chittysync

Across the Chitty portfolio, the vanity/canonical path is used for references:

- git.chitty.cc/chittysync

The canonical path is an identifier used in docs, service discovery, and ops runbooks. It resolves to the GitHub-hosted repo and associated packages/services.

Package installs should reference the published registry or GitHub source. For Git installs:

- Engine: `pnpm add github:chittyos/chittysync#packages/engine`
- Verifier: `pnpm add github:chittyos/chittysync#packages/verifier`

