# Changelog

## v0.2.0

- Form parts `kind` (`bug` or `feature`; absent or empty is a bug; any other
  value is 422 `Kind must be bug or feature.`) and `summary` (one line, trimmed,
  at most 200 characters; absent or empty is allowed; longer is 422
  `Summary must be at most 200 characters.`). Both come ahead of `description`.
- `Report` gains `Kind` and `Summary`; `Limits` gains `Summary` (default 200);
  `BugKinds` lists the kinds.
- The intake client sends `kind` always and `summary` when it is not empty.
- Browser package: `BUG_KINDS`, `SUMMARY_LIMIT` and the type `BugKind` are
  exported; `buildBugReportForm` and `reportAsText` carry the kind and the
  summary.
- A report without `kind` or `summary` is still accepted as a bug.
- The report opens as a full-viewport editor: header with Back, Send and the
  save state; the screenshot with its markup toolbar on the left; the form on
  the right.
- Bug / Feature request switch: the choice rewords every string of the form.
- Summary field, sent trimmed with the report.
- Screenshot tools: Box, Arrow, Draw, Text and Redact (black-out), Crop, Undo
  and Redo, zoom with Fit, and full screen for the picture. Every mark, crop and
  redaction is burned into the sent PNG.
- Drafts survive a reload of the tab (per-tab storage) until the report is sent
  or discarded; Back and Escape ask before discarding typed text or marks.
- Breaking: `BugReportLabels` is reshaped (`dialogTitle`, `toolBlackout`, the
  description and impact labels move under `bug`/`feature`).

## v0.1.0

First release.

- Go package `bugkit`: `Handler` (reporter from the app's session, a
  per-reporter rate limiter, form checks with the intake route's caps, JSON
  problem sentences), `Sink`, `SinkError`, `Limits` and `DefaultLimits`.
- Go package `bugkit/intake`: `Client`, a `Sink` that posts reports to
  ino-tasks' intake route `POST /api/intake/v1/bug-reports` with an intake
  key.
- npm package `@sylly-mika/bugkit`: `BugReportButton`, `BugReportDialog`,
  `defaultLabels` and `buildBugReportForm`, with page screenshots through
  `html-to-image`, built to ESM with declarations in `dist/` and installed
  from the git tag.
