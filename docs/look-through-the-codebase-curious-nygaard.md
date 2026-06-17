# Refactor IFC Viewer Features to an API

## Context

The app (`COREY`) is a local-first, backend-ready IFC reviewer. AGENTS.md states it is
"intentionally 'backend ready' but not backend connected," with `ModelSource` and
`sourceId` left as seams for a future server. In practice the codebase has already grown
several features whose state and compute belong on a server in a multi-user / persistent
deployment, but which today live in the browser:

- **Persistence:** validation rules and data-table edits are stored only in `localStorage`,
  so they don't survive a cache clear, aren't shareable, and aren't keyed to a stable model
  identity.
- **Remote sources:** models can only be loaded from local disk; the `ModelSource` interface
  is hardcoded to `kind: "local-file"`.
- **Shared catalogs:** rule templates are static assets under `public/resources`,
  not a server-managed library.
- **Compute:** IFC→Fragments conversion, data-table indexing, validation, and IFC writeback
  all run client-side.

The goal of this plan: (1) a prioritized **inventory** of every feature that should move
behind an API, and (2) a detailed, executable plan for the **first refactor** — server model
storage + a `RemoteModelSource` — because it establishes the stable server-side model
identity (`sourceId`) and the client↔API boundary pattern that every later refactor depends on.

Notably, one API seam already exists: `POST /api/rules/evaluate`
(`src/app/api/rules/evaluate/route.ts`), and the validation evaluator
(`src/features/rules/lib/validation.ts`) is already isomorphic — imported by both the web
worker (`src/features/rules/workers/validation-worker.ts`) and the route. This is the pattern
to follow.

## Inventory of API-candidate features

Ordered by recommended sequence. Each names the current client seam to replace.

| # | Feature | Driver | Current state / seam | Target |
|---|---------|--------|----------------------|--------|
| 1 | **Model storage + remote loading** | Remote sources | `LocalFileModelSource` only (`lib/model-source.ts`); `ModelSource.kind: "local-file"` (`types.ts:179`); ephemeral `sourceId = name:size:lastModified` | Upload/list/fetch IFC via `/api/models`; `RemoteModelSource`; stable server `modelId` as `sourceId` |
| 2 | **Validation rules config** | Persistence/multi-user | `localStorage["corey.validation-rules.v1"]` via `rules-provider.tsx` (read/write isolated in `readStoredConfig`/`writeStoredConfig`) | Server-backed rule sets; localStorage becomes offline cache |
| 3 | **Data-table edits (drafts)** | Persistence/multi-user | `localStorage["corey:data-table-draft:…"]` via `lib/data-table-draft.ts` (`read/write/clearPersistedViewerDataTableDraft`), keyed by `sourceId` | Server-backed drafts keyed by `modelId`; localStorage cache |
| 4 | **Validation reports** | Persistence | Ephemeral React state (`validationResult` in `viewer-shell.tsx`); export only to Excel | Persist `ViewerValidationDiagnosisReport` per model run; list/restore |
| 5 | **Rule templates** | Shared catalogs | Static `public/resources/*.json`, fetched in `rules-screen.tsx` (`STARTER_TEMPLATES`) | Server-managed `/api/rule-templates` library |
| 6 | **Validation evaluation** | Compute offload | Already isomorphic; API route exists as worker *fallback* | (Largely done) make API path first-class for large models |
| 7 | **IFC→Fragments conversion, data-table indexing, writeback, Excel** | Compute offload | All client-side (`ifc-viewport.tsx` import pipeline, `ifc-data.ts` `buildViewerDataTable`, `ifc-writeback.ts`, `data-table-excel.ts`) | Optional server jobs; **last** — tightly coupled to That Open client runtime |

**Correctly ephemeral — leave client-side:** tool selection, current selection, measurements,
sections, hidden-items, tree expand/collapse, graph collapse state, drawer widths. The
relationship graph (`element-relationship-graph.tsx`, `graph-compounds.ts`) is pure
client-side transformation of IFC-derived data and needs no API.

## First refactor (detailed): Server model storage + `RemoteModelSource`

