# bugkit

A bug report button for React apps and the Go handler behind it. The button
captures a screenshot of the page; the dialog collects a description, an
impact and the page's diagnostics; the app's own Go server checks the report
and relays it to an ino-tasks project through the project's intake route,
where it lands in the triage column as an internal `bug` request.

- **Go** (`github.com/sylly-mika/bugkit`, standard library only):
  `bugkit.Handler`, an `http.Handler` that identifies the reporter with the
  app's own session, limits each reporter, checks the form and passes the
  report to a `bugkit.Sink`. `bugkit/intake` is the sink that posts to
  ino-tasks.
- **npm** (`@sylly-mika/bugkit`): `BugReportButton` and `BugReportDialog` for
  React 19, built to ESM with type declarations in `dist/`. The screenshot
  uses `html-to-image`.

## Status

Pre-1.0: the API may change between minor versions.

## Install

Go 1.26 or later:

```sh
go get github.com/sylly-mika/bugkit@v0.3.0
```

npm, from the git tag (there is no registry release):

```sh
npm install github:sylly-mika/bugkit#v0.3.0 html-to-image@^1.11.13
```

`react` and `react-dom` (`^19.2.7`) and `html-to-image` (`^1.11.13`) are
peer dependencies. Each tag carries the built `dist/`, so the install runs no
build script and needs no dev dependency.

## How a report travels

```
browser          BugReportButton → submit(form) → POST to the app's own route
app's server     bugkit.Handler → Who → limiter → form checks → Sink
bugkit/intake    POST <ino-tasks API>/api/intake/v1/bug-reports
                 Authorization: Bearer <intake key>
```

The browser talks only to the app's own server. The intake key stays on that
server.

## Go: the handler

```go
import (
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/sylly-mika/bugkit"
	"github.com/sylly-mika/bugkit/intake"
)

func bugReportHandler(log *slog.Logger) http.Handler {
	var sink bugkit.Sink // nil: the route answers 503
	if url, key := os.Getenv("BUGKIT_INTAKE_URL"), os.Getenv("BUGKIT_INTAKE_KEY"); url != "" && key != "" {
		sink = intake.New(url, key)
	}
	return bugkit.Handler(bugkit.Config{
		Sink: sink,
		Who: func(r *http.Request) (bugkit.Reporter, bool) {
			u, ok := currentUser(r) // the app's own session
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

Mount it on a `POST` route behind the app's session middleware (and its CSRF
check, if it has one), for example `POST /api/v1/bug-reports`; with echo,
`e.POST("/bug-reports", echo.WrapHandler(h))`. The body is
`multipart/form-data` of up to 6 MiB, with a screenshot of up to 5 MiB: raise
any smaller body limit on this route.

The browser sends the parts `kind` (`bug` or `feature`), `summary` (one line),
`description`, `impact` (`blocks`, `workaround`
or `cosmetic`), `area` (the route path, starting with `/`), `diagnostics`
(JSON), `version`, `viewport`, `request_id` and the file part `screenshot`
(PNG). The handler adds `user_agent` from the request (cut to 256 characters)
and the reporter's name and email from `Who`. `DefaultLimits` holds the
intake route's caps; `Limiter` is the app's per-reporter budget.

| case | status | detail |
|---|---|---|
| `Who` answers false | 401 | `Not authenticated.` |
| `Sink` is nil | 503 | `Bug reporting is not configured on this server.` |
| the reporter is over the limiter's budget | 429, `Retry-After` | `Too many bug reports. Try again in <n> seconds.` |
| the form is unreadable, or a part is missing, too long or malformed | 400, 413 or 422 | one sentence naming the problem |
| the intake answered 429 | 429, the intake's `Retry-After` | `Too many bug reports. Try again in <n> seconds.` |
| the intake answered 401, 403 or 409 (a bad or revoked key, an archived project) | 503 | `Bug reporting is not configured on this server.` |
| the intake failed otherwise, or gave no answer within 30 s | 502 | `The report could not be filed. Copy it and try again.` |
| filed | 201 | `{"id": "<task uuid>", "number": <task number>}` |

Every refusal is a JSON body whose `detail` is the sentence above; the
sentences carry no secret, so the dialog shows them to the reporter. The
handler logs the intake's status only, never a body or the key.

`bugkit.Sink` is an interface: an app may file reports somewhere other than
ino-tasks by passing its own.

## npm: the button

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
      getContext={() => ({ area: window.location.pathname, version: BUILD_SHA })}
    />
  );
}
```

`BugReportButton` props:

- `submit(form: FormData): Promise<BugReportResult>`: sends the form to the
  app's route and resolves with `{ id, number }`. When it throws, the dialog
  keeps the report, offers to copy it and shows the `Error`'s message, so
  throw the server's `detail` sentence.
- `getContext(): BugReportContext`: `{ area, version, requestId? }`, read when
  the button is pressed. `area` is the current route path.
- `labels?: BugReportLabelOverrides`: overrides of the English
  `defaultLabels`; `bug` and `feature` merge key by key. `filed` is the success
  sentence; `{number}` in it becomes the request's number.
- `diagnostics?: () => unknown`: extra context, sent inside the
  `diagnostics` JSON.
- `allowedImageOrigins?: string[]`: image origins besides the page's own that
  the screenshot may inline.
- `className?: string`: the launcher's class.

The package exports `BugReportButton`, `BugReportDialog`, `defaultLabels`,
`buildBugReportForm` (the form the dialog sends) and the types
`BugReportButtonProps`, `BugReportLabels`, `BugReportKindLabels`,
`BugReportLabelOverrides`, `BugReportContext`, `BugReportResult` and
`BugReportSubmit`, and the styling types `BugReportPart` and
`BugReportClassNames` with the part list `BUG_REPORT_PARTS`.

