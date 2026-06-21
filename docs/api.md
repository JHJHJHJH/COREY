# API Reference

The API reference is intended for self-hosted COREY deployments.

## Health

- `GET /api/health`: returns app status and configured upload limit.

## Models

- `GET /api/models`: list stored models.
- `POST /api/models`: upload IFC bytes. Use `x-model-name` for the display name.
- `GET /api/models/[id]`: read model metadata.
- `GET /api/models/[id]/file`: download model bytes.
- `POST /api/models/[id]/writeback`: export edited IFC bytes for a server model.

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

Rules config and template config use the version 2 clause model documented in
[Clause data model](clause-data-model.md).
