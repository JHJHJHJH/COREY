# COREY

Browser-based IFC viewer built with `Next.js`, `@thatopen/components`, and `@thatopen/components-front`.

## Features

- Local IFC upload with no backend dependency
- That Open-powered 3D viewport
- Selection and property inspection
- Spatial tree navigation
- Hide, isolate, and show-all visibility controls
- Section plane placement
- Length measurement placement
- In-viewport IFC debug panel for inspecting parsed sample data

## IFC Debug Panel

The viewer includes a small debug panel in the viewport with four sample payloads:

- `Raw IFC`: sanitized output from `model.getItemsData(...)` for either the selected element or the first indexed sample element. This is the closest view to the parsed IFC item shape used by the app.
- `Selection`: the normalized `ViewerSelectionDetails` payload used by the properties panel. It is built from the raw item through `buildSelectionInspection(...)`.
- `Row`: the normalized `ViewerDataTableRow` payload from the indexed element table built by `buildViewerDataTable(...)`.
- `Tree`: a trimmed sample of the `ViewerTreeNode[]` structure produced by `buildViewerTree(...)` from the model spatial structure.

All debug payloads are passed through a sanitizer before display so circular references, deep nesting, and very large arrays remain readable in the UI.

## Development

Install dependencies and start the app:

```bash
pnpm install
pnpm dev
```

Open `http://localhost:4000`.

## Docker

Build and run the app with Postgres and MinIO:

```bash
docker compose up --build
```

Open `http://localhost:4000`.

The compose stack runs database migrations before starting the app. Container
environment values are wired to the internal compose services, while
`.env.example` remains the template for local non-Docker development.

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
