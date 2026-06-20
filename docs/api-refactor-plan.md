# API Refactor Plan

Status of moving COREY's local-first features behind a server API. The app was
"backend ready but not connected"; this tracks the sequenced migration.

Infrastructure (local dev): see `docker/docker-compose.yml` — Postgres (Prisma) for
relational data and MinIO (S3) for model bytes. Copy `.env.example` → `.env`,
run `docker compose --env-file .env -f docker/docker-compose.yml up -d postgres minio minio-init`,
then `pnpm db:deploy` and `pnpm dev`. For the full containerized app, run
`docker compose --env-file .env -f docker/docker-compose.yml up --build`.

## Context

The local-first app stored several things in the browser that belong on a server
in a multi-user / persistent deployment:

- **Persistence:** validation rules and data-table edits lived only in `localStorage`
  — not durable, not shareable, not keyed to a stable model identity.
- **Remote sources:** models loaded only from local disk; `ModelSource` was hardcoded
  to `kind: "local-file"`.
- **Shared catalogs:** rule templates are static assets under `public/resources`.
- **Compute:** IFC→Fragments conversion, data-table indexing, validation, and IFC
  writeback run client-side.

The pattern to follow already existed: `POST /api/rules/evaluate`
(`src/app/api/rules/evaluate/route.ts`) with an isomorphic evaluator
(`src/features/rules/lib/validation.ts`) shared by the web worker and the route.

## Inventory of API-candidate features

| # | Feature | Driver | Status |
|---|---------|--------|--------|
| 1 | **Model storage + remote loading** | Remote sources | ✅ Done — bytes in MinIO, metadata in Postgres |
| 2 | **Validation rules config** | Persistence / multi-user | ✅ Done — Postgres-backed, localStorage cache |
| 3 | **Data-table edits (drafts)** | Persistence / multi-user | ✅ Done — Postgres-backed, localStorage cache |
| 4 | **Saved validation runs** | Persistence | Removed from current scope — validation results stay session-local |
| 5 | **Rule templates + industry mapping** | Shared catalogs | ✅ Done — Postgres-backed `/api/rule-templates` catalog |
| 6 | **Validation evaluation** | Compute offload | ✅ Done — API-first for server-backed and large validation runs |
| 7 | **IFC→Fragments / indexing / writeback / Excel** | Compute offload | ✅ Done — server jobs for Excel + server-model IFC writeback; Fragments/indexing remain client-bound |

**Correctly ephemeral — stays client-side:** tool selection, current selection,
measurements, sections, hidden-items, tree expand/collapse, drawer widths.

## Item 1 — Model storage + `RemoteModelSource` (done)

**Why first:** items 2–5 key persistence off `sourceId`. The old id was
`name:size:lastModified` (not stable across users/devices), so a canonical server
model identity had to exist first. The viewport/data pipeline is source-agnostic
once a `ModelSourceResult` is produced, so the change stayed in the source layer +
shell entry points.

- **Server:** `src/server/model-store.ts` (`ModelStore` interface) stores bytes in
  MinIO (`src/server/s3.ts`) and metadata in Postgres (`ModelRecord` via
  `src/server/db.ts`), with object rollback if the DB write fails.
- **Routes:** `src/app/api/models/` — `POST` (upload), `GET` (list),
  `GET /[id]` (metadata), `GET /[id]/file` (bytes).
- **Types:** `ModelSource.kind` widened to `"local-file" | "remote"`; new
  `ModelSourceInput` union; remote loads set `metadata.sourceId = modelId`.
- **Client:** `RemoteModelSource` + `lib/model-api.ts` (`listServerModels`,
  `uploadModelToServer`); `components/server-models-menu.tsx` header picker.
- **Shell:** `loadModelFromSource` extracted; `loadModelById` + `handleSaveToServer`
  added; "Save to server" + "Server models" actions in the header.

## Item 2 — Validation rules config (done)

- **Server:** `src/server/rules-store.ts` (`RuleConfig` row id `default`, config as
  JSON) + `GET`/`PUT /api/rules/config`, reusing `parseStoredViewerValidationConfig`.
- **Client:** `rules-provider.tsx` — Postgres is the source of truth; localStorage is
  an offline cache read via `useSyncExternalStore`, hydrated from the server on mount,
  with optimistic write-through on every edit.

## Item 3 — Data-table edits (done)

- **Server:** `src/server/data-table-draft-store.ts` stores one `DraftRecord`
  JSON document per `modelId`, validates payloads through the shared
  `parseStoredViewerDataTableDraft` parser, and deletes empty drafts.
- **Routes:** `GET`/`PUT`/`DELETE /api/models/[id]/draft` read, save, and clear
  the draft for a server model.
- **Schema:** `DraftRecord` is keyed by `modelId` with a cascade relation to
  `ModelRecord`, so model deletion will remove its draft.
- **Client:** `data-table-draft-api.ts` wraps the draft API. `ViewerShell`
  paints from localStorage first, hydrates server-backed models from Postgres,
  writes imports/clears through to the server, and keeps local-only IFC files on
  the localStorage path. Saving a local model to the server rekeys any active
  draft to the new server `modelId`.
