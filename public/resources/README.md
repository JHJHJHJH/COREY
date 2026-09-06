# Public Resources

This directory contains only resources that are safe to redistribute with the
public COREY repository.

No sample IFC model is bundled by default. IFC files often contain project,
client, location, or authoring metadata, so public samples must have explicit
redistribution rights before being committed.

The `starter-*.json` validation templates are synthetic examples written for
COREY and are covered by the repository MIT license.

## Industry mapping templates

The eight agency/shared templates listed in
[industry-mapping-manifest.json](./industry-mapping-manifest.json) are derived
from the supplied 4 Dec industry mapping CSV (`industry-mapping-4-dec-csv.csv`).
They are source-derived mappings, separate from the synthetic examples above.
The source CSV is not distributed with COREY. Its filename and SHA-256 remain
in the coverage report for provenance; no publication year or additional source
authority is inferred. Template loading and tests do not require that file.

Each agency config includes the shared “All” clauses. The standalone Shared
Requirements config contains only those shared clauses. They use the version 4
clause format and appear under Industry mapping in the template library. Loading
one replaces the current clause set using the existing template workflow.

**Review before use:** component names do not scope rule applicability. Some
source requirements overlap or conflict on the same IFC entity/subtype. These
checks are deliberately retained for manual review. The
[review notes](../../content/docs/industry-mapping-review.mdx) document skipped records,
missing accepted-value references, broad subtype matching, overlapping clauses,
and the source record(s) behind every generated rule. Each template's review-notes
button opens `/docs/industry-mapping-review` in a new tab. The page is also listed
in the Docs user guides.

To regenerate the JSON configs and catalog manifest in this directory and the
review notes page in `content/docs`, supply
the original CSV separately from outside the repository:

```bash
pnpm templates:generate --source /path/to/mapping.csv
```

Check the bundled configs, coverage report, and generator using synthetic test
inputs without needing the source CSV:

```bash
pnpm templates:check
```

To compare generated artifacts with a separately supplied original, run
`pnpm templates:generate --source /path/to/mapping.csv --check`.

Commit only the generated artifacts. The original public CSV path is excluded
from Git and Docker build contexts. Generation uses the installed ExcelJS
reader and runs offline; the app seeds the generated JSON through its existing
template store without storing or serving the CSV. A running server picks up regenerated
built-ins after restart, and previously deleted template IDs remain deleted.
The existing BCA Column + Beam example remains a separate catalog entry.
