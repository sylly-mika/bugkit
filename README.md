# bugkit

bugkit adds a bug report button to a React app and checks the reports on the
app's own server before filing them with an ino-tasks project. It has two
halves that you install separately:

- **npm** `@sylly-mika/bugkit`: the React button and dialog. The dialog takes
  a screenshot of the page (with `html-to-image`), lets the reporter mark it
  up, and collects a summary, a description, an impact and diagnostics. It
  posts the report as `multipart/form-data` to a route on **your** server.
- **Go** `github.com/sylly-mika/bugkit`: `bugkit.Handler`, the `http.Handler`
  for that route. It identifies the reporter with your app's session, applies
  a per-reporter rate limit, checks the form and passes the report to a
  `bugkit.Sink`. The package `bugkit/intake` is the sink that files the report
  on an ino-tasks project's intake route with a Bearer key.

For a Next.js app without a Go server, `@sylly-mika/bugkit/server` gives a
route that does the same checks in TypeScript.

```
browser       BugReportButton -> POST multipart form -> your route
your server   bugkit.Handler: Who -> Sink set? -> rate limit -> form checks -> Sink
intake        intake.Client -> POST <intake URL>, Authorization: Bearer <key>
```

The browser talks only to your server; the intake key stays there.

What bugkit does not do: it does not authenticate users (you supply `Who` or
`reporter`) and stores nothing on the server. The only server state is the Go
rate limiter, in memory. It reads no environment variables and needs no
database. The Next.js route has no built-in rate limiter. In the browser, the
dialog keeps an unsent draft in the tab's `sessionStorage` (key
`bugkit:draft:v1`) until the report is sent or discarded.

Status: pre-1.0. The API may change between minor versions.

## Install

Go 1.26 or later. The module uses the standard library only.

```sh
go get github.com/sylly-mika/bugkit@v0.5.0
```

npm: from v0.5.0 on, the release workflow attaches the packed `.tgz` to each
GitHub release, and that is the install source. The package is ESM, with
types in `dist/`.

```sh
npm install https://github.com/sylly-mika/bugkit/releases/download/v0.5.0/sylly-mika-bugkit-0.5.0.tgz html-to-image@^1.11.13
```

Tags up to v0.4.0 install from git instead: `github:sylly-mika/bugkit#v0.4.0`.

Peer dependencies: `react` and `react-dom` `^19.2.7`, `html-to-image`
`^1.11.13`. The package ships the built `dist/` and has no install scripts.

## Minimal example

Go server. `currentUser` stands for your app's own session lookup; the
environment variable names are your choice, since bugkit reads none.

```go
package main

import (
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/sylly-mika/bugkit"
	"github.com/sylly-mika/bugkit/intake"
)

func bugReportHandler(log *slog.Logger) http.Handler {
	var sink bugkit.Sink // left nil, a signed-in reporter gets 503
	if url, key := os.Getenv("BUGKIT_INTAKE_URL"), os.Getenv("BUGKIT_INTAKE_KEY"); url != "" && key != "" {
		sink = intake.New(url, key)
	}
	return bugkit.Handler(bugkit.Config{
		Sink: sink,
		Who: func(r *http.Request) (bugkit.Reporter, bool) {
			u, ok := currentUser(r) // your app's session
			if !ok {
				return bugkit.Reporter{}, false
			}
			return bugkit.Reporter{ID: u.ID, Name: u.Name, Email: u.Email}, true
		},
		Limiter: bugkit.NewRateLimiter(10, time.Hour),
		Limits:  bugkit.DefaultLimits(),
		Logger:  log,
	})
}
```

Mount it on a `POST` route behind your session middleware (and your CSRF
check, if you have one), for example `POST /api/v1/bug-reports`.
`bugkit.Handler` does not check the method itself. The body can be up to
6 MiB, so raise any smaller body limit on this route.

React client:

```tsx
import { BugReportButton, type BugReportSubmit } from "@sylly-mika/bugkit";

const submit: BugReportSubmit = async (form) => {
  const res = await fetch("/api/v1/bug-reports", {
    method: "POST",
    body: form,
    credentials: "include",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `HTTP ${res.status}`);
  return body; // { id, number }
};

export function BugButton() {
  return (
    <BugReportButton
      submit={submit}
      getContext={() => ({ area: window.location.pathname, version: "1.4.2" })}
    />
  );
}
```

