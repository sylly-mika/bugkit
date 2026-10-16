// @vitest-environment node
import type { Mock, MockInstance } from "vitest";
import { createBugReportRoute } from "./server.js";
import type { BugReporter, BugReportRouteOptions } from "./server.js";

const SHOP = "https://shop.test";
const ADMIN = "https://admin.test";
const PNG16 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const FORBIDDEN = {
  type: "about:blank",
  title: "Forbidden",
  status: 403,
  detail: "This origin may not file bug reports.",
  instance: "/api/bug-report",
};

type Intake = (url: string, init?: RequestInit) => Promise<Response>;
type Reporter = (request: Request) => BugReporter | null;
type Limit = (request: Request, who: BugReporter) => number | null;

let upstream: Mock<Intake>;
let reporter: Mock<Reporter>;
let limit: Mock<Limit>;
let errorSpy: MockInstance<typeof console.error>;

function route(extra: Partial<BugReportRouteOptions> = {}) {
  return createBugReportRoute({
    intakeUrl: "https://intake.test/api/intake/v1/bug-reports",
    intakeKey: "k-test",
    reporter,
    limit,
    ...extra,
  });
}

function report(origin?: string): Request {
  const form = new FormData();
  form.set("kind", "bug");
  form.set("summary", "Crash");
  form.set("description", "It broke");
  form.set("impact", "blocks");
  form.set("area", "/tasks");
  form.set("diagnostics", "{}");
  form.set("version", "v1");
  form.set("viewport", "800x600");
  form.set("screenshot", new File([PNG16], "screenshot.png", { type: "image/png" }));
  const headers: Record<string, string> = origin === undefined ? {} : { origin };
  return new Request("http://app.test/api/bug-report", { method: "POST", body: form, headers });
}

async function expectRefused(res: Response, request: Request) {
  expect(res.status).toBe(403);
  expect(res.headers.get("content-type")).toBe("application/json; charset=UTF-8");
  expect(await res.json()).toEqual(FORBIDDEN);
  expect(reporter).not.toHaveBeenCalled();
  expect(limit).not.toHaveBeenCalled();
  expect(upstream).not.toHaveBeenCalled();
  expect(request.bodyUsed).toBe(false);
  expect(errorSpy).not.toHaveBeenCalled();
}

beforeEach(() => {
  upstream = vi.fn<Intake>(
    async () =>
      new Response(JSON.stringify({ id: "r-1", number: 42 }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", upstream);
  reporter = vi.fn<Reporter>(() => ({ name: "Ann", email: "ann@x.test" }));
  limit = vi.fn<Limit>(() => null);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createBugReportRoute allowedOrigins", () => {
  it("refuses a foreign Origin with 403 and files nothing", async () => {
    const req = report("https://evil.test");
    const res = await route({ allowedOrigins: [SHOP] })(req);
    await expectRefused(res, req);
  });

  it("refuses a request with no Origin when a list is set", async () => {
    const req = report();
    const res = await route({ allowedOrigins: [SHOP] })(req);
    await expectRefused(res, req);
  });

  it("matches an Origin exactly", async () => {
    const handler = route({ allowedOrigins: [SHOP] });
    for (const origin of ["https://shop.test.evil.test", "https://shop.test/", "HTTPS://SHOP.TEST", "http://shop.test", "null"]) {
      const req = report(origin);
      const res = await handler(req);
      await expectRefused(res, req);
    }
  });

  it("files a report from a listed Origin", async () => {
    const req = report(SHOP);
    const res = await route({ allowedOrigins: [ADMIN, SHOP] })(req);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "r-1", number: 42 });
    expect(reporter).toHaveBeenCalledTimes(1);
    expect(limit).toHaveBeenCalledTimes(1);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("files as before when no list is set, with or without an Origin", async () => {
    const handler = route();
    const withoutOrigin = await handler(report());
    expect(withoutOrigin.status).toBe(201);
    expect(await withoutOrigin.json()).toEqual({ id: "r-1", number: 42 });
    const foreign = await handler(report("https://evil.test"));
    expect(foreign.status).toBe(201);
    expect(await foreign.json()).toEqual({ id: "r-1", number: 42 });
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("refuses every request when the list is empty", async () => {
    const req = report(SHOP);
    const res = await route({ allowedOrigins: [] })(req);
    await expectRefused(res, req);
  });

  it("checks the Origin before the reporter and the configuration", async () => {
    reporter.mockImplementation(() => {
      throw new Error("reporter ran");
    });
    const req = report("https://evil.test");
    const res = await route({ allowedOrigins: [SHOP], intakeKey: "" })(req);
    await expectRefused(res, req);
  });
});