- **Types:** `ModelMetadata.serverModelId` distinguishes server-backed models
  from local-only `sourceId` values.

## Item 4 — Saved validation runs (removed)

- Validation runs now stay in active viewer state only.
- The removed server persistence surface had stored prior validation runs per
  model; the current product keeps the local-first review loop focused on live
  highlights and data-table clause filtering.

## Item 5 — Rule templates + industry mapping (done)

- **Server:** `src/server/rule-template-store.ts` backs a shared template catalog
  with `RuleTemplateRecord` rows in Postgres. Built-in templates are seeded from
  synthetic starter JSON files under `public/resources`.
- **Routes:** `GET /api/rule-templates` lists available templates;
  `GET /api/rule-templates/[id]` returns one template with its validated config;
  `GET /api/rule-templates/[id]?format=config` downloads the raw rules JSON; and
  `GET /api/rule-templates/[id]?format=source` downloads the source CSV when one
  exists.
- **Client:** the rules screen now loads starter templates through
  `src/features/rules/lib/rule-template-api.ts` instead of fetching
  `public/resources/*.json` directly. Template download actions point at API
  routes.
- **Types:** `ViewerRuleTemplateSummary` and `ViewerRuleTemplateRecord` define the
  catalog payloads shared by the route and client helper.

## Item 6 — Validation evaluation (done)

- **Server:** `POST /api/rules/evaluate` remains the compute endpoint, using the
  shared isomorphic evaluator from `src/features/rules/lib/validation.ts`.
- **Client:** `src/features/rules/lib/validation-api.ts` wraps the evaluation API
  and validates the returned `ViewerValidationRunResult` before the shell commits
  highlights or validation state.
- **Shell:** validation now chooses the API as the primary path for server-backed
  models and for large local payloads (1,000+ validation rows). Smaller local runs
  still use the browser worker first to preserve the responsive local-first flow.
- **Fallbacks:** worker-first runs still fall back to the API if worker startup or
  execution fails; API-first runs fall back to the worker if the request fails.
  This keeps validation usable in both backend-connected and local browser paths.

## Item 7 — IFC→Fragments / indexing / writeback / Excel (done)

- **Server jobs:** Excel workbook generation/parsing and server-backed IFC
  writeback now have API routes:
  - `POST /api/data-table/excel/export`
  - `POST /api/data-table/excel/import`
  - `POST /api/models/[id]/writeback`
- **Shared compute cores:** `src/features/viewer/lib/data-table-excel-core.ts`
  contains server-safe ExcelJS workbook builders/parsers, and
  `src/features/viewer/lib/ifc-writeback-core.ts` contains server-safe `web-ifc`
  writeback logic. Existing browser utilities remain available for local-only
  files and fallback paths.
- **Client:** server-backed models use the API path first for Excel import/export
  and edited IFC export. Local-only models keep the client path so COREY remains
  usable without the backend. If an API job fails,
  the shell falls back to the existing browser implementation where the local
  source bytes are available.
- **Runtime-bound pieces:** IFC→Fragments conversion and data-table indexing stay
  client-side in `IfcViewport`. They depend on the live That Open Fragments model,
  the fragments worker, camera/world setup, model categories/spatial structure,
  and progressive UI callbacks. Moving them server-side would require a separate
  headless indexing/conversion pipeline rather than a route wrapper around the
  existing runtime.

## Stack notes

- **Prisma 7** (engine-free query compiler) via the `@prisma/adapter-pg` driver
  adapter; client generated to `src/generated/prisma` (gitignored). Schema in
  `prisma/schema.prisma`; migrations in `prisma/migrations/`.
- `next.config.ts` lists `@prisma/client`, `@prisma/adapter-pg`, `pg` in
  `serverExternalPackages`.
- Scripts: `pnpm db:migrate` (dev), `pnpm db:deploy` (apply), `postinstall` runs
  `prisma generate`.
- Local ports are remapped to avoid collisions: Postgres `5433`, MinIO S3 `9002`,
  MinIO console `9003`.

## Verification (items 1–7)

- `pnpm lint` and `pnpm build` (`next build --webpack`) green.
- Model round-trip: `POST /api/models` with a local redistributable IFC fixture →
  served bytes byte-identical, object in MinIO, row in `model_records`.
- Rules round-trip: `GET → PUT → GET /api/rules/config` persists; `rule_configs`
  holds `id=default`.
- Draft round-trip: `PUT → GET → DELETE /api/models/[id]/draft` persists and
  clears a model-keyed draft; localStorage remains an offline cache for the same
  `modelId`.
- Rule-template catalog:
  `GET /api/rule-templates` seeds and lists the built-ins;
  `GET /api/rule-templates/starter-essential-elements?format=config` returns raw
  rules JSON.
- Validation evaluation:
  `POST /api/rules/evaluate` returns a validated run result; server-backed and
  large validation payloads use the API path first, with worker fallback.
- Excel/writeback compute:
  `POST /api/data-table/excel/export` returns a workbook stream;
  `POST /api/data-table/excel/import` parses that workbook back to a draft and
  import summary;
  `POST /api/models/[id]/writeback` returns an edited IFC stream for a server model.
- Still to do manually: click through the rules screen and the server-models menu in
  the browser (the `/verify` or `run` skill).
