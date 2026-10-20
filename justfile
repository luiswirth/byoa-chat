# Everything CI runs.
ci:
    nix fmt -- --ci
    pnpm install --frozen-lockfile
    biome check
    pnpm types
    pnpm exec tsc -p .
    pnpm exec tsc -p worker
    pnpm build
