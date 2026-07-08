# Changelog

All notable changes to COREY will be documented here.

This project uses semantic versioning once public releases begin.

## Unreleased

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
- More reliable startup: S3 bucket initialization retries with exponential
  backoff.
- Prepare repository for public source and Docker distribution.
