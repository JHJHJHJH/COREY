# Release Process

1. Merge the release candidate into `release`, then run verification from that
   exact commit:

   ```bash
   pnpm verify
   ```

   The production audit ignores only `CVE-2026-14257`: ExcelJS currently
   depends on legacy `minimatch` releases whose `brace-expansion` majors have no
   compatible patched backport. Remove the exception when that dependency chain
   adopts `brace-expansion` 5.0.8 or newer.

2. Build and smoke-test Docker:

   ```bash
   docker compose --env-file .env -f docker/docker-compose.deploy.yml build app mcp
   docker compose --env-file .env -f docker/docker-compose.deploy.yml \
     --profile mcp up
   ```

3. Tag with semantic versioning:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

4. GitHub Actions publishes matching GHCR images from the tagged commit:

   ```text
   ghcr.io/jhjhjhjh/corey:0.1.0
   ghcr.io/jhjhjhjh/corey-mcp:0.1.0
   ```

   The workflow also publishes the matching minor, `release`, and `latest`
   tags. Deploy the same immutable version for both services.

5. Verify the published manifests:

   ```bash
   docker buildx imagetools inspect ghcr.io/jhjhjhjh/corey:0.1.0
   docker buildx imagetools inspect ghcr.io/jhjhjhjh/corey-mcp:0.1.0
   ```

   After the first MCP publication, set the `corey-mcp` package visibility to
   **Public** in GitHub Packages so Railway can pull it without registry
   credentials.

6. Include release notes covering:

   - migration notes
   - dependency/security changes
   - runtime asset updates
   - known limitations
