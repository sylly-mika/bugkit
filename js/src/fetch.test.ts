import { createDiagnostics, type Diagnostics } from "./timeline.js";
import { withDiagnostics } from "./install.js";

const AT = "2026-10-16T10:00:00.000Z";
let d: Diagnostics;

beforeEach(() => {
  d = createDiagnostics({ now: () => new Date(AT) });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const BODY_READS = ["clone", "text", "json", "arrayBuffer", "blob", "formData", "bytes"] as const;

function watched(response: Response, reads: string[]): Response {
  const proto = Response.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const target = response as unknown as Record<string, unknown>;
  for (const name of BODY_READS) {
    const real = proto[name];
    target[name] = (...args: unknown[]) => {
      reads.push(name);
      return real.apply(response, args);
    };
  }
  Object.defineProperty(response, "body", {
    configurable: true,
    get: () => {
      reads.push("body");
      return Reflect.get(Response.prototype, "body", response);
    },
  });
  const realHeaders = response.headers;
  const headers = new Proxy(realHeaders, {
    get(t, prop) {
      if (prop === "get") {
        return (name: string) => {
          reads.push(`headers.get:${name.toLowerCase()}`);
          return t.get(name);
        };
      }
      reads.push(`headers.${String(prop)}`);
      const value = Reflect.get(t, prop, t) as unknown;
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(t) : value;
    },
  });
  Object.defineProperty(response, "headers", { configurable: true, value: headers });
  return response;
}

describe("withDiagnostics", () => {
  it("the response body and every header but x-request-id stay unread", async () => {
    const reads: string[] = [];
    const response = watched(
      new Response("secret body", {
        status: 500,
        headers: { "x-request-id": "req-1", "set-cookie": "sid=fake-cookie-1" },
      }),
      reads,
    );
    const fetcher: typeof fetch = async () => response;

    const result = await withDiagnostics(fetcher, d)("/api/v1/x", {
      method: "post",
      headers: { authorization: "Bearer fake-token-1" },
      body: "password=fake-pass-1",
    });

    expect(result).toBe(response);
    expect(reads).toEqual(["headers.get:x-request-id"]);
    expect(result.bodyUsed).toBe(false);
    expect(d.snapshot()).toHaveLength(1);
    expect(d.snapshot()[0]).toMatchObject({
      type: "api",
      method: "POST",
      path: "/api/v1/x",
      status: 500,
      request_id: "req-1",
    });
    const json = JSON.stringify(d.snapshot());
    for (const secret of ["secret body", "fake-cookie-1", "fake-token-1", "fake-pass-1"]) {
      expect(json).not.toContain(secret);
    }
    expect(await response.text()).toBe("secret body");
  });

  it("a network failure records status 0 and rethrows the same error", async () => {
    const failure = new TypeError("Failed to fetch");
    const fetcher: typeof fetch = async () => {
      throw failure;
    };

    await expect(withDiagnostics(fetcher, d)("https://api.example/api/v1/x")).rejects.toBe(failure);

    expect(d.snapshot()).toHaveLength(1);
    expect(d.snapshot()[0]).toMatchObject({
      type: "api",
      method: "GET",
      path: "/api/v1/x",
      status: 0,
      request_id: "",
    });
  });

  it("a Request gives its method, its path and the measured duration", async () => {
    const req = new Request("https://api.example/api/v1/orders?token=abc", { method: "PUT" });
    vi.spyOn(performance, "now").mockReturnValueOnce(1000).mockReturnValueOnce(1120);
    const fetcher: typeof fetch = async () => new Response(null, { status: 204 });

    await withDiagnostics(fetcher, d)(req);

    expect(d.snapshot()).toEqual([
      { type: "api", method: "PUT", path: "/api/v1/orders", status: 204, duration_ms: 120, request_id: "", at: AT },
    ]);
  });

  it("a failing recorder never changes the fetch result", async () => {
    vi.spyOn(d, "recordApiCall").mockImplementation(() => {
      throw new Error("broken");
    });
    const res = new Response("ok");
    const fetcher: typeof fetch = async () => res;

    await expect(withDiagnostics(fetcher, d)("/api/v1/x")).resolves.toBe(res);
  });
});
