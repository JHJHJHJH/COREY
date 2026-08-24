# API Reference

The API reference is intended for self-hosted COREY deployments.

## Health

- `GET /api/health`: returns app status, configured upload limit, and whether
  S3-backed model storage is available.

## Models

- `GET /api/models`: list stored models. Each model reports `versionCount`,
  `latestVersion`, and the latest version's change summary.
- `POST /api/models`: upload IFC bytes. Use `x-model-name` for the display name.
- `GET /api/models/[id]`: read model metadata.
- `GET /api/models/[id]/file`: download model bytes (always the latest version).
- `POST /api/models/[id]/writeback`: export edited IFC bytes for a server model.
  The JSON body takes `data` (the edited table), plus optional `fileName`,
  `saveAsVersion`, and `label`. With `saveAsVersion: true` the edited bytes are
  stored as a new version server-side and the version summary is returned as
  JSON; otherwise the bytes come back as a file download.

Model routes return `503` when S3-compatible storage is not configured.

## Versions

Every server model has a numbered version history starting at 1. Uploading a
version computes a change summary (added / removed / changed element counts)
against the previous version.

- `GET /api/models/[id]/versions`: list versions, each with `versionNumber`,
  `size`, `label`, `changeSummary`, and `uploadedAt`.
- `POST /api/models/[id]/versions`: upload IFC bytes as a new version. Use
  `x-version-label` for an optional label. Returns the version summary with
  status `201`.
- `DELETE /api/models/[id]/versions`: delete versions. JSON body:
  `{ "versionNumbers": [1, 2] }`. A model must keep at least one version;
  a request that would delete them all returns `400`.
- `GET /api/models/[id]/versions/[version]/file`: download the bytes of one
  version.

## Compare

- `POST /api/models/[id]/compare`: diff two versions of a model. JSON body:
  `{ "baseVersion": 1, "targetVersion": 2, "clauses": [] }` where `clauses`
  (optional) are version 4 validation clauses to re-evaluate against both
  versions. Returns added / removed / changed elements with per-field property
  diffs, a summary, and a validation diff when clauses were supplied. The two
  version numbers must differ.

## Drafts

- `GET /api/models/[id]/draft`
- `PUT /api/models/[id]/draft`
- `DELETE /api/models/[id]/draft`

## Rules And Compute

- `GET /api/rules/config`: read the current user's validation config.
- `PUT /api/rules/config`: save a validation config.
- `POST /api/rules/evaluate`: evaluate validation rows against a config.
- `GET /api/rule-templates`: list available validation templates.
- `GET /api/rule-templates/[id]`: read one validation template.
- `GET /api/rule-templates/[id]?format=config`: download a template config.
- `GET /api/rule-templates/[id]?format=source`: download a template source file when available.
- `POST /api/data-table/excel/export`
- `POST /api/data-table/excel/import`

Rules config and template config use the version 4 clause model documented in
[Clause data model](clause-data-model.md).