## Next.js

Two entries serve a Next.js app: `@sylly-mika/bugkit/next` exports the client
component `BugReport`, and `@sylly-mika/bugkit/server` exports
`createBugReportRoute`. The server entry imports no React, so the route runs
in Node and on the Edge runtime.

The route keeps the intake key on the server. Set these in the app's
environment:

- `BUGKIT_INTAKE_URL`: `<ino-tasks API>/api/intake/v1/bug-reports`.
- `BUGKIT_INTAKE_KEY`: the intake key. Server only: never name it
  `NEXT_PUBLIC_`, or the build puts it in the page.

`app/api/bug-report/route.ts`:

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

`reporter` returns the signed-in user, or `null` for a 401. The optional
`limit(request, reporter)` returns the seconds to wait for a 429, or `null` to
allow the report. No rate limiter is built in: a serverless instance does not
share one, so `limit` is where the app keeps its own.

Mount the launcher once in `app/layout.tsx`:

```tsx
import { BugReport } from "@sylly-mika/bugkit/next";

<BugReport className="…" version={process.env.NEXT_PUBLIC_BUILD_SHA} />
```

`version` goes into the report's context. `BugReport` posts to
`/api/bug-report` by default, and `init` (an object, or a function that
returns one) is merged into the request.

Static export, or a Go backend running `bugkit.Handler`: pass its URL as
`endpoint`, and send the session with `init={{ credentials: "include" }}` or
a bearer header.

```tsx
<BugReport endpoint="https://api.example.test/api/v1/bug-reports" init={{ credentials: "include" }} />
```

Styling: the dialog reads the `--color-*`, `--font-*` and `--radius-*`
variables of the page, with a built-in fallback for each. `classNames` maps a
part from `BUG_REPORT_PARTS` to extra classes. A Tailwind example:

```tsx
<BugReport
  classNames={{ panel: "bg-card rounded-xl", "primary-button": "bg-primary text-primary-foreground" }}
/>
```

The stylesheet is one `<style>` element in `<head>`. Under a Content Security
Policy, pass its `nonce` to `BugReport`. Tailwind v3 needs `classNames` for the
buttons and inputs.

## The intake route

`POST /api/intake/v1/bug-reports` on the ino-tasks API, operation
`intakeBugReport`. `bugkit/intake` speaks it; an app needs it only to write its
own sink.

- Auth: `Authorization: Bearer <intake key>`. No cookie, no CSRF token.
- Body: `multipart/form-data`, at most 6 MiB. Text parts are UTF-8 and
  trimmed (`diagnostics` is not); caps count characters unless bytes are
  named; an absent optional part equals an empty one; unknown parts are
  ignored; a repeated part is refused.

| part | required | cap |
|---|---|---|
| `kind` | no | `bug` or `feature`; absent or empty is `bug` |
| `summary` | no | 200, one line |
| `description` | yes | 5000 |
| `impact` | yes | `blocks`, `workaround` or `cosmetic` |
| `area` | yes | 512, starts with `/` |
| `diagnostics` | yes | 32768 bytes, JSON |
| `version` | no | 128 |
| `viewport` | no | 64 |
| `user_agent` | no | 256 |
| `request_id` | no | 128 |
| `reporter_name` | no | 200 |
| `reporter_email` | no | 320 |
| `screenshot` | no | file part, PNG, 5 MiB (5242880 bytes) |

Responses, in the order the route checks them:

| status | when |
|---|---|
| 401 | the key is missing, malformed, unknown or revoked (one body for all four) |
| 429, `Retry-After` | more than 60 reports in an hour with this key |
| 400 | the body is not a readable multipart form |
| 413 | the body is over 6 MiB, or the screenshot over 5 MiB |
| 422 | the first failing part, in the table's order |
| 409 | the key's project is archived |
| 201 | `{"id": "<task uuid>", "number": <task number>}` |

The report becomes an internal `bug` request in the project's triage column,
titled with the reporter's summary as sent. Without a summary, the title is
`[<key name>] <first line of the description>`, cut to 80 characters. The
description starts with `App: <key name>`, and the screenshot is attached as
a private task file. The project's clients never see it unless staff make the
task public. Nothing about the request's outcome goes back to the app.

## Intake keys

- A project's lead, or a workspace owner or admin, creates a key on the
  project's page in the ino-tasks admin and names it after the app. The key
  is `itk_` followed by 43 characters. ino-tasks shows it once, at creation,
  and stores only its SHA-256 hash.
- The key is a server credential. Keep it in the app server's secret store
  (`BUGKIT_INTAKE_KEY`), never in a browser bundle, a committed file, a log
  line, an error message or an issue. bugkit never logs it and never puts it
  in an error.
- One key per app and project: every report filed with a key lands in that
  key's project. The intake allows 60 reports per hour per key.
- A leaked key: revoke it in the admin (the intake refuses it at once, and
  bugkit's handler then answers 503), create a new one and deploy the app
  with it.

## Development

Go (standard library only):

```sh
test -z "$(gofmt -l .)"
go vet ./...
go test -race -count=1 ./...
```

npm (`npm ci` first):

```sh
npm run typecheck
npm run test
npm run build        # tsc -p tsconfig.build.json into dist/
npm run check:pack   # packs the package and uses it from a temp app
```

`dist/` is committed: run `npm run build` and commit `dist/` with every change
under `src/`. CI fails when the build changes `dist/`. A release updates
`CHANGELOG.md` and tags `vX.Y.Z` on a commit whose CI is green.

## License

MIT. See `LICENSE`.
