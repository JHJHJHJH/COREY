# Backend API

The backend API is intended for self-hosted COREY deployments.

## Health

- `GET /api/health`: returns app status and configured upload limit.

## Models

- `GET /api/models`: list stored models.
- `POST /api/models`: upload IFC bytes. Use `x-model-name` for the display name.
- `GET /api/models/[id]`: read model metadata.
- `GET /api/models/[id]/file`: download model bytes.
- `POST /api/models/[id]/writeback`: export edited IFC bytes for a server model.

## Drafts And Reports

- `GET /api/models/[id]/draft`
- `PUT /api/models/[id]/draft`
- `DELETE /api/models/[id]/draft`
- `GET /api/models/[id]/validation-reports`
- `POST /api/models/[id]/validation-reports`
- `GET /api/models/[id]/validation-reports/[reportId]`
- `DELETE /api/models/[id]/validation-reports/[reportId]`

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
- `POST /api/validation-diagnosis/excel/export`
