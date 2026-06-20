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

- `GET /api/rules/config`
- `PUT /api/rules/config`
- `POST /api/rules/evaluate`
- `GET /api/rule-templates`
- `GET /api/rule-templates/[id]`
- `GET /api/rule-templates/[id]?format=config`
- `GET /api/rule-templates/[id]?format=source`
- `POST /api/data-table/excel/export`
- `POST /api/data-table/excel/import`
