# bugkit Next.js example

A minimal App Router app. `app/layout.tsx` mounts `BugReport` from `@sylly-mika/bugkit/next`, and `app/api/bug-report/route.ts` receives reports with `createBugReportRoute` from `@sylly-mika/bugkit/server`, as the README's Next.js section shows.

It depends on this checkout's bugkit (`file:../../js`), so build the package first: `npm --prefix ../../js run build`.

Run it:

    npm install
    npm run dev

Without `BUGKIT_INTAKE_URL` and `BUGKIT_INTAKE_KEY`, the route logs each report's summary to the server console and answers 503. The reporter is a fixed placeholder: replace it with your app's session lookup.
