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

## Railway Deployment

`Dockerfile.railway` (repo root) builds the app **without** the bundled fumadocs
docs. The in-app "Docs" link and the `/docs` route are redirected to the
canonical docs site (default `https://coreyifc.com/docs`), which removes the
fumadocs-mdx content compile from the build.

In the Railway service settings:

- **Dockerfile Path:** `Dockerfile.railway`
- **Pre-deploy command:** `npx prisma migrate deploy`
- Railway injects `PORT` automatically; set `DATABASE_URL` and the usual app env
  vars in the service.

To point docs somewhere other than the public site, set a build arg/variable:

```bash
DOCS_EXTERNAL_URL=https://docs.example.com/docs
```

Build locally to verify:

```bash
docker build -f Dockerfile.railway -t corey:railway .
```

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

GitHub Actions publishes GHCR images from version tags. Prefer the release
process in `docs/releasing.md` instead of manually pushing local images unless a
manual registry update is explicitly required.
