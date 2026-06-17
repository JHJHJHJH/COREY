# Architecture

COREY has two supported operating modes.

## Local-First Mode

Users choose an IFC file from disk. The browser reads the file, creates the
That Open runtime inside `IfcViewport`, and keeps review state in React and
browser storage. Model bytes do not leave the browser in this mode.

## Self-Hosted Backend Mode

The backend stores model metadata in Postgres and model bytes in S3-compatible
object storage. Server-backed models use stable model ids for drafts, validation
reports, rule templates, Excel compute, and IFC writeback.

## Main Boundaries

- `ViewerShell`: top-level React state and user workflow orchestration
- `IfcViewport`: That Open, WebGL, workers, WASM, model loading, and tools
- `ModelSource`: local and remote model-loading boundary
- `src/server/*`: Prisma, S3, and backend persistence boundaries
- `src/app/api/*`: supported self-hosted API surface

Keep That Open and WebGL code client-only.
