# Changelog

## v0.8.0

- npm: `createDiagnostics` takes `persist` (`{ key?, maxAgeMs? }`). With it,
  every entry is also written to the tab's `sessionStorage`, and a new
  timeline in the same tab starts with the stored entries younger than
  `maxAgeMs` (default 30 minutes), so the timeline outlives a reload or a
  login that leaves for another site. `clear()` also removes the stored copy.
- Nothing is removed. Without `persist`, nothing changes.

## v0.7.0

- npm: `BugReportButton` and `BugReport` take `technicalDetails`. With
  `false`, the dialog leaves out the Technical details disclosure; the details
  are still sent.
- Nothing is removed. Every v0.6.0 name and default is unchanged.

## v0.6.0

- npm: new subpath `@sylly-mika/bugkit/diagnostics`. `createDiagnostics()`
  records failed API calls and errors (newest 20), `console.error` and
  `console.warn` (newest 20), and other calls, routes and clicks (newest 50);
  `snapshot()` merges them by time for the dialog's `diagnostics` prop.
  `installDiagnostics()` installs the error (with up to 15 stack lines),
  console and breadcrumb capture; `withDiagnostics()` wraps `fetch`.
  `scrubText`, `scrubPath` and `cutStack` redact input values, tokens,
  e-mail addresses and secret query values before anything is stored.
- npm: the copy text shown after a failed send renders the new entries.
- npm: `createBugReportRoute` takes an optional `allowedOrigins`. When set, a
  request whose `Origin` is absent or not listed gets 403 before `reporter`
  runs.
- Go: new package `github.com/sylly-mika/bugkit/sourcemap` and the
  `bugkit-symbolicate` command, which resolve a minified stack against the
  build's source maps offline.
- Nothing is removed. `.`, `./next`, `./server` and every Go v0.5.0 name are
  unchanged.

## v0.5.0

- The npm package lives in `js/`. The Go module stays at the root; its import
  path and `vX.Y.Z` tags are unchanged.
- `dist/` is no longer committed. Each GitHub release attaches the packed
  `.tgz`, and that is how apps install from v0.5.0 on.
- v0.4.0 and older still install from their git tags.
- The Go tests live in `tests/`, not at the module root.
- No API change in either package.

## v0.4.0

- `ScreenshotEditor`: the report dialog's screenshot editor as a standalone component. It takes `image` (a `data:` or `blob:` URL) and returns the edited PNG from its ref's `toBlob()`; toolbar, zoom, crop, undo/redo and full screen as in the dialog. New part `editor`.
- Nothing is removed.

## v0.3.0

- Styling: the components mark each element with a part (`BUG_REPORT_PARTS`).
  `classNames` maps parts to classes, and `nonce` covers the one `<style>`
  element bugkit adds to `<head>`.
- A layered default stylesheet reads the page's `--color-*`, `--font-*` and
  `--radius-*` variables, with a fallback for each.
- Browser package: the types `BugReportPart` and `BugReportClassNames` are
  exported.
- `@sylly-mika/bugkit/next` exports `BugReport`, the launcher and dialog wired
  to a route with `endpoint`, `init` and `version`.
- `@sylly-mika/bugkit/server` exports `createBugReportRoute`, a Fetch-API
  handler that checks a report as the Go handler does and relays it to the
  intake with the key kept on the server.
- Nothing is removed.

## v0.2.1

- Crop shows the selection while dragging: the area outside is dimmed, the
  box is outlined dashed, and its size in image pixels is shown beside it.
  The export and the committed picture never include the overlay.

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