`version` is your build id. On success the server answers 201 with
`{"id": "<task uuid>", "number": <task number>}`, which is the
`BugReportResult` that `submit` returns.

## Intake keys

An intake key lets your server file reports into one ino-tasks project.

- A workspace owner or admin, or the project's lead, creates a key in the
  ino-tasks admin: open the project, then **Settings**, then **Intake keys**.
  Name it after the app.
- The key is `itk_` followed by 43 characters. ino-tasks returns it once, in
  the create response. It stores only a SHA-256 hash and a 12-character
  prefix, so a lost key cannot be shown again. Create a new one.
- The key is a server credential. Keep it in your app server's secret store.
  Never put it in a browser bundle, a committed file, a log line or an error
  message.
- Use one key per app and project. Every report filed with a key lands in
  that key's project.
- A key may file 60 reports per hour. Each API process counts them in memory.
  A report over the cap gets 429 with `Retry-After`.
- If a key leaks, revoke it in the same **Intake keys** card. The intake
  refuses it at once, and bugkit's handler then answers 503. Create a new key
  and redeploy the app with it.

Pass the full intake route URL, `<ino-tasks API>/api/intake/v1/bug-reports`,
to `intake.New` (Go) or `intakeUrl` (Next.js route), with the key.

## Add bugkit to a Next.js app

Two entry points serve Next.js. `@sylly-mika/bugkit/server` exports
`createBugReportRoute`, which returns a Fetch API handler
`(request: Request) => Promise<Response>`. It checks a report the way the Go
handler does and relays it to the intake with the key kept on the server. The
server entry imports no React.

