# Everything CI runs.
ci:
    nix fmt -- --ci
    pnpm install --frozen-lockfile
    biome check
    pnpm exec tsc -p .
    pnpm build

# Builds the page and serves it at chat.agentic.lwirth.com.
deploy: ci
    pnpm exec wrangler deploy --domain chat.agentic.lwirth.com