**Why first:** Items 2–5 all key persistence off `sourceId`. Today that id is
`name:size:lastModified` — not stable across users or devices, so server persistence is
meaningless until a canonical model identity exists. `ModelSource` is also already the
cleanest boundary in the repo, and agent exploration confirmed the entire viewport/data
pipeline is source-agnostic after `ModelSourceResult` is produced — so this change is
contained to the source layer + shell entry points.

### Server side (new)

- `src/server/model-store.ts` — a `ModelStore` interface (`save`, `list`, `getMetadata`,
  `getBytes`) with a filesystem-backed implementation writing to a local data dir. Interface
  boundary so S3/db can swap in later (mirrors the `ModelSource` philosophy).
- New routes under `src/app/api/models/`:
  - `POST /api/models/route.ts` — accept IFC bytes (multipart or octet-stream), persist,
    return `{ modelId, name, size }`.
  - `GET /api/models/route.ts` — list catalog `[{ modelId, name, size, uploadedAt }]`.
  - `GET /api/models/[id]/route.ts` — metadata.
  - `GET /api/models/[id]/file/route.ts` — stream IFC bytes.

### Types (`src/features/viewer/types.ts`)

- Widen `ModelSource.kind` to `"local-file" | "remote"`.
- Generalize the read input so both sources satisfy one interface, e.g.
  `read(input: ModelSourceInput)` where
  `ModelSourceInput = { kind: "file"; file: File } | { kind: "remote"; modelId: string }`.
  Add the `ModelSourceInput` union next to `ModelSource`.
- Keep `ModelSourceResult` / `ModelMetadata` unchanged; for remote models set
  `metadata.sourceId = modelId` (the stable identity downstream features will use).

### Client source layer

- Update `LocalFileModelSource.read` (`lib/model-source.ts`) to take the `{ kind: "file" }`
  input shape (trivial change; logic identical).
- Add `RemoteModelSource` in `lib/model-source.ts`: `read({ modelId })` fetches
  `GET /api/models/{id}/file`, returns bytes + metadata with `sourceId = modelId`.
- Optional helper `uploadModel(file): Promise<{ modelId }>` calling `POST /api/models`, used
  by the local-upload flow so locally opened files can be promoted to server-stored.

### Shell wiring (`src/features/viewer/components/viewer-shell.tsx`)

- `loadModelFromFile` already routes file→`ModelSourceResult`→`viewportRef.loadIfc` (around
  `viewer-shell.tsx:1584`). Add a sibling `loadModelById(modelId)` using `RemoteModelSource`,
  mirroring `handleLoadBundledModel` (`:1587`).
- Add a "browse server models" entry point in the header actions (alongside local upload and
  the bundled-model button) that lists `/api/models` and loads by id.
- No changes needed in `ifc-viewport.tsx`, `ifc-data.ts`, panels, or the graph — the pipeline
  is source-agnostic once `ModelSourceResult` exists.

### Out of scope for the first refactor (sequenced next)

Items 2–5 follow once `modelId` is stable: replace the two `localStorage` stores
(`rules-provider.tsx`, `data-table-draft.ts`) with async server-backed stores keyed by
`modelId`, keeping localStorage as an offline cache; then persist validation reports; then
move catalogs server-side. Item 7 (heavy compute) is last and may not be worth it given the
That Open client coupling.

## Verification

- `pnpm lint` and `pnpm build` (`next build --webpack`) — must stay green.
- Manual end-to-end (use the `run` skill or `pnpm dev`):
  1. Local upload still loads and renders a model (no regression).
  2. `POST /api/models` with a local redistributable IFC fixture; confirm it appears in
     `GET /api/models`.
  3. Load that model via the new "server models" entry; confirm tree, properties, data table,
     and validation all work identically to local load, and that `metadata.sourceId` equals
     the server `modelId`.
  4. Confirm data-table edits persist under the server `modelId` (sets up item 3).
- Add a focused test for `ModelStore` (filesystem round-trip) following the existing
  `graph-compounds.test.ts` pattern.
