// @vitest-environment node
import type { Mock, MockInstance } from "vitest";
import { createBugReportRoute } from "./server.js";
import type { BugReporter, BugReportRouteOptions } from "./server.js";

const KEY = "k-secret";
const INTAKE = "https://intake.test/api/intake/v1/bug-reports";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG16 = new Uint8Array([...PNG_SIGNATURE, 1, 2, 3, 4, 5, 6, 7, 8]);
const FILED = JSON.stringify({ id: "r-1", number: 42 });
const PROBLEM_TYPE = "application/json; charset=UTF-8";
const TITLES: Record<number, string> = {
  429: "Too Many Requests",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

type Intake = (url: string, init?: RequestInit) => Promise<Response>;
let upstream: Mock<Intake>;
let errorSpy: MockInstance<typeof console.error>;

function base(): BugReportRouteOptions {
  return {
    intakeUrl: INTAKE,
    intakeKey: KEY,
    reporter: () => ({ name: "Ann", email: "ann@x.test" }),
  };
}

function routeWith(overrides: Partial<BugReportRouteOptions>) {
  return createBugReportRoute({ ...base(), ...overrides });
}

function good(): FormData {
  const form = new FormData();
  form.set("kind", "bug");
  form.set("summary", " Crash ");
  form.set("description", "It broke");
  form.set("impact", "blocks");
  form.set("area", "/tasks");
  form.set("diagnostics", "{}");
  form.set("version", "v1");
  form.set("viewport", "800x600");
  form.set("request_id", "r1");
  form.set("screenshot", new File([PNG16], "screenshot.png", { type: "image/png" }));
  return form;
}

function postRequest(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request("http://app.test/api/bug-report", { method: "POST", body, headers });
}

async function send(
  route: (request: Request) => Promise<Response>,
  body: BodyInit,
  headers: Record<string, string> = { "user-agent": "Agent/1.0" },
): Promise<Response> {
  const res = await route(postRequest(body, headers));
  expect(await res.clone().text()).not.toContain(KEY);
  return res;
}

function expectProblem(res: Response, status: number, title: string, detail: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("content-type")).toBe(PROBLEM_TYPE);
  return res.json().then((body) => {
    expect(body).toEqual({ type: "about:blank", title, status, detail, instance: "/api/bug-report" });
  });
}

function upstreamForm(): FormData {
  return upstream.mock.calls[0][1]?.body as FormData;
}

