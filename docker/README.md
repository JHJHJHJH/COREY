# Docker Image Updates

Run these commands from the repository root.

## Deploy Stack

Use `docker-compose.deploy.yml` when you want the app, migrations, Postgres, and
MinIO:

```bash
docker compose --env-file .env -f docker/docker-compose.deploy.yml build --pull
```

This refreshes the locally built images used by the deploy stack:

```text
corey-app:latest
corey-mcp:latest
corey-migrate:latest
```

Start or recreate the stack after rebuilding:

```bash
docker compose --env-file .env -f docker/docker-compose.deploy.yml up -d --force-recreate
```

## Release Stack

Use `docker-compose.release.yml` when you want the release image with bundled
docs plus Postgres and migrations:

```bash
docker compose --env-file .env -f docker/docker-compose.release.yml build --pull
```

This refreshes the locally built images used by the release stack:

```text
corey:release-with-docs
corey-release-migrate:latest
```

Start or recreate the stack after rebuilding:

```bash
docker compose --env-file .env -f docker/docker-compose.release.yml up -d --force-recreate
```

## External Docs Redirect

Set `DOCS_EXTERNAL_URL` to redirect the in-app "Docs" link and the `/docs` route
to externally hosted documentation instead of serving the bundled docs:

```bash
DOCS_EXTERNAL_URL=https://coreyifc.com/docs
```

This is read at request time, so the standard image works with or without it —
set the variable on the deployment (e.g. Railway) and `/docs/<path>` redirects to
`https://coreyifc.com/docs/<path>`. Leave it unset to serve the bundled docs.

## Force a Clean Image Refresh

Use a no-cache build when base images, native dependencies, Prisma engines, or
runtime assets may have drifted and you want to avoid reusing Docker cache:

```bash
docker compose --env-file .env -f docker/docker-compose.deploy.yml build --pull --no-cache
docker compose --env-file .env -f docker/docker-compose.release.yml build --pull --no-cache
```

## Verify Images

List the local COREY images:

```bash
docker image ls --format 'table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}\t{{.CreatedSince}}' | rg '^(corey|REPOSITORY)'
```

Before publishing or cutting a release, also run the project checks:

```bash
pnpm lint
pnpm build
```

GitHub Actions publishes matching app and MCP images from version tags:

```text
ghcr.io/jhjhjhjh/corey:<version>
ghcr.io/jhjhjhjh/corey-mcp:<version>
```

Deploy the same immutable version for both services. Prefer the release process
in `docs/releasing.md` instead of manually pushing local images unless a manual
registry update is explicitly required.
