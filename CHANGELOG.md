# Changelog

## v0.12.0

- npm: BugReportButton takes listReports, and BugReport takes reportsEndpoint:
  the menu gets a "Reported issues" item that opens a read-only, paged list of
  the site's reports.
- npm: the reports list's failed state has a Try again button that reloads the
  current page, and a request that takes longer than 30 seconds fails the same
  way.
- go: intake.Client.List and bugkit.ListHandler forward the list request; the
  key stays on the server.
- Nothing is removed.

## v0.11.2

- npm: the report button injects bugkit's styles itself, so the screenshot
  menu, the capture hint and the sent-report notice are styled from the first
  render, before any dialog has opened. Before, they were unstyled until the
  dialog or the screenshot editor had mounted once.

## v0.11.1

- npm: the screenshot menu is drawn in a portal on `document.body`, at a fixed
  position, so a host's flex row or `position: relative` no longer moves the
  report button or scrolls the page. The menu is placed before its first item
  takes focus, and it is cleared on close, so a reopened menu is placed from
  the button's place at that moment.
- npm: Escape with the screenshot menu open closes only the menu, not the
  host's drawer or dialog around the button; focus returns to the button.
- npm: since v0.10.0, the sent-report notice's empty region took a place in a
  host's flex row until the first report dialog opened, so the report button
  moved when that dialog first opened; the region is now drawn in a portal on
  `document.body`, at a fixed position, from the first render.
- Nothing is removed from the API.

## v0.11.0

- npm: pressing the report button opens a dropdown of the ways to take the
  screenshot: "Screenshot now", "Screenshot in 3 seconds", "Screenshot on key
  press" and "Send without screenshot". The screenshot is taken when an item is
  chosen, not when the button is pressed. The Arrow, Home and End keys move
  between its items; Escape, Tab or a click outside closes it. Its items use
  the new labels `screenshotNow`, `screenshotInThreeSeconds`,
  `screenshotOnKeyPress` and `sendWithoutScreenshot`; the button's name gains
  `buttonMenuHint`. A host's v0.10.0 label set still works: the missing strings
  come from the defaults.
- npm: the dialog no longer shows screenshot options. It shows the screenshot,
  if there is one, and its markup tools. The labels `screenshotModes`
  ("Screenshot options"), `retakeDelayed` ("Retake in 3 seconds"),
  `retakeOnKey` ("Retake on key press") and `removeScreenshot` are no longer
  shown; a host's text for them is unused. The label names stay.
- Nothing is removed from the API. By default, the button now opens the menu
  and takes no screenshot until an item is chosen. `screenshotModes={false}`
  keeps v0.10.0's behaviour: the button takes the screenshot at once and opens
  the dialog.

## v0.10.0

- npm: a report with a summary needs no description. "What happened?" is
  required only when Summary is empty. With neither, the form shows
  `summaryOrDescriptionRequired` ("Add a summary or describe what happened.")
  under "What happened?" and sends nothing. The same rule holds for a feature
  request.
- npm: a sent report closes the dialog and shows a notice for about 5 seconds,
  `sentNotice` ("Report sent. Its number is #{number}."), fixed at the bottom
  right with a close button. It stays while the pointer is over it or it has
  focus. The sent view is no longer shown by default. `BugReportButton` and
  `BugReport` take `onSent({ number })`: when set, bugkit calls it after a send
  and shows no notice of its own. `confirmation` (`"notice"`, the default, or
  `"dialog"`) picks the confirmation; `"dialog"` keeps the v0.9.0 sent view.
- npm: the screenshot embeds the page's web fonts, so labels wrap as they do on
  the page, in whatever format the page loads them. `BugReportButton` takes
  `captureFonts` (default `true`); `false` skips the embedding for a host where
  it is slow. A font or image that has not loaded after about 1.5 seconds is
  left out, and the screenshot is still taken.
- npm: the screenshot draws a border-image layer on an element, such as a
  primary button's seal, in its shape as on the page, not as a solid box.
- go: the intake parser accepts an empty description when the summary is not
  blank. With both blank it refuses with
  `A summary or a description is required.`
- Nothing is removed from the API. The summary-only message (`summaryRequired`)
  and its element `#bug-report-summary-error` are no longer shown, since a
  summary alone is never required; a host's text for it is unused. The label
  name stays. The sent view is kept behind confirmation="dialog".

## v0.9.0

- npm: the dialog offers screenshot options: retake the screenshot after a
  3-second countdown, or on the S key after arranging the page, or send
  without a screenshot. Escape or Cancel screenshot cancels a pending retake.
  `BugReportButton` and `BugReport` take `screenshotModes` (default `true`);
  `false` hides the options. New parts `screenshot-modes`, `screenshot-mode`,
  `capture-hint`, `capture-cancel`, and new labels for their text.
- npm: a screenshot taken while an inner panel is scrolled shows the panel
  scrolled as it was on screen.
  Text placed directly inside a scrolled element (a bare `<pre>` log, a
  text-only box, or a textarea) is captured from its top, while a scrolled
  element whose content is elements shows as scrolled.
- Nothing is removed. Opening the dialog still takes the screenshot at once.

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
