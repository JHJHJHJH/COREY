# Release Process

1. Run verification:

   ```bash
   pnpm verify
   ```

2. Build and smoke-test Docker:

   ```bash
   docker compose --env-file .env -f docker/docker-compose.yml build app
   docker compose --env-file .env -f docker/docker-compose.yml up
   ```

3. Tag with semantic versioning:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

4. GitHub Actions publishes GHCR images for version tags.

5. Include release notes covering:

   - migration notes
   - dependency/security changes
   - runtime asset updates
   - known limitations
