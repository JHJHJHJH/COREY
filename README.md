# BCA IFC Viewer

Browser-based IFC viewer built with `Next.js`, `@thatopen/components`, and `@thatopen/components-front`.

## Features

- Local IFC upload with no backend dependency
- That Open-powered 3D viewport
- Selection and property inspection
- Spatial tree navigation
- Hide, isolate, and show-all visibility controls
- Section plane placement
- Length measurement placement

## Development

Install dependencies and start the app:

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Verification

```bash
pnpm lint
pnpm build
```

## Runtime Assets

The viewer serves These bundled assets from `public/`:

- `public/workers/thatopen-fragments-worker.mjs`
- `public/wasm/web-ifc.wasm`
- `public/wasm/web-ifc-mt.wasm`

If the That Open or `web-ifc` packages are upgraded, refresh those copied files from `node_modules` so the runtime stays in sync with the installed dependency versions.
