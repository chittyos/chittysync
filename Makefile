SHELL := /bin/bash

.PHONY: setup build test lint dev engine verifier docker

setup:
	@echo "==> Installing dependencies"
	@pnpm install

build:
	@pnpm -r build

engine:
	@pnpm --filter @chitty/engine build

verifier:
	@pnpm --filter @chitty/verifier build

dev:
	@pnpm --filter @chitty/engine dev

lint:
	@echo "(No linters configured)"

test:
	@echo "(No tests configured)"

docker:
	@docker build -t chittysync-engine:1.1 .

publish:
	@echo "Publishing workspace packages to configured registry..."
	@pnpm -r publish --no-git-checks

