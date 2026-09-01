# Changelog

All notable changes to COREY will be documented here.

This project uses semantic versioning once public releases begin.

## Unreleased

- Clause templates can now be saved and deleted, not just loaded. Save the whole
  clause set or a single clause under a name, insert a saved clause alongside the
  ones you already have, and delete any template — the built-in starters
  included. The catalog is shared across the deployment.

## 1.0.0 - 2026-08-29

- First stable COREY release, establishing the local-first IFC review,
  validation, Excel round-trip, optional model history and comparison, and MCP
  workflows as the supported baseline.
- Added a step-by-step guide for connecting a self-hosted COREY MCP server to
  VS Code and GitHub Copilot, including deployment and authentication setup.
- Aligned the clause data model documentation, LLM guidance, legacy schema
  labels, and sample configuration with the current version 4 format.

## 0.3.0 - 2026-08-28

- Relationship graph view: explore an element's IFC relationships as a graph,
  expanding a node at a time, with search, relation-group filters, a legend,
  and per-kind node shapes. Nodes can be focused, collapsed, removed, copied,
  or isolated in the 3D viewport from a context menu.
- Graph labels are placed by collision rather than spacing, the way map
  renderers do it, so node and edge labels never overlap and more of them
  appear the closer the view is zoomed in.
- Relation groups widened from `spatial | definition | material | other` to
  `spatial | type | property | association | connection | other`, with
  association edges labelled from the IFC class of the resource endpoint.
- Validation clause configuration upgraded to version 3: `pattern` checks are
  replaced by `regex` checks, and existing pattern checks are migrated on load.
- Configurable validation severity levels, with user-defined id, label, color,
  and rank. Severity counts flow through validation summaries, the model tree,
  the data table, and MCP validation queries.
- Dependency updates, including deepmerge-ts 8.0.0.

## 0.2.0 - 2026-08-17

- Model version history for server-backed models: upload new versions (with
  optional labels), download or delete old ones, and save Excel writeback
  results directly as a new version. Each upload records a change summary
  against the previous version.
- Model compare: diff any two versions of a server model — added, removed, and
  changed elements with per-field property diffs, optional re-evaluation of
  validation clauses across both versions, and a side-by-side 3D visual
  compare overlay.
- Color-coded compare deltas: green (added), red (removed), and orange
  (modified) tones shared between the 3D diff materials, the compare panel,
  and the properties panel.
- Validation clauses can target predefined IFC subtypes, with matching support
  across configuration schemas, rule evaluation, model comparison, and docs.
- Severity filters in the model tree and data table, plus richer mixed-severity
  summaries from MCP validation queries.
- Browser-safe MCP cursor encoding and decoding without relying on a global
  Node.js `Buffer`.
- More reliable startup: S3 bucket initialization retries with exponential
  backoff.
- Production and development dependency updates, including patched dependency
  advisories and refreshed That Open runtime worker assets.
- Prepare repository for public source and Docker distribution.
