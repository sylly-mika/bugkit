# Changelog

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
