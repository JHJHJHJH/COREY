# COREY

COREY is a browser-based IFC review app. It can run local-first with user-selected
IFC files, and it also ships a supported self-hosted backend for model storage,
rule templates, validation reports, data-table drafts, Excel import/export, and
server-backed IFC writeback.

The app is built with Next.js 16, React 19, Tailwind CSS 4, That Open, Three.js,
web-ifc, Prisma, Postgres, and S3-compatible object storage.

## Features

- Local IFC upload and review in the browser
- That Open-powered 3D viewport
- Selection, properties, and spatial tree inspection
- Hide, isolate, show-all, section plane, and measurement tools
- Data-table review with Excel import/export
- Rule-based validation and diagnosis reports
- Optional self-hosted backend with Postgres and S3-compatible storage

## Quick Start

Install dependencies and start the local app:

```bash
pnpm install
pnpm dev
```

Open `http://localhost:4000` and choose an IFC file from disk.

## Docker Development

Use the development Compose file when you want the app, Postgres, and MinIO to
run in Docker while editing source files on the host:

```bash
cp .env.example .env
docker compose --env-file .env -f docker/docker-compose.dev.yml up --build
```

Open `http://localhost:4000`.

The dev container bind-mounts the repository and keeps `node_modules`, `.next`,
generated Prisma files, and the pnpm store in Docker volumes. It intentionally
runs `next dev --webpack` with polling enabled because Next.js 16 uses
Turbopack by default, and Turbopack can miss hot reload invalidation on
Docker-mounted filesystems.

If you change the Compose file or the dev server command, recreate the app
service:

```bash
docker compose --env-file .env -f docker/docker-compose.dev.yml up -d --force-recreate app
```

## Documentation

The repo docs are built with Fumadocs and served from the app at
`http://localhost:4000/docs`.

Public docs content lives in `content/docs`. After editing docs, run:

```bash
pnpm docs:generate
pnpm build
```

## Self-Hosted Backend

The Docker Compose stack starts the app, Postgres, MinIO, and one-shot database
migrations:

```bash
cp .env.example .env
docker compose --env-file .env -f docker/docker-compose.yml up --build
```

Open `http://localhost:4000`.

The backend is intended for single-tenant/self-hosted deployments. Put a reverse
proxy in front of it for public networks, and configure payload limits, TLS,
authentication, and rate limits there.

### Run Without MinIO

Use the no-MinIO Compose file when you only need the local-first viewer plus
Postgres-backed routes, or when object storage is provided separately:

```bash
docker compose --env-file .env -f docker/docker-compose.no-minio.yml up --build
```

This stack starts the app, Postgres, and migrations only. It sets placeholder S3
values so the app and health check can start, but server-backed model
upload/download still requires real S3-compatible storage. To avoid a local port
conflict, set `APP_PORT` for the host binding:

```bash
APP_PORT=4010 docker compose --env-file .env -f docker/docker-compose.no-minio.yml up --build
```

## Container Images

Release images are published to GitHub Container Registry:

```bash
docker pull ghcr.io/jhjhjhjh/bca-ifc:latest
```

For source builds, continue to use:

```bash
docker compose --env-file .env -f docker/docker-compose.yml up --build
```

## Configuration

Copy `.env.example` to `.env` for local development. Required backend variables:

- `DATABASE_URL`
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `S3_BUCKET`
- `COREY_MAX_MODEL_BYTES`

## Runtime Assets

The viewer serves these copied runtime assets from `public/`:

- `public/workers/thatopen-fragments-worker.mjs`
- `public/wasm/web-ifc.wasm`
- `public/wasm/web-ifc-mt.wasm`

If `@thatopen/fragments` or `web-ifc` changes, refresh the copied files from
`node_modules` and run:

```bash
pnpm check:assets
```

## Sample Assets

COREY does not ship a public sample IFC by default. Commit IFC samples only when
their redistribution rights are explicit and documented in
`public/resources/README.md`.

## Verification

```bash
pnpm lint
pnpm check:assets
pnpm build
pnpm audit --prod
```

`pnpm build` generates Fumadocs sources, then intentionally uses
`next build --webpack`.

## License

MIT. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.
