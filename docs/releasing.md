# Release Process

1. Choose the next stable semantic version on the release candidate. Update
   `package.json` without creating a local tag, move the relevant changelog
   entries out of `Unreleased`, and commit both changes:

   ```bash
   pnpm version minor --no-git-tag-version
   # Edit docs/changelog.md, then commit the release preparation.
   ```

   Use `major`, `minor`, or `patch` as appropriate. The version in
   `package.json` is the source of truth for release automation.

2. Run verification from the exact release candidate commit:

   ```bash
   pnpm verify
   ```

   The production audit ignores only `CVE-2026-14257`: ExcelJS currently
   depends on legacy `minimatch` releases whose `brace-expansion` majors have no
   compatible patched backport. Remove the exception when that dependency chain
   adopts `brace-expansion` 5.0.8 or newer.

3. Build and smoke-test Docker:

   ```bash
   docker compose --env-file .env -f docker/docker-compose.deploy.yml build app mcp
   docker compose --env-file .env -f docker/docker-compose.deploy.yml \
     --profile mcp up
   ```

4. Merge the verified release candidate into `release`. The merge runs the
   Release workflow, which reads the version from `package.json`, publishes
   matching GHCR images, then creates the Git tag and GitHub Release. For
   example, version `1.1.0` publishes:

   ```text
   ghcr.io/jhjhjhjh/corey:1.1.0
   ghcr.io/jhjhjhjh/corey-mcp:1.1.0
   ```

   The workflow also publishes the matching minor, `release`, and `latest`
   image tags. Deploy the same immutable version for both services. If the
   version's Git tag already points to another commit, the workflow stops and
   requires another version bump rather than moving the existing tag.

5. Verify the published manifests:

   ```bash
   docker buildx imagetools inspect ghcr.io/jhjhjhjh/corey:1.1.0
   docker buildx imagetools inspect ghcr.io/jhjhjhjh/corey-mcp:1.1.0
   ```

   After the first MCP publication, set the `corey-mcp` package visibility to
   **Public** in GitHub Packages so Railway can pull it without registry
   credentials.

6. Review the generated GitHub release notes and add any missing:

   - migration notes
   - dependency/security changes
   - runtime asset updates
   - known limitations
