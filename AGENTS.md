<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project Context

This repo is a browser-based IFC review app built with:

- `Next.js 16` with the App Router
- `React 19`
- `Tailwind CSS 4`
- `@thatopen/components`
- `@thatopen/components-front`
- `@thatopen/fragments`
- `three`
- `web-ifc`

The current product target is a local-first IFC viewer with no backend. Users load IFC files from disk and review them entirely in the browser.

# Current Scope

The implemented v1 supports:

- Local IFC upload
- 3D model rendering with That Open
- Selection and properties inspection
- Spatial/model tree browsing
- Hide, isolate, and show-all visibility flows
- Section plane placement and clearing
- Length measurement placement and clearing

The app is intentionally "backend ready" but not backend connected. File loading and viewer session concepts are abstracted so API-backed model sources can be added later.

# Key Files

- `src/app/page.tsx`: app entry, renders the viewer shell
- `src/features/viewer/components/viewer-shell.tsx`: top-level app shell and state orchestration
- `src/features/viewer/components/ifc-viewport.tsx`: That Open runtime setup, IFC loading, tool integration, and imperative viewport actions
- `src/features/viewer/components/model-tree-panel.tsx`: tree panel and category actions
- `src/features/viewer/components/properties-panel.tsx`: selection details and property rendering
- `src/features/viewer/components/viewer-toolbar.tsx`: viewport toolbar/actions
- `src/features/viewer/types.ts`: public viewer-facing types and interfaces
- `src/features/viewer/lib/model-source.ts`: model source abstraction, currently local file only
- `src/features/viewer/lib/ifc-data.ts`: tree, selection, category, and formatting helpers

# Runtime Asset Notes

The viewer depends on copied runtime assets in `public/`:

- `public/workers/thatopen-fragments-worker.mjs`
- `public/wasm/web-ifc.wasm`
- `public/wasm/web-ifc-mt.wasm`

These are copied from `node_modules` and must stay aligned with the installed versions of `@thatopen/fragments` and `web-ifc`. If those packages are upgraded, refresh the copied files too.

# Architecture Notes

- Keep That Open and WebGL code client-only. Do not move viewer runtime code into server components.
- Treat `IfcViewport` as the boundary around That Open lifecycle, worker setup, wasm setup, and imperative tool operations.
- Keep ordinary React state in `ViewerShell` and push engine-specific state transitions up through callbacks instead of leaking That Open internals across the UI.
- Preserve the `ModelSource` abstraction for future non-local file sources.
- Preserve the current single-model assumption unless a task explicitly expands scope to multi-model workflows.
- Keep the UI practical and dense rather than marketing/demo oriented.

# Planning Guidance

When planning or implementing new work in this repo:

- Start from the existing viewer architecture, not from a blank Next.js app.
- Decide whether a change belongs in:
  - shell/UI state
  - viewport/runtime integration
  - shared viewer types/interfaces
  - helper/data transformation code
- Prefer extending typed interfaces in `src/features/viewer/types.ts` before adding ad hoc props/state.
- If a feature might later need persistence or remote model sources, add an interface boundary now rather than coupling it directly to local file behavior.
- If adding new That Open tools, keep activation and cleanup centralized in `IfcViewport`.
- If adding new user-facing panels, keep them as regular React components and pass only the data/actions they need.

# Verification

Use these checks after changes:

```bash
pnpm lint
pnpm build
```

`pnpm build` uses `next build --webpack`. Keep that unless there is a deliberate decision to re-enable Turbopack builds after confirming they work in the target environment.