`app/api/bug-report/route.ts` (`getSession` is your app's session lookup):

```ts
import { createBugReportRoute } from "@sylly-mika/bugkit/server";
import { getSession } from "@/lib/session";

export const POST = createBugReportRoute({
  intakeUrl: process.env.BUGKIT_INTAKE_URL ?? "",
  intakeKey: process.env.BUGKIT_INTAKE_KEY ?? "",
  reporter: async () => {
    const session = await getSession();
    return session ? { name: session.name, email: session.email } : null;
  },
});
```

`reporter` returns the signed-in user as `{ name, email }`, or `null`, which
answers 401. An empty `intakeUrl` or `intakeKey` answers 503. Keep the key
out of any browser bundle.

`@sylly-mika/bugkit/next` exports the client component `BugReport`: the
button and dialog wired to that route. Mount it once, for example in
`app/layout.tsx`:

```tsx
import { BugReport } from "@sylly-mika/bugkit/next";

<BugReport version={process.env.NEXT_PUBLIC_BUILD_SHA} />
```

`BugReport` posts to `/api/bug-report` by default. It takes every
`BugReportButton` prop except `submit`, and `getContext` is optional.

For a static export, or when `bugkit.Handler` serves the route, pass the URL
as `endpoint` and send the session with `init`. `init` is a `RequestInit`, or a
function that returns one (or a promise of one), merged into the request.

```tsx
<BugReport
  endpoint="https://api.example.test/api/v1/bug-reports"
  init={{ credentials: "include" }}
/>
```

## Handle a failed submit

When `submit` throws, the dialog keeps the report, offers to copy it, and
shows the `Error`'s message. Every refusal from bugkit's servers is a JSON
body whose `detail` is a sentence written for the reporter, with no secret in
it, so throw `new Error(body.detail)` as in the minimal example. `BugReport`
from `/next` already does this, and falls back to `HTTP <status>` when the body
has no `detail`.

## Limit reports per reporter

Go: `bugkit.NewRateLimiter(max, window)` allows `max` reports per reporter in
each `window`. Over the budget, the handler answers 429 with `Retry-After`.
Every report that reaches the limiter counts, including one the form checks
refuse. A report over the budget is not recorded and does not extend the wait.
A nil limiter, or `max <= 0`, allows everything. The limiter is in memory per
process, and it never deletes a reporter's entry, so it grows by one small
entry per distinct reporter.

Next.js: there is no built-in limiter, because serverless instances would not
share one. Pass `limit(request, reporter)`, which returns the seconds to wait
(answered as 429 with `Retry-After`) or `null` to allow the report:

```ts
  // added to the createBugReportRoute options; myBudget is your own store
  limit: async (_request, reporter) => (await myBudget.allow(reporter.email)) ? null : 60,
```

## Configure the button

`getContext` is read when the button is pressed; `area` is the current route
path. All props are in the [reference](#npm-bugreportbutton-props).

`labels` overrides the English `defaultLabels`. The `bug` and `feature`
groups merge key by key. `filed` is the success sentence; `{number}` in it
becomes the filed task's number.

```tsx
<BugReportButton
  submit={submit}
  getContext={() => ({ area: window.location.pathname, version: "1.4.2" })}
  diagnostics={() => ({ featureFlags: ["new-editor"] })}
  allowedImageOrigins={["https://cdn.example.test"]}
/>
```

## Style the dialog

The dialog reads the page's `--color-*`, `--font-*` and `--radius-*` CSS
variables, with a built-in fallback for each. `classNames` adds classes to
named parts; the part names are in `BUG_REPORT_PARTS`, and any class you add
beats the default look. `className` sets the launcher's class.

```tsx
<BugReport
  classNames={{ panel: "bg-card rounded-xl", "primary-button": "bg-primary text-primary-foreground" }}
/>
```

bugkit adds its stylesheet as one `<style>` element in `<head>`. Under a
Content Security Policy, pass the `nonce` prop.

## File reports somewhere other than ino-tasks

`bugkit.Sink` is an interface. Pass your own to file reports elsewhere:

```go
type logSink struct{ log *slog.Logger }

func (s logSink) Submit(ctx context.Context, who bugkit.Reporter, r bugkit.Report) (bugkit.Result, error) {
	s.log.Info("bug report", "reporter", who.ID, "kind", r.Kind, "summary", r.Summary)
	return bugkit.Result{ID: "local-1", Number: 1}, nil
}
```

`bugkit.Report` carries `Kind`, `Summary`, `Description`, `Impact`, `Area`,
`Diagnostics` (`json.RawMessage`), `Version`, `Viewport`, `RequestID`,
`UserAgent` and `Screenshot` (`[]byte`, PNG). To refuse with a status, return
a `*bugkit.SinkError` with `Status` and `RetryAfter` set; the handler maps it
as shown under [Errors](#errors-and-refusals). Any other error answers 502.

## Edit a screenshot on its own

`ScreenshotEditor` is the dialog's screenshot editor as a standalone
component: markup toolbar, zoom, crop, undo and redo, full screen. It never
uploads. Give it a `data:` or `blob:` URL as `image`; a cross-origin image
taints the canvas, and `toBlob()` then resolves `null`.

```tsx
import { useRef } from "react";
import { ScreenshotEditor, type ScreenshotEditorHandle } from "@sylly-mika/bugkit";

export function Annotate({ image, onSave }: { image: string; onSave: (png: Blob) => void }) {
  const ref = useRef<ScreenshotEditorHandle>(null);
  const save = async () => {
    const png = await ref.current?.toBlob();
    if (png) onSave(png);
  };
  return (
    <>
      <ScreenshotEditor ref={ref} image={image} />
      <button type="button" onClick={save}>Save</button>
    </>
  );
}
```

Other props: `labels`, `classNames`, `nonce`, and
`onMarkupChange(marked: boolean)`.

## Configuration reference

### Go: `bugkit.Config`

| Field | Type | If left zero | Meaning |
|---|---|---|---|
| `Who` | `func(*http.Request) (bugkit.Reporter, bool)` | set it | Your identity callback. Return `false` for 401. Checked first. |
| `Sink` | `bugkit.Sink` | nil: a signed-in reporter gets 503 | Where reports are filed. `intake.New(url, key)` returns one. |
| `Limiter` | `*bugkit.RateLimiter` | nil: no limit | Per-reporter budget from `bugkit.NewRateLimiter(max, window)`. |
| `Limits` | `bugkit.Limits` | zero: default caps | Caps per form part. |
| `Logger` | `*slog.Logger` | nil: `slog.Default()` | Where failed filings are logged. |

`bugkit.Reporter` is `{ID, Name, Email string}`, filled from your session,
never from the form. The Sink receives `Name` and `Email` in `who`;
`intake.Client` sends them as `reporter_name` and `reporter_email`. The
handler sets the report's `UserAgent` from the request.

`bugkit.DefaultLimits()` (text in characters, the last two in bytes):

| `Summary` | `Description` | `Area` | `Version` | `Viewport` | `RequestID` | `UserAgent` | `Diagnostics` | `Screenshot` |
|---|---|---|---|---|---|---|---|---|
| 200 | 5000 | 512 | 128 | 64 | 128 | 256 | 32768 | 5242880 (5 MiB) |

The request body may be the screenshot cap plus 1 MiB, so 6 MiB with the
defaults. A filing that takes longer than 30 seconds fails with 502.

`intake.New(url, key)` takes the full intake route URL and the key. The key is
written only to the `Authorization` header, and the client's `%v` and `%#v`
output shows it as `<redacted>`. The client never follows a redirect.

### npm: `BugReportButton` props

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `submit` | `(form: FormData) => Promise<BugReportResult>` | required | Sends the form to your route; resolves with `{ id, number }`; throws on refusal. |
| `getContext` | `() => BugReportContext` | required | `{ area, version, requestId? }`, read when the button is pressed. |
| `labels` | `BugReportLabelOverrides` | `defaultLabels` (English) | Text overrides. |
| `diagnostics` | `() => unknown` | none | Extra context, sent inside the `diagnostics` JSON part. |
| `allowedImageOrigins` | `string[]` | none | Image origins, besides the page's own, the screenshot may include. |
| `className` | `string` | none | Class of the launcher button. |
| `children` | `ReactNode` | the label | Launcher content. |
| `onOpenChange` | `(open: boolean) => void` | none | Called when the dialog opens or closes. |
| `classNames` | `BugReportClassNames` | none | Classes per part from `BUG_REPORT_PARTS`. |
| `nonce` | `string` | none | CSP nonce for bugkit's `<style>` element. |

### npm: `BugReport` (`@sylly-mika/bugkit/next`)

All `BugReportButton` props except `submit`, plus:

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `endpoint` | `string` | `/api/bug-report` | URL the report is posted to. |
| `init` | `RequestInit` or `() => RequestInit \| Promise<RequestInit>` | none | Merged into the request, for example `{ credentials: "include" }`. |
| `version` | `string` | none | Your build id, sent in the report's context. |
| `getContext` | `() => BugReportContext` | optional here | Overrides the context. |

### npm: `createBugReportRoute` options (`@sylly-mika/bugkit/server`)

| Option | Type | Meaning |
|---|---|---|
| `intakeUrl` | `string` | Full intake route URL. Empty answers 503. |
| `intakeKey` | `string` | Intake key. Empty answers 503. |
| `reporter` | `(request) => BugReporter \| null`, or a promise of it | Signed-in user `{ name, email }`, or `null` for 401. |
| `limit` | `(request, reporter) => number \| null`, or a promise of it | Optional. Seconds to wait (429), or `null` to allow. |

### Form parts

The dialog sends `kind` (`bug` or `feature`; absent is `bug`), `summary`,
`description`, `impact` (`blocks`, `workaround` or `cosmetic`), `area`,
`diagnostics` (JSON), `version`, `viewport`, `request_id`, and the file part
`screenshot` (PNG). `buildBugReportForm(payload)` builds this `FormData` if
you write your own client.

### The intake route

For an app that writes its own client instead of using `bugkit/intake`.

- Method and path: `POST /api/intake/v1/bug-reports` on the ino-tasks API.
- Auth: `Authorization: Bearer <intake key>`. No cookie and no CSRF token.
- Body: `multipart/form-data`, at most 6 MiB.
- Text parts must be UTF-8 with no NUL byte. They are read up to 64 KiB, and
  a longer one fails its cap. Values are trimmed, except `diagnostics`. An
  absent optional part counts as empty. Unknown parts are ignored. A part
  sent twice is refused.

| part | required | cap |
|---|---|---|
| `kind` | no | `bug` or `feature`; empty means `bug` |
| `summary` | no | 200 characters |
| `description` | yes | 5000 characters |
| `impact` | yes | `blocks`, `workaround` or `cosmetic` |
| `area` | yes | 512 characters, starts with `/` |
| `diagnostics` | yes | JSON, 32 KiB (32768 bytes) |
| `version` | no | 128 characters |
| `viewport` | no | 64 characters |
| `user_agent` | no | 256 characters |
| `request_id` | no | 128 characters |
| `reporter_name` | no | 200 characters |
| `reporter_email` | no | 320 characters |
| `screenshot` | no | file part, PNG, 5 MiB (5242880 bytes) |

Responses, in the order the route checks them:

| status | when |
|---|---|
| 401 | the key is missing, malformed, unknown or revoked. One body for all four. |
| 429, `Retry-After` | more than 60 attempts in an hour with this key. Counted before the form is read. |
| 400 | the body is not a readable multipart form, a part is sent twice, or a text part is not UTF-8 or has a NUL byte |
| 413 | the body is over 6 MiB, or the screenshot is over 5 MiB. Checked while the parts are read. |
| 422 | a field fails its check, or the screenshot is not PNG. Field checks run after all parts are read, in the table's order. |
| 404 | the key's project no longer exists |
| 409 | the key's project is archived (`project_archived`) |
| 201 | `{"id": "<task uuid>", "number": <task number>}` |

What a report becomes in ino-tasks:

- An internal task in the key's project, in the project's `triage` column,
  with priority `none`. Clients cannot see an internal task.
- Its request kind is `bug`, or `change` when `kind` is `feature`.
- Its title is the summary as sent. With no summary, the title is
  `[<key name>] <first line of the description>`, cut to 80 characters and
  an ellipsis.
- Its description starts with `App: <key name>`, then a `Reporter:` line when
  the key stores reporter emails (the default) or a name was sent, then
  `Page:`, `Impact:`, any version, viewport, user agent and request id lines
  that were sent, the description, and a `Diagnostics:` code block.
- The screenshot is saved as `screenshot.png` on that task. Clients see task
  files only when the task is not internal, so it stays private.
- Nothing else goes back to the app. The 201 body is the whole answer.

## Errors and refusals

Both servers, `bugkit.Handler` and `createBugReportRoute`, answer with these
statuses. Every refusal is a JSON body whose `detail` is the sentence shown.
The Go handler checks in this order: identity, the sink, the rate limit, then
the body.

| Case | Status | `detail` |
|---|---|---|
| `Who` returns false / `reporter` returns `null` | 401 | `Not authenticated.` |
| No sink (Go), or empty `intakeUrl` or `intakeKey` (Next.js) | 503 | `Bug reporting is not configured on this server.` |
| Reporter over the limit | 429, `Retry-After` | `Too many bug reports. Try again in <n> seconds.` |
| Body is not a readable multipart form | 400 | `The report body is not a readable multipart form.` |
| Body or screenshot too large | 413 | `The report is larger than …` / `The screenshot is larger than …` |
| A part is missing or invalid | 422 | One sentence naming the part, for example `A description is required.` |
| Intake answered 429 | 429, intake's `Retry-After` (60 s if none usable) | `Too many bug reports. Try again in <n> seconds.` |
| Intake answered 401, 403 or 409 (bad or revoked key, archived project) | 503 | `Bug reporting is not configured on this server.` |
| Intake failed otherwise, or no answer within 30 s | 502 | `The report could not be filed. Copy it and try again.` |
| Filed | 201 | body `{"id": "<task uuid>", "number": <task number>}` |

Logging (Go): when the sink returns a `*bugkit.SinkError`, the handler logs
its status only, never a response body. Any other error is logged with its
error text and the reporter's `ID`.

## Upgrading

See `CHANGELOG.md` for every change.

- **To v0.5.0:** no API change in either package. The npm package now
  installs from the `.tgz` attached to the GitHub release, not from the git
  tag, because `dist/` is no longer committed. Change your install URL as in
  [Install](#install). The Go import path and tags are unchanged.
- **To v0.2.0 (from v0.1.x):** `BugReportLabels` is reshaped: `dialogTitle`,
  `toolBlackout`, and the description and impact labels move under `bug` and
  `feature`. Move your label overrides to match. Reports without `kind` or
  `summary` are still accepted as bugs.

## Development

Go, from the repository root (tests live in `tests/`, an external package):

```sh
test -z "$(gofmt -l .)"
go vet ./...
go test -race -count=1 ./...
```

npm, in `js/` (CI uses Node 22):

```sh
cd js && npm ci
npm run typecheck
npm run test
npm run build        # tsc -p tsconfig.build.json into js/dist/
npm run check:pack   # packs the package and uses it from a temp app
npm run pack         # writes sylly-mika-bugkit-X.Y.Z.tgz into js/
```

`dist/` is built, not committed. Pushing a `vX.Y.Z` tag runs the release
workflow, which attaches the packed `.tgz` to the release.

## License

MIT. See `LICENSE`.