beforeEach(() => {
  upstream = vi.fn<Intake>(async () => new Response(FILED, { status: 201, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", upstream);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(KEY);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createBugReportRoute", () => {
  it("S1: refuses a request with no reporter as 401 and does not call the intake", async () => {
    const route = routeWith({ reporter: () => null });

    const res = await send(route, good());

    await expectProblem(res, 401, "Unauthorized", "Not authenticated.");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("S2: answers 503 when the intake key is not configured and does not call the intake", async () => {
    const route = routeWith({ intakeKey: "" });

    const res = await send(route, good());

    await expectProblem(res, 503, "Service Unavailable", "Bug reporting is not configured on this server.");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("S3: answers the app's limit as 429 with Retry-After rounded up", async () => {
    const limit = vi.fn(async (_request: Request, _reporter: BugReporter) => 12.2);
    const route = routeWith({ limit });
    const request = postRequest(good(), { "user-agent": "Agent/1.0" });

    const res = await route(request);

    await expectProblem(res, 429, "Too Many Requests", "Too many bug reports. Try again in 13 seconds.");
    expect(res.headers.get("retry-after")).toBe("13");
    expect(limit.mock.calls[0][0]).toBe(request);
    expect(limit.mock.calls[0][1]).toEqual({ name: "Ann", email: "ann@x.test" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("S4: relays a good report to the intake and answers 201 with its id and number", async () => {
    const route = routeWith({});

    const res = await send(route, good(), { "user-agent": "é".repeat(300) });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "r-1", number: 42 });
    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe(INTAKE);
    expect(init).toMatchObject({
      method: "POST",
      redirect: "manual",
      headers: { Authorization: "Bearer k-secret", Accept: "application/json" },
    });
    expect(init?.headers).not.toHaveProperty("Content-Type");
    const form = upstreamForm();
    expect([...form.keys()]).toEqual([
      "kind", "summary", "description", "impact", "area", "diagnostics", "version",
      "viewport", "user_agent", "request_id", "reporter_name", "reporter_email", "screenshot",
    ]);
    expect(form.get("summary")).toBe("Crash");
    expect(form.get("user_agent")).toBe("é".repeat(256));
    expect(form.get("reporter_email")).toBe("ann@x.test");
    const shot = form.get("screenshot") as File;
    expect(shot).toBeInstanceOf(File);
    expect(shot.name).toBe("screenshot.png");
    expect(shot.type).toBe("image/png");
    expect(new Uint8Array(await shot.arrayBuffer())).toEqual(PNG16);
  });

  it("S5: does not forward empty optional fields and defaults kind to bug", async () => {
    const route = routeWith({});
    const form = good();
    form.delete("kind");
    form.delete("version");
    form.delete("request_id");
    form.delete("screenshot");
    form.set("summary", "");

    const res = await send(route, form, {});

    expect(res.status).toBe(201);
    expect([...upstreamForm().keys()]).toEqual([
      "kind", "description", "impact", "area", "diagnostics", "viewport", "reporter_name", "reporter_email",
    ]);
    expect(upstreamForm().get("kind")).toBe("bug");
  });

  it.each([
    { name: "kind", field: "kind", value: "nope", detail: "Kind must be bug or feature." },
    { name: "summary over 200", field: "summary", value: "x".repeat(201), detail: "Summary must be at most 200 characters." },
    { name: "empty description", field: "description", value: "", detail: "A description is required." },
    { name: "description over 5000", field: "description", value: "x".repeat(5001), detail: "Description must be at most 5000 characters." },
    { name: "unknown impact", field: "impact", value: "urgent", detail: "Impact must be one of blocks, workaround or cosmetic." },
    { name: "empty area", field: "area", value: "", detail: "An area is required." },
    { name: "area without a leading slash", field: "area", value: "tasks", detail: 'Area must be a route path starting with "/".' },
    { name: "area over 512", field: "area", value: "/" + "x".repeat(512), detail: "Area must be at most 512 characters." },
    { name: "diagnostics over 32 KiB", field: "diagnostics", value: "x".repeat(32769), detail: "Diagnostics must be at most 32 KiB." },
    { name: "diagnostics not JSON", field: "diagnostics", value: "{", detail: "Diagnostics must be JSON." },
    { name: "version over 128", field: "version", value: "v".repeat(129), detail: "Version must be at most 128 characters." },
    { name: "viewport over 64", field: "viewport", value: "x".repeat(65), detail: "Viewport must be at most 64 characters." },
    { name: "request_id over 128", field: "request_id", value: "r".repeat(129), detail: "Request id must be at most 128 characters." },
    {
      name: "non-PNG screenshot",
      field: "screenshot",
      value: new File([new Uint8Array(16)], "screenshot.png", { type: "image/png" }),
      detail: "Screenshot must be a PNG image.",
    },
  ])("S6: refuses $name with 422 and does not call the intake", async ({ field, value, detail }) => {
    const route = routeWith({});
    const form = good();
    form.set(field, value);

    const res = await send(route, form);

    await expectProblem(res, 422, "Unprocessable Entity", detail);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("S7a: refuses a screenshot over 5 MiB with 413", async () => {
    const route = routeWith({});
    const big = new Uint8Array(5242881);
    big.set(PNG_SIGNATURE);
    const form = good();
    form.set("screenshot", new File([big], "screenshot.png", { type: "image/png" }));

    const res = await send(route, form);

    await expectProblem(res, 413, "Request Entity Too Large", "The screenshot is larger than 5 MiB.");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("S7b: refuses a body over 6 MiB with 413 while reading it", async () => {
    const route = routeWith({});
    const body = new Uint8Array(6291457);

    const res = await send(route, body, { "content-type": "multipart/form-data; boundary=x" });

    await expectProblem(res, 413, "Request Entity Too Large", "The report is larger than 6 MiB.");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("S7c: refuses a body that is not multipart with 400", async () => {
    const route = routeWith({});

    const res = await send(route, "x", { "content-type": "text/plain" });

    await expectProblem(res, 400, "Bad Request", "The report body is not a readable multipart form.");
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    { name: "429 with Retry-After 7", status: 429, headers: { "retry-after": "7" }, http: 429, retry: "7", detail: "Too many bug reports. Try again in 7 seconds." },
    { name: "429 without Retry-After", status: 429, headers: {}, http: 429, retry: "60", detail: "Too many bug reports. Try again in 60 seconds." },
    { name: "401", status: 401, headers: {}, http: 503, retry: null, detail: "Bug reporting is not configured on this server." },
    { name: "403", status: 403, headers: {}, http: 503, retry: null, detail: "Bug reporting is not configured on this server." },
    { name: "409", status: 409, headers: {}, http: 503, retry: null, detail: "Bug reporting is not configured on this server." },
    { name: "500", status: 500, headers: {}, http: 502, retry: null, detail: "The report could not be filed. Copy it and try again." },
    { name: "302", status: 302, headers: { location: "https://elsewhere.test/" }, http: 502, retry: null, detail: "The report could not be filed. Copy it and try again." },
    { name: "201 with no id", status: 201, headers: {}, body: "{}", http: 502, retry: null, detail: "The report could not be filed. Copy it and try again." },
    { name: "a rejecting intake", reject: true, status: 0, headers: {}, http: 502, retry: null, detail: "The report could not be filed. Copy it and try again." },
  ])("S8: maps an upstream $name to $http", async (row) => {
    if ("reject" in row) {
      upstream.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    } else {
      upstream.mockResolvedValueOnce(new Response(row.body ?? null, { status: row.status, headers: row.headers as Record<string, string> }));
    }
    const route = routeWith({});

    const res = await send(route, good());

    await expectProblem(res, row.http, TITLES[row.http], row.detail);
    expect(res.headers.get("retry-after")).toBe(row.retry);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
