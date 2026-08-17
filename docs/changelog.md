# Changelog

All notable changes to COREY will be documented here.

This project uses semantic versioning once public releases begin.

## Unreleased

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
