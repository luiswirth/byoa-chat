# Everything CI runs.
ci:
    nix fmt -- --ci
    pnpm install --frozen-lockfile
    biome check
    pnpm exec tsc -p .
    pnpm build

# Builds the page and serves it at chat.senses.sh.
deploy: ci
    pnpm exec wrangler deploy --domain chat.senses.sh
