# Publishing Packages

This repo publishes scoped npm packages under the `@chittyos` scope to GitHub Packages.

Scope and names:

- `@chittyos/engine`
- `@chittyos/verifier`

Registry: `https://npm.pkg.github.com` (GitHub Packages). The package scope must match the org `chittyos`.

## Setup

1. Copy `.npmrc.example` to `.npmrc` and set `GITHUB_TOKEN` with `packages:write` and `read:packages` (or use Actions `GITHUB_TOKEN`).
2. Ensure `package.json` names remain scoped as `@chittyos/*`.

## Publish (local)

```bash
pnpm install
pnpm -r build
pnpm -r publish --no-git-checks --registry=https://npm.pkg.github.com
```

## Install (consumers)

Add to `.npmrc`:

```
@chittyos:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then:

```bash
pnpm add @chittyos/engine @chittyos/verifier
```

## CI Publish

Use a GitHub Actions workflow to publish on tag push; Actions `GITHUB_TOKEN` is sufficient for the same repo.

