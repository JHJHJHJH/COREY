# Contributing

Thanks for working on COREY. Keep changes scoped and verify them before opening
a pull request.

## Development

```bash
pnpm install
pnpm dev
```

The app runs at `http://localhost:4000`.

## Checks

Run these before submitting changes:

```bash
pnpm lint
pnpm check:assets
pnpm build
```

For dependency changes, also run:

```bash
pnpm audit --prod
```

## Runtime Assets

The files under `public/workers` and `public/wasm` are copied from installed
dependencies. When upgrading `@thatopen/fragments` or `web-ifc`, refresh them
from `node_modules` and run `pnpm check:assets`.

## Public Assets

Do not commit IFC models, rule catalogs, or mapping files unless their
redistribution rights are explicit. Document the source and license in
`public/resources/README.md`.
